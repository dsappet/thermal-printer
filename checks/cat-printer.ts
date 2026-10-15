/**
 * Check 2: "cat printer" protocol (51 78 ... CRC8 FF framing).
 *
 *   bun checks/cat-printer.ts [image.png] [--probe-only]
 *
 * Step 1 is non-destructive: send GetDeviceState (a3) and see whether the
 * printer answers with a 51 78 frame. A reply is a definitive yes, even before
 * anything prints. Step 2 prints the test pattern (or your image).
 *
 *   ENERGY=12000   print darkness (higher = darker, slower). Try 8000–20000.
 */
import { loadBitmap } from "./bitmap";
import { connect, describeWrite, pickChar, sleep, writeChunked } from "./ble";
import { Cat, catPacket, catPrintJob, isCatFrame } from "./protocols";

const args = process.argv.slice(2);
const probeOnly = args.includes("--probe-only");
const imagePath = args.find((a) => !a.startsWith("--"));
const energy = Number(process.env.ENERGY ?? 12000);

async function main() {
  const conn = await connect();
  const write = pickChar(conn, ["ae01"], "write");
  const notify = pickChar(conn, ["ae02"], "notify");
  if (!write) throw new Error("No writable characteristic found");
  console.log(`Writing to ${write.uuid}; notify ${notify?.uuid ?? "none"}; ${describeWrite(conn.peripheral)}`);

  let catReplies = 0;
  if (notify) {
    notify.on("data", (d: Buffer) => {
      const cat = isCatFrame(d);
      if (cat) catReplies++;
      const tag = cat ? `cat cmd 0x${d[2].toString(16)}` : "non-cat";
      console.log(`  ← ${d.toString("hex")}  (${tag})`);
    });
    await notify.subscribeAsync();
  }

  console.log("\nProbe: GetDeviceState (a3)...");
  await writeChunked(conn.peripheral, write, catPacket(Cat.GetDeviceState, [0x00]));
  await sleep(1500);
  console.log(
    catReplies
      ? `✓ Printer answered in cat protocol (${catReplies} frame(s)). This is a cat printer.`
      : "✗ No cat-protocol reply. Probably not a cat printer (or it never notifies; printing anyway)."
  );

  if (!probeOnly) {
    const bm = await loadBitmap(imagePath);
    const packets = catPrintJob(bm, { energy });
    console.log(`\nPrinting ${bm.width}x${bm.height} (${imagePath ?? "test pattern"}), ${packets.length} packets, ENERGY=${energy}`);
    const t = performance.now();
    // One packet at a time so each row frame stays intact even when chunked.
    for (const p of packets) await writeChunked(conn.peripheral, write, p);
    console.log(`Sent in ${((performance.now() - t) / 1000).toFixed(1)}s.`);
    await sleep(4000);
  }

  await conn.peripheral.disconnectAsync();
  console.log(`
What to look for:
  • Pattern prints, but the ruler/bar is on the RIGHT → bit order flipped (tell me, easy fix).
  • Too faint / too dark                            → adjust ENERGY.
  • Streaks or skipped rows                         → raise CHUNK_DELAY_MS.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});

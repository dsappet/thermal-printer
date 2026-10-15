/**
 * Check 1: Phomemo-style ESC/POS raster (GS v 0).
 *
 *   bun checks/phomemo-raster.ts [image.png] [--no-vendor]
 *
 * Differences from the earlier index.ts / test.ts attempts:
 *  - full 384-dot width (48 bytes/row) instead of 256
 *  - Phomemo `1f 11 xx` header/footer bytes (toggle with --no-vendor)
 *  - picks the ff02 characteristic by UUID instead of services[0]
 *  - chunked + paced writes instead of one giant writeAsync
 *  - no trailing pile of 0x00 padding
 */
import { loadBitmap } from "./bitmap";
import { connect, describeWrite, logNotifications, pickChar, sleep, writeChunked } from "./ble";
import { phomemoRasterJob } from "./protocols";

const args = process.argv.slice(2);
const vendorBytes = !args.includes("--no-vendor");
const imagePath = args.find((a) => !a.startsWith("--"));

async function main() {
  const bm = await loadBitmap(imagePath);
  const job = phomemoRasterJob(bm, { vendorBytes });
  console.log(
    `Bitmap ${bm.width}x${bm.height} (${imagePath ?? "test pattern"}), job ${job.length} bytes, vendor bytes ${vendorBytes ? "ON" : "OFF"}`
  );

  const conn = await connect();
  const write = pickChar(conn, ["ff02"], "write");
  if (!write) throw new Error("No writable characteristic found");
  console.log(`Writing to ${write.uuid} [${write.properties.join(", ")}]; ${describeWrite(conn.peripheral)}`);
  await logNotifications(pickChar(conn, ["ff03"], "notify"), "notify");

  const t = performance.now();
  await writeChunked(conn.peripheral, write, job);
  console.log(`Sent in ${((performance.now() - t) / 1000).toFixed(1)}s. Waiting for the printer to finish...`);
  await sleep(4000);

  await conn.peripheral.disconnectAsync();
  console.log(`
What to look for:
  • Test pattern prints cleanly  → this is your protocol. Done.
  • Nothing at all              → try --no-vendor, then WITH_RESPONSE=1, then the cat check.
  • Prints but garbled/streaky  → data is being dropped: raise CHUNK_DELAY_MS or set CHUNK_SIZE=20.
  • Prints partway then stops   → same as above (buffer overrun).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});

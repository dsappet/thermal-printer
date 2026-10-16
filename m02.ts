/**
 * Phomemo M02 driver.
 *
 * The M02 is a raster-only printer: it has no font ROM and ignores ESC/POS text
 * commands. Everything (images, text, QR...) must be rendered to a 1-bit bitmap
 * on the host and sent with GS v 0. See M02-NOTES.md for the protocol research.
 *
 * Usage:
 *   bun m02.ts image <file> [--no-dither] [--preview]
 *   bun m02.ts text "some text" [--size 28] [--font Menlo] [--align left|center|right] [--preview]
 *   bun m02.ts status
 *
 * --preview writes preview.png instead of talking to the printer.
 */

import noble from "@abandonware/noble";
import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

export const M02 = {
  widthPx: 384, // 203 dpi, 48 bytes/line. M02S = 512, M02 Pro = 576.
  bytesPerLine: 48,
  maxBlockLines: 255, // GS v 0 blocks must be <= 255 lines on the M02 family
};

const ESC = 0x1b;
const GS = 0x1d;
const US = 0x1f;

// ESC @ (reset), ESC a 1 (center), 1F 11 02 04 (M02 init / density)
const HEADER = [ESC, 0x40, ESC, 0x61, 0x01, US, 0x11, 0x02, 0x04];
// ESC d 2 twice (print + feed), then vendor queries the official app sends
const FOOTER = [
  ESC, 0x64, 0x02,
  ESC, 0x64, 0x02,
  US, 0x11, 0x08, // battery
  US, 0x11, 0x0e,
  US, 0x11, 0x07, // firmware
  US, 0x11, 0x09, // serial
];

// BLE
const SERVICE_UUID = "ff00";
const WRITE_UUID = "ff02";
const NOTIFY_UUIDS = ["ff03", "ff01"];
const CHUNK_SIZE = Number(process.env.M02_CHUNK ?? 182); // MTU(185) - 3 on macOS
const CHUNK_DELAY_MS = Number(process.env.M02_DELAY ?? 0);
// Write WITH response by default: CoreBluetooth silently drops write-without-response
// packets once its queue fills (seen on an 18 KB job: 102 chunks sent, 80 acked, print
// stalled). With-response writes are flow controlled and the printer acks every one.
const WITHOUT_RESPONSE = process.env.M02_NO_RESPONSE === "1";

// ---------------------------------------------------------------------------
// Bitmap handling
// ---------------------------------------------------------------------------

export interface Bitmap {
  width: number; // always M02.widthPx
  height: number;
  gray: Uint8Array; // width*height, 0 = black, 255 = white (already 1-bit values)
}

/** Floyd–Steinberg error diffusion, in place, on an 8-bit grey buffer. Returns 0/255 values. */
function ditherFloydSteinberg(gray: Uint8Array, width: number, height: number) {
  const buf = new Float32Array(gray);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = buf[i];
      const val = old < 128 ? 0 : 255;
      buf[i] = val;
      const err = old - val;
      if (x + 1 < width) buf[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) buf[i + width - 1] += (err * 3) / 16;
        buf[i + width] += (err * 5) / 16;
        if (x + 1 < width) buf[i + width + 1] += (err * 1) / 16;
      }
    }
  }
  for (let i = 0; i < gray.length; i++) gray[i] = buf[i] < 128 ? 0 : 255;
}

/**
 * Load any image sharp can read, fit it to the printer width (centered, white
 * padding) and convert to a 1-bit greyscale buffer.
 */
export async function imageToBitmap(
  input: string | Buffer,
  opts: { dither?: boolean; width?: number } = {}
): Promise<Bitmap> {
  const dither = opts.dither ?? true;
  const targetWidth = opts.width ?? M02.widthPx;

  const { data, info } = await sharp(input)
    .rotate() // honour EXIF orientation
    .flatten({ background: "#fff" })
    .resize({ width: targetWidth, fit: "inside" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Pad to full printer width, centered on white.
  const full = new Uint8Array(M02.widthPx * info.height).fill(255);
  const xOff = Math.floor((M02.widthPx - info.width) / 2);
  for (let y = 0; y < info.height; y++) {
    full.set(data.subarray(y * info.width, (y + 1) * info.width), y * M02.widthPx + xOff);
  }

  if (dither) {
    ditherFloydSteinberg(full, M02.widthPx, info.height);
  } else {
    for (let i = 0; i < full.length; i++) full[i] = full[i] < 128 ? 0 : 255;
  }

  return { width: M02.widthPx, height: info.height, gray: full };
}

/** Pack a 1-bit grey bitmap into M02 raster rows: MSB first, 1 = black. */
export function packBitmap(bmp: Bitmap): Uint8Array {
  const out = new Uint8Array(M02.bytesPerLine * bmp.height);
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) {
      if (bmp.gray[y * bmp.width + x] < 128) {
        out[y * M02.bytesPerLine + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return out;
}

/** Build the full byte stream for one print job. */
export function buildJob(bmp: Bitmap, opts: { feedLines?: number } = {}): Uint8Array {
  const packed = packBitmap(bmp);
  const parts: number[] = [...HEADER];

  for (let line = 0; line < bmp.height; line += M02.maxBlockLines) {
    const n = Math.min(M02.maxBlockLines, bmp.height - line);
    // GS v 0 mode=0, width bytes (LE), lines (LE)
    parts.push(GS, 0x76, 0x30, 0x00, M02.bytesPerLine & 0xff, M02.bytesPerLine >> 8, n & 0xff, n >> 8);
    const start = line * M02.bytesPerLine;
    for (let i = 0; i < n * M02.bytesPerLine; i++) parts.push(packed[start + i]);
  }

  if (opts.feedLines) parts.push(ESC, 0x64, opts.feedLines & 0xff);
  parts.push(...FOOTER);
  return Uint8Array.from(parts);
}

/** Write the bitmap out as a PNG so you can eyeball it before printing. */
export async function bitmapToPng(bmp: Bitmap, path: string) {
  await sharp(Buffer.from(bmp.gray), {
    raw: { width: bmp.width, height: bmp.height, channels: 1 },
  })
    .png()
    .toFile(path);
}

// ---------------------------------------------------------------------------
// Text -> bitmap (via @napi-rs/canvas so we get real system fonts + measureText)
// ---------------------------------------------------------------------------

export interface TextOptions {
  size?: number; // px
  font?: string; // family name
  bold?: boolean;
  align?: "left" | "center" | "right";
  lineHeight?: number; // multiplier
  margin?: number; // px each side
}

export function textToBitmap(text: string, opts: TextOptions = {}): Bitmap {
  const size = opts.size ?? 28;
  const font = opts.font ?? "Helvetica";
  const weight = opts.bold ? "bold " : "";
  const align = opts.align ?? "left";
  const lineHeight = Math.round(size * (opts.lineHeight ?? 1.25));
  const margin = opts.margin ?? 8;
  const maxWidth = M02.widthPx - margin * 2;

  const measure = createCanvas(10, 10).getContext("2d");
  measure.font = `${weight}${size}px ${font}`;

  // Greedy word wrap, honouring explicit newlines. Long words are broken by character.
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let cur = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const trial = cur ? `${cur} ${word}` : word;
      if (measure.measureText(trial).width <= maxWidth) {
        cur = trial;
        continue;
      }
      if (cur) lines.push(cur);
      cur = "";
      if (measure.measureText(word).width <= maxWidth) {
        cur = word;
      } else {
        for (const ch of word) {
          if (measure.measureText(cur + ch).width > maxWidth) {
            lines.push(cur);
            cur = ch;
          } else cur += ch;
        }
      }
    }
    lines.push(cur); // empty string keeps blank lines
  }

  const height = Math.max(lineHeight, lines.length * lineHeight) + margin * 2;
  const canvas = createCanvas(M02.widthPx, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, M02.widthPx, height);
  ctx.fillStyle = "#000";
  ctx.font = `${weight}${size}px ${font}`;
  ctx.textBaseline = "top";
  ctx.textAlign = align;
  const x = align === "left" ? margin : align === "right" ? M02.widthPx - margin : M02.widthPx / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, margin + i * lineHeight));

  // RGBA -> thresholded grey (text is crisp; no dithering wanted)
  const rgba = ctx.getImageData(0, 0, M02.widthPx, height).data;
  const gray = new Uint8Array(M02.widthPx * height);
  for (let i = 0; i < gray.length; i++) {
    const lum = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
    gray[i] = lum < 160 ? 0 : 255; // slightly aggressive so anti-aliasing edges go black
  }
  return { width: M02.widthPx, height, gray };
}

// ---------------------------------------------------------------------------
// Bluetooth
// ---------------------------------------------------------------------------

export interface Printer {
  peripheral: noble.Peripheral;
  write: noble.Characteristic;
  notify?: noble.Characteristic;
  acks: () => number;
  /** Resolves when the printer reports the job complete (1A 0F), or 1.5 s after it answers the footer's serial query. */
  waitForJobDone: (timeoutMs: number) => Promise<boolean>;
  disconnect(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decodeNotification(d: Buffer): string {
  if (d[0] !== 0x1a) return `raw ${d.toString("hex")}`;
  switch (d[1]) {
    case 0x07: return `firmware ${d[2]}.0.${d[4]}`;
    case 0x04: return `battery ${d[2]}%`;
    case 0x08: return `serial ${d.subarray(2).toString("ascii")}`;
    case 0x06: return `paper ${d[2] === 0x89 ? "ok" : "OUT"}`;
    case 0x05: return `cover ${d[2] === 0x98 ? "closed" : "OPEN"}`;
    case 0x03: return `temperature ${d[2] === 0xa8 ? "ok" : "TOO HOT"}`;
    case 0x09: return `reply to 1F 11 0E: ${d.subarray(2).toString("hex")}`;
    case 0x0f: return `print complete`;
    default: return `unknown ${d.toString("hex")}`;
  }
}

export async function connect(opts: { timeoutMs?: number; name?: RegExp } = {}): Promise<Printer> {
  const nameMatch = opts.name ?? /^(M02|Q02|T02)/i;
  const timeoutMs = opts.timeoutMs ?? 20000;

  const peripheral = await new Promise<noble.Peripheral>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out scanning for printer")), timeoutMs);
    const onDiscover = async (p: noble.Peripheral) => {
      const name = p.advertisement.localName ?? "";
      if (!nameMatch.test(name)) return;
      clearTimeout(timer);
      noble.removeListener("discover", onDiscover);
      await noble.stopScanningAsync();
      console.log(`Found ${name} (${p.id}) rssi=${p.rssi}`);
      resolve(p);
    };
    noble.on("discover", onDiscover);
    const start = () => noble.startScanningAsync([], false).catch(reject);
    if (noble.state === "poweredOn") start();
    else noble.once("stateChange", (s) => (s === "poweredOn" ? start() : reject(new Error(`BT state ${s}`))));
  });

  await peripheral.connectAsync();
  const { characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync();
  console.log(
    "Characteristics:",
    characteristics.map((c) => `${c.uuid}[${c.properties.join(",")}]`).join(" ")
  );

  const write =
    characteristics.find((c) => c.uuid === WRITE_UUID) ??
    characteristics.find((c) => c.properties.includes("writeWithoutResponse")) ??
    characteristics.find((c) => c.properties.includes("write"));
  if (!write) throw new Error("No writable characteristic found");

  const notify = characteristics.find(
    (c) => NOTIFY_UUIDS.includes(c.uuid) && c.properties.includes("notify")
  );
  let acks = 0;
  let serialWaiters: Array<() => void> = [];
  if (notify) {
    notify.on("data", (d: Buffer) => {
      // The printer acks every write with 01 01; count them instead of spamming.
      if (d.length === 2 && d[0] === 0x01 && d[1] === 0x01) {
        acks++;
        return;
      }
      console.log(`<- ${decodeNotification(d)}  (acks so far: ${acks})`);
      // Job-done detection: the explicit print-complete frame (1A 0F) is best; the
      // reply to the footer's serial query (1A 08) is a fallback, since the printer
      // only answers it once the raster data ahead of it has been consumed.
      const fire = () => {
        serialWaiters.forEach((fn) => fn());
        serialWaiters = [];
      };
      if (d[0] === 0x1a && d[1] === 0x0f) fire();
      else if (d[0] === 0x1a && d[1] === 0x08) setTimeout(fire, 1500);
    });
    await notify.subscribeAsync().catch((e) => console.log("subscribe failed:", e.message));
  }

  // @ts-ignore mtu is populated on some bindings
  console.log(`Connected. write=${write.uuid} notify=${notify?.uuid ?? "none"} mtu=${peripheral.mtu ?? "?"} chunk=${CHUNK_SIZE}`);

  return {
    peripheral,
    write,
    notify,
    acks: () => acks,
    waitForJobDone: (timeoutMs) =>
      new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), timeoutMs);
        serialWaiters.push(() => {
          clearTimeout(t);
          resolve(true);
        });
      }),
    disconnect: async () => {
      console.log(`Acks received: ${acks}`);
      await peripheral.disconnectAsync();
    },
  };
}

/** Stream bytes to the printer in MTU-sized chunks, write-without-response. */
export async function send(printer: Printer, data: Uint8Array) {
  const t0 = Date.now();
  const acks0 = printer.acks();
  let chunks = 0;
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    await printer.write.writeAsync(Buffer.from(data.subarray(i, i + CHUNK_SIZE)), WITHOUT_RESPONSE);
    chunks++;
    if (CHUNK_DELAY_MS) await sleep(CHUNK_DELAY_MS);
  }
  console.log(
    `Sent ${data.length} bytes in ${chunks} chunks (${WITHOUT_RESPONSE ? "without" : "with"} response) in ${Date.now() - t0} ms; acks so far ${printer.acks() - acks0}`
  );
}

export async function printBitmap(printer: Printer, bmp: Bitmap, opts: { feedLines?: number } = {}) {
  console.log(`Printing ${bmp.width}x${bmp.height}`);
  const t0 = Date.now();
  await send(printer, buildJob(bmp, opts));
  // Arm the completion wait only after every chunk is ATT-acked: a stale 1A 0F from an
  // earlier job can show up mid-transfer and would otherwise end the wait early.
  const ok = await printer.waitForJobDone(30000);
  console.log(ok ? `Printer finished job after ${Date.now() - t0} ms` : "Timed out waiting for the printer to finish");
  await sleep(300);
}

export async function queryStatus(printer: Printer) {
  // Only use documented opcodes. Do NOT enumerate past 0x14 (can brick the printer).
  for (const op of [0x07, 0x08, 0x09, 0x11, 0x12, 0x13]) {
    await printer.write.writeAsync(Buffer.from([US, 0x11, op]), true);
    await sleep(200);
  }
  await sleep(500);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return args[i + 1];
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const preview = args.includes("--preview");

  let bmp: Bitmap | undefined;
  if (cmd === "image") {
    bmp = await imageToBitmap(args[0], { dither: !args.includes("--no-dither") });
  } else if (cmd === "text") {
    bmp = textToBitmap(args[0], {
      size: flag(args, "size") ? Number(flag(args, "size")) : undefined,
      font: flag(args, "font"),
      bold: args.includes("--bold"),
      align: flag(args, "align") as TextOptions["align"],
    });
  } else if (cmd !== "status") {
    console.log("usage: bun m02.ts image <file> | text \"...\" | status   [--preview]");
    process.exit(1);
  }

  if (bmp && preview) {
    await bitmapToPng(bmp, "preview.png");
    console.log(`Wrote preview.png (${bmp.width}x${bmp.height}), ${buildJob(bmp).length} bytes would be sent`);
    process.exit(0);
  }

  const printer = await connect();
  try {
    if (cmd === "status") await queryStatus(printer);
    else if (bmp) await printBitmap(printer, bmp);
  } finally {
    await printer.disconnect();
    console.log("Disconnected");
  }
  process.exit(0);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error("Error:", e.message ?? e);
    process.exit(1);
  });
}

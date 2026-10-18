/**
 * Phomemo M02 wire protocol. Pure functions, no dependencies, no I/O.
 * See M02-NOTES.md for where every byte comes from.
 */
import type { Bitmap } from "./bitmap.js";

export interface Model {
  name: string;
  widthPx: number;
  bytesPerLine: number;
  maxBlockLines: number;
}

export const MODELS = {
  M02: { name: "M02", widthPx: 384, bytesPerLine: 48, maxBlockLines: 255 },
  M02S: { name: "M02S", widthPx: 512, bytesPerLine: 64, maxBlockLines: 255 },
  M02Pro: { name: "M02 Pro", widthPx: 576, bytesPerLine: 72, maxBlockLines: 255 },
} as const satisfies Record<string, Model>;

export const M02: Model = MODELS.M02;

export const ESC = 0x1b;
export const GS = 0x1d;
export const US = 0x1f;

/** ESC @ reset, ESC a 1 center, 1F 11 02 04 M02 init. */
export const HEADER = [ESC, 0x40, ESC, 0x61, 0x01, US, 0x11, 0x02, 0x04];
/** ESC d 2 twice, then the vendor queries the official app sends after a job. */
export const FOOTER = [
  ESC, 0x64, 0x02,
  ESC, 0x64, 0x02,
  US, 0x11, 0x08, // battery
  US, 0x11, 0x0e,
  US, 0x11, 0x07, // firmware
  US, 0x11, 0x09, // serial
];

/** Documented 1F 11 opcodes. Never enumerate past 0x14: it can brick the printer. */
export const QUERY = {
  firmware: 0x07,
  battery: 0x08,
  serial: 0x09,
  paper: 0x11,
  cover: 0x12,
  temperature: 0x13,
} as const;

export function queryBytes(op: number): Uint8Array {
  return Uint8Array.from([US, 0x11, op]);
}

export function feedBytes(lines: number): Uint8Array {
  return Uint8Array.from([ESC, 0x64, lines & 0xff]);
}

/** Pack a bitmap into raster rows: MSB first, 1 = black, exactly bytesPerLine per row. */
export function packBitmap(bmp: Bitmap, model: Model = M02): Uint8Array {
  if (bmp.width !== model.widthPx) {
    throw new Error(`bitmap width ${bmp.width} != printer width ${model.widthPx}`);
  }
  const bpl = model.bytesPerLine;
  const out = new Uint8Array(bpl * bmp.height);
  for (let y = 0; y < bmp.height; y++) {
    const row = y * bmp.width;
    const orow = y * bpl;
    for (let x = 0; x < bmp.width; x++) {
      if (bmp.gray[row + x] < 128) out[orow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

/** Header + GS v 0 blocks (<= maxBlockLines each) + optional feed + footer. */
export function buildJob(bmp: Bitmap, opts: { feedLines?: number; model?: Model } = {}): Uint8Array {
  const model = opts.model ?? M02;
  const packed = packBitmap(bmp, model);
  const blocks = Math.ceil(bmp.height / model.maxBlockLines);
  const size = HEADER.length + blocks * 8 + packed.length + (opts.feedLines ? 3 : 0) + FOOTER.length;
  const out = new Uint8Array(size);
  let p = 0;
  out.set(HEADER, p);
  p += HEADER.length;
  for (let line = 0; line < bmp.height; line += model.maxBlockLines) {
    const n = Math.min(model.maxBlockLines, bmp.height - line);
    out.set([GS, 0x76, 0x30, 0x00, model.bytesPerLine & 0xff, model.bytesPerLine >> 8, n & 0xff, n >> 8], p);
    p += 8;
    const start = line * model.bytesPerLine;
    out.set(packed.subarray(start, start + n * model.bytesPerLine), p);
    p += n * model.bytesPerLine;
  }
  if (opts.feedLines) {
    out.set(feedBytes(opts.feedLines), p);
    p += 3;
  }
  out.set(FOOTER, p);
  return out;
}

export type Notification =
  | { kind: "ack" }
  | { kind: "firmware"; version: string }
  | { kind: "battery"; percent: number }
  | { kind: "serial"; serial: string }
  | { kind: "paper"; ok: boolean }
  | { kind: "cover"; closed: boolean }
  | { kind: "temperature"; ok: boolean }
  | { kind: "printComplete" }
  | { kind: "unknown"; hex: string };

/** Decode a frame received on the notify characteristic. */
export function decodeNotification(d: Uint8Array): Notification {
  const hex = Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
  if (d.length === 2 && d[0] === 0x01 && d[1] === 0x01) return { kind: "ack" };
  if (d[0] !== 0x1a) return { kind: "unknown", hex };
  switch (d[1]) {
    case 0x07: return { kind: "firmware", version: `${d[2]}.0.${d[4]}` };
    case 0x04: return { kind: "battery", percent: d[2] };
    case 0x08: return { kind: "serial", serial: String.fromCharCode(...d.subarray(2)) };
    case 0x06: return { kind: "paper", ok: d[2] === 0x89 };
    case 0x05: return { kind: "cover", closed: d[2] === 0x98 };
    case 0x03: return { kind: "temperature", ok: d[2] === 0xa8 };
    case 0x0f: return { kind: "printComplete" };
    default: return { kind: "unknown", hex };
  }
}

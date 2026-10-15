/**
 * Pure byte encoders for the two candidate protocols. No Bluetooth here, so
 * this file is unit-testable (see protocols.test.ts).
 */
import { type Bitmap, packRowLSB, packRowMSB } from "./bitmap";

const concat = (parts: ArrayLike<number>[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

// ---------------------------------------------------------------------------
// 1) Phomemo-style ESC/POS raster (GS v 0)
//
// Sequence follows the M02 path in vivier/phomemo-tools. The `1f 11 xx` bytes
// are Phomemo vendor extensions that generic ESC/POS encoders (like
// receipt-printer-encoder) never send. `vendorBytes: false` drops them so you
// can A/B whether they matter on your unit.
// ---------------------------------------------------------------------------
export function phomemoRasterJob(
  bm: Bitmap,
  { vendorBytes = true, rowsPerBlock = 255 } = {}
): Uint8Array {
  const bytesPerRow = Math.ceil(bm.width / 8);
  const parts: ArrayLike<number>[] = [
    [0x1b, 0x40], // ESC @  init
    [0x1b, 0x61, 0x01], // ESC a 1  centre
  ];
  if (vendorBytes) parts.push([0x1f, 0x11, 0x02, 0x04]);

  for (let y0 = 0; y0 < bm.height; y0 += rowsPerBlock) {
    const rows = Math.min(rowsPerBlock, bm.height - y0);
    parts.push([
      0x1d, 0x76, 0x30, 0x00, // GS v 0, normal scale
      bytesPerRow & 0xff, bytesPerRow >> 8,
      rows & 0xff, rows >> 8,
    ]);
    for (let y = y0; y < y0 + rows; y++) parts.push(packRowMSB(bm, y));
  }

  parts.push([0x1b, 0x64, 0x02], [0x1b, 0x64, 0x02]); // ESC d 2, twice
  if (vendorBytes) {
    parts.push(
      [0x1f, 0x11, 0x08],
      [0x1f, 0x11, 0x0e],
      [0x1f, 0x11, 0x07],
      [0x1f, 0x11, 0x09]
    );
  }
  return concat(parts);
}

// ---------------------------------------------------------------------------
// 2) "Cat printer" protocol (GB01/GB02/MX05/MX06/MX10 family and many
// rebadged kids' printers). Framing:
//   51 78 | CMD | 00 | LEN_LO | LEN_HI | DATA... | CRC8(DATA) | FF
// CRC8 is poly 0x07, init 0, over the data bytes only.
// Rows are 48 bytes with the leftmost pixel in the LSB.
// ---------------------------------------------------------------------------
export const Cat = {
  Retract: 0xa0,
  Feed: 0xa1,
  PrintRow: 0xa2,
  GetDeviceState: 0xa3,
  SetQuality: 0xa4,
  Lattice: 0xa6,
  SetEnergy: 0xaf,
  ApplyEnergy: 0xbe,
} as const;

export function crc8(data: ArrayLike<number>): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

export function catPacket(cmd: number, data: ArrayLike<number>): Uint8Array {
  return concat([
    [0x51, 0x78, cmd, 0x00, data.length & 0xff, data.length >> 8],
    data,
    [crc8(data), 0xff],
  ]);
}

const LATTICE_START = [0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c];
const LATTICE_END = [0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17];

/** Returns packets individually so the sender can pace per row. */
export function catPrintJob(
  bm: Bitmap,
  { energy = 12000, feedLines = 80 } = {}
): Uint8Array[] {
  const packets: Uint8Array[] = [
    catPacket(Cat.GetDeviceState, [0x00]),
    catPacket(Cat.SetQuality, [0x33]), // 200 dpi
    catPacket(Cat.SetEnergy, [energy & 0xff, (energy >> 8) & 0xff]),
    catPacket(Cat.ApplyEnergy, [0x01]),
    catPacket(Cat.Lattice, LATTICE_START),
  ];
  for (let y = 0; y < bm.height; y++) {
    packets.push(catPacket(Cat.PrintRow, packRowLSB(bm, y)));
  }
  packets.push(
    catPacket(Cat.Feed, [feedLines & 0xff, feedLines >> 8]),
    catPacket(Cat.Lattice, LATTICE_END),
    catPacket(Cat.GetDeviceState, [0x00])
  );
  return packets;
}

/** Is this notification a cat-protocol frame? */
export const isCatFrame = (d: Uint8Array) =>
  d.length >= 8 && d[0] === 0x51 && d[1] === 0x78;

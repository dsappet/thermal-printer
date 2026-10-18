import { describe, expect, test } from "bun:test";
import { blank } from "../src/bitmap.js";
import {
  FOOTER,
  HEADER,
  M02,
  MODELS,
  QUERY,
  buildJob,
  decodeNotification,
  feedBytes,
  packBitmap,
  queryBytes,
} from "../src/protocol.js";

import { hex } from "./helpers.js";

describe("fixed byte sequences", () => {
  test("header is ESC @, ESC a 1, 1F 11 02 04", () => {
    expect(hex(HEADER)).toBe("1b 40 1b 61 01 1f 11 02 04");
  });

  test("footer feeds twice then queries battery, timer, firmware, serial", () => {
    expect(hex(FOOTER)).toBe("1b 64 02 1b 64 02 1f 11 08 1f 11 0e 1f 11 07 1f 11 09");
  });

  test("queryBytes / feedBytes", () => {
    expect(hex(queryBytes(QUERY.battery))).toBe("1f 11 08");
    expect(hex(feedBytes(3))).toBe("1b 64 03");
    expect(feedBytes(300)[2]).toBe(300 & 0xff);
  });

  test("models have 8 px per byte", () => {
    for (const m of Object.values(MODELS)) expect(m.widthPx as number).toBe(m.bytesPerLine * 8);
  });
});

describe("packBitmap", () => {
  test("MSB first, 1 = black, 48 bytes per row", () => {
    const bmp = blank(384, 2);
    bmp.gray[0] = 0; // x=0,y=0 → bit 7 of byte 0
    bmp.gray[7] = 0; // x=7,y=0 → bit 0 of byte 0
    bmp.gray[384 + 383] = 0; // last pixel of row 1 → bit 0 of byte 47 of row 1
    const packed = packBitmap(bmp);
    expect(packed.length).toBe(96);
    expect(packed[0]).toBe(0b1000_0001);
    expect(packed[1]).toBe(0);
    expect(packed[48 + 47]).toBe(0b0000_0001);
  });

  test("grey below 128 is black, 128 and above is white", () => {
    const bmp = blank(384, 1);
    bmp.gray[0] = 127;
    bmp.gray[1] = 128;
    expect(packBitmap(bmp)[0]).toBe(0b1000_0000);
  });

  test("rejects a bitmap that is not the model width", () => {
    expect(() => packBitmap(blank(200, 1))).toThrow(/width 200/);
    expect(() => packBitmap(blank(512, 1), MODELS.M02S)).not.toThrow();
  });
});

describe("buildJob", () => {
  test("layout: header + 8-byte block header + rows + footer", () => {
    const h = 10;
    const job = buildJob(blank(384, h));
    expect(job.length).toBe(HEADER.length + 8 + 48 * h + FOOTER.length);
    expect(hex(job.subarray(0, 9))).toBe(hex(HEADER));
    // GS v 0, mode 0, xL xH = 48, yL yH = 10
    expect(hex(job.subarray(9, 17))).toBe("1d 76 30 00 30 00 0a 00");
    expect(hex(job.subarray(job.length - FOOTER.length))).toBe(hex(FOOTER));
  });

  test("splits rows into blocks of at most 255 lines", () => {
    const h = 300;
    const job = buildJob(blank(384, h));
    expect(job.length).toBe(HEADER.length + 2 * 8 + 48 * h + FOOTER.length);
    const first = job.subarray(9, 17);
    expect(first[6]).toBe(255);
    expect(first[7]).toBe(0);
    const secondAt = 9 + 8 + 48 * 255;
    const second = job.subarray(secondAt, secondAt + 8);
    expect(hex(second)).toBe("1d 76 30 00 30 00 2d 00"); // 45 lines
  });

  test("exactly 255 lines is one block, 256 is two", () => {
    expect(buildJob(blank(384, 255)).length).toBe(HEADER.length + 8 + 48 * 255 + FOOTER.length);
    expect(buildJob(blank(384, 256)).length).toBe(HEADER.length + 16 + 48 * 256 + FOOTER.length);
  });

  test("feedLines inserts ESC d n before the footer", () => {
    const job = buildJob(blank(384, 1), { feedLines: 4 });
    const at = HEADER.length + 8 + 48;
    expect(hex(job.subarray(at, at + 3))).toBe("1b 64 04");
    expect(job.length).toBe(HEADER.length + 8 + 48 + 3 + FOOTER.length);
  });

  test("uses the model's bytes per line", () => {
    const job = buildJob(blank(576, 1), { model: MODELS.M02Pro });
    expect(hex(job.subarray(9, 17))).toBe("1d 76 30 00 48 00 01 00");
    expect(job.length).toBe(HEADER.length + 8 + 72 + FOOTER.length);
  });

  test("pixels land in the right place", () => {
    const bmp = blank(384, 1);
    bmp.gray[8] = 0; // second byte, MSB
    const job = buildJob(bmp, { model: M02 });
    expect(job[HEADER.length + 8 + 1]).toBe(0x80);
  });
});

describe("decodeNotification", () => {
  const n = (...b: number[]) => decodeNotification(Uint8Array.from(b));

  test("ack", () => expect(n(0x01, 0x01)).toEqual({ kind: "ack" }));
  test("firmware", () => expect(n(0x1a, 0x07, 1, 0, 1)).toEqual({ kind: "firmware", version: "1.0.1" }));
  test("battery", () => expect(n(0x1a, 0x04, 72)).toEqual({ kind: "battery", percent: 72 }));
  test("serial", () => expect(n(0x1a, 0x08, 0x51, 0x32, 0x33)).toEqual({ kind: "serial", serial: "Q23" }));
  test("paper ok / out", () => {
    expect(n(0x1a, 0x06, 0x89)).toEqual({ kind: "paper", ok: true });
    expect(n(0x1a, 0x06, 0x88)).toEqual({ kind: "paper", ok: false });
  });
  test("cover closed / open", () => {
    expect(n(0x1a, 0x05, 0x98)).toEqual({ kind: "cover", closed: true });
    expect(n(0x1a, 0x05, 0x99)).toEqual({ kind: "cover", closed: false });
  });
  test("temperature ok / hot", () => {
    expect(n(0x1a, 0x03, 0xa8)).toEqual({ kind: "temperature", ok: true });
    expect(n(0x1a, 0x03, 0xa9)).toEqual({ kind: "temperature", ok: false });
  });
  test("print complete", () => expect(n(0x1a, 0x0f, 0x0c)).toEqual({ kind: "printComplete" }));
  test("unknown frames keep their hex", () => {
    expect(n(0x02, 0xb6, 0x00)).toEqual({ kind: "unknown", hex: "02b600" });
    expect(n(0x1a, 0x09, 0x0c)).toEqual({ kind: "unknown", hex: "1a090c" });
  });
});

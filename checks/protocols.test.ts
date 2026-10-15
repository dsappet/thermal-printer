import { describe, expect, test } from "bun:test";
import { testPattern, packRowLSB, packRowMSB } from "./bitmap";
import { Cat, catPacket, catPrintJob, crc8, phomemoRasterJob } from "./protocols";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("cat printer framing", () => {
  // Fixed packets as published in community cat-printer drivers; if our CRC
  // reproduces their trailing checksum bytes, the framing is right.
  test("matches known reference packets", () => {
    expect(hex(catPacket(Cat.GetDeviceState, [0x00]))).toBe("5178a30001000000ff");
    expect(hex(catPacket(Cat.SetQuality, [0x33]))).toBe("5178a40001003399ff");
    expect(hex(catPacket(Cat.Feed, [0x30, 0x00]))).toBe("5178a10002003000f9ff");
    expect(
      hex(catPacket(Cat.Lattice, [0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c]))
    ).toBe("5178a6000b00aa551738445f5f5f44382ca1ff");
    expect(
      hex(catPacket(Cat.Lattice, [0xaa, 0x55, 0x17, 0, 0, 0, 0, 0, 0, 0, 0x17]))
    ).toBe("5178a6000b00aa55170000000000000017" + "11ff");
  });

  test("crc8 of empty is 0", () => expect(crc8([])).toBe(0));

  test("one row packet per bitmap row, 48-byte payload", () => {
    const bm = testPattern();
    const pkts = catPrintJob(bm);
    const rows = pkts.filter((p) => p[2] === Cat.PrintRow);
    expect(rows.length).toBe(bm.height);
    expect(rows[0].length).toBe(48 + 8);
  });
});

describe("phomemo raster", () => {
  test("header, GS v 0 block header and size", () => {
    const bm = testPattern(384, 300); // forces two blocks (255 + 45)
    const job = phomemoRasterJob(bm);
    expect(hex(job.subarray(0, 9))).toBe("1b401b61011f110204");
    expect(hex(job.subarray(9, 17))).toBe("1d7630003000ff00");
    const expected = 9 + 2 * 8 + 300 * 48 + 6 + 12;
    expect(job.length).toBe(expected);
  });

  test("vendorBytes: false drops 1f 11 sequences", () => {
    const job = phomemoRasterJob(testPattern(384, 10), { vendorBytes: false });
    expect(hex(job.subarray(0, 5))).toBe("1b401b6101");
    expect(hex(job)).not.toContain("1f11");
  });
});

describe("bit order", () => {
  test("leftmost pixel → MSB for ESC/POS, LSB for cat", () => {
    const bm = { width: 8, height: 1, pixels: new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]) };
    expect(packRowMSB(bm, 0)[0]).toBe(0x80);
    expect(packRowLSB(bm, 0)[0]).toBe(0x01);
  });
});

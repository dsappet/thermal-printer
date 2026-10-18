import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import sharp from "sharp";
import { bitmapToPng, renderImage } from "../src/render/image.js";
import { inkCount, inkSpan, sameBytes } from "./helpers.js";

const OWL = "images/dog-owl.jpeg"; // 1024x1024, the image that first printed on the real M02

/** A synthetic image: left half black, right half white, with alpha. */
const halfBlack = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: { create: { width: w / 2, height: h, channels: 4, background: "#000" } }, left: 0, top: 0 }])
    .png()
    .toBuffer();

describe("renderImage", () => {
  test("fills the page width by default and keeps the aspect ratio", async () => {
    const bmp = await renderImage(OWL);
    expect(bmp.width).toBe(384);
    expect(bmp.height).toBe(384);
    expect(bmp.gray.length).toBe(384 * 384);
  });

  test("outputs only pure black / white", async () => {
    const bmp = await renderImage(OWL, { width: 100 });
    expect(bmp.gray.every((v) => v === 0 || v === 255)).toBe(true);
    expect(inkCount(bmp.gray)).toBeGreaterThan(0);
  });

  test("width as px, % and mm; result is centered on the page", async () => {
    const px = await renderImage(OWL, { width: 192 });
    const pct = await renderImage(OWL, { width: "50%" });
    const mm = await renderImage(OWL, { width: "24mm" });
    for (const bmp of [px, pct, mm]) {
      expect(bmp.width).toBe(384);
      expect(bmp.height).toBe(192);
      const [first, last] = inkSpan(bmp);
      expect(first).toBeGreaterThanOrEqual(96);
      expect(last).toBeLessThan(288);
    }
  });

  test("align left / right", async () => {
    const left = await renderImage(OWL, { width: "50%", align: "left" });
    const right = await renderImage(OWL, { width: "50%", align: "right" });
    expect(inkSpan(left)[1]).toBeLessThan(192);
    expect(inkSpan(right)[0]).toBeGreaterThanOrEqual(192);
  });

  test("width is capped at the page", async () => {
    const bmp = await renderImage(OWL, { width: 9999 });
    expect(bmp.width).toBe(384);
    expect(bmp.height).toBe(384);
  });

  test("maxHeight shrinks the image further", async () => {
    const bmp = await renderImage(OWL, { maxHeight: "10mm" });
    expect(bmp.height).toBe(80);
    const [first, last] = inkSpan(bmp);
    expect(last - first).toBeLessThan(81);
  });

  test("accepts a Buffer and honours alpha (transparent → white)", async () => {
    const buf = await halfBlack(200, 50);
    const bmp = await renderImage(buf, { width: 200, align: "left", dither: false });
    expect(bmp.height).toBe(50);
    expect(inkCount(bmp.gray.subarray(0, 200))).toBe(100); // first row: 100 black, 100 white
    const [first, last] = inkSpan(bmp);
    expect(first).toBe(0);
    expect(last).toBe(99);
  });

  test("dither on vs off differ on a photo", async () => {
    const dithered = await renderImage(OWL, { width: 100 });
    const thresholded = await renderImage(OWL, { width: 100, dither: false });
    expect(sameBytes(dithered.gray, thresholded.gray)).toBe(false);
  });

  test("renders at a wider page", async () => {
    const bmp = await renderImage(OWL, { width: "100%" }, 576);
    expect(bmp.width).toBe(576);
    expect(bmp.height).toBe(576);
  });

  test("missing file rejects", async () => {
    await expect(renderImage("images/does-not-exist.png")).rejects.toThrow();
  });
});

describe("bitmapToPng", () => {
  test("round-trips a bitmap through PNG", async () => {
    const out = join(tmpdir(), `phomemo-test-${process.pid}.png`);
    try {
      const bmp = await renderImage(OWL, { width: 64 });
      await bitmapToPng(bmp, out);
      expect(existsSync(out)).toBe(true);
      const { data, info } = await sharp(readFileSync(out)).greyscale().raw().toBuffer({ resolveWithObject: true });
      expect(info.width).toBe(384);
      expect(info.height).toBe(64);
      expect(info.channels).toBe(1);
      expect(sameBytes(bmp.gray, new Uint8Array(data))).toBe(true);
    } finally {
      if (existsSync(out)) unlinkSync(out);
    }
  });
});

import { describe, expect, test } from "bun:test";
import { blank, ditherFloydSteinberg, placeInWidth, stack, threshold } from "../src/bitmap.js";
import { inkCount } from "./helpers.js";

describe("blank", () => {
  test("is white by default", () => {
    const b = blank(4, 3);
    expect(b.gray.length).toBe(12);
    expect(b.gray.every((v) => v === 255)).toBe(true);
  });

  test("accepts a fill", () => {
    expect(blank(2, 2, 0).gray.every((v) => v === 0)).toBe(true);
  });
});

describe("stack", () => {
  test("concatenates rows in order", () => {
    const a = blank(2, 1, 0);
    const b = blank(2, 2, 255);
    const s = stack([a, b], 2);
    expect(s.height).toBe(3);
    expect(Array.from(s.gray)).toEqual([0, 0, 255, 255, 255, 255]);
  });

  test("empty stack is a zero-height bitmap", () => {
    expect(stack([], 384).height).toBe(0);
  });

  test("rejects mismatched widths", () => {
    expect(() => stack([blank(2, 1), blank(3, 1)], 2)).toThrow(/width 3/);
  });
});

describe("placeInWidth", () => {
  const ink = blank(2, 1, 0);

  test("returns the same bitmap when widths match", () => {
    expect(placeInWidth(ink, 2)).toBe(ink);
  });

  test("left / center / right", () => {
    expect(Array.from(placeInWidth(ink, 6, "left").gray)).toEqual([0, 0, 255, 255, 255, 255]);
    expect(Array.from(placeInWidth(ink, 6, "center").gray)).toEqual([255, 255, 0, 0, 255, 255]);
    expect(Array.from(placeInWidth(ink, 6, "right").gray)).toEqual([255, 255, 255, 255, 0, 0]);
  });

  test("center rounds down on odd padding", () => {
    expect(Array.from(placeInWidth(ink, 5, "center").gray)).toEqual([255, 0, 0, 255, 255]);
  });

  test("rejects a bitmap wider than the target", () => {
    expect(() => placeInWidth(blank(10, 1), 5)).toThrow(/10 > 5/);
  });
});

describe("threshold", () => {
  test("splits at 128 by default", () => {
    const g = Uint8Array.from([0, 127, 128, 255]);
    threshold(g);
    expect(Array.from(g)).toEqual([0, 0, 255, 255]);
  });

  test("custom cutoff", () => {
    const g = Uint8Array.from([100, 200]);
    threshold(g, 201);
    expect(Array.from(g)).toEqual([0, 0]);
  });
});

describe("ditherFloydSteinberg", () => {
  test("leaves only pure black and white", () => {
    const w = 64, h = 64;
    const g = new Uint8Array(w * h).map((_, i) => (i * 7) % 256);
    ditherFloydSteinberg(g, w, h);
    expect(g.every((v) => v === 0 || v === 255)).toBe(true);
  });

  test("a mid-grey field comes out roughly half ink", () => {
    const w = 64, h = 64;
    const g = new Uint8Array(w * h).fill(128);
    ditherFloydSteinberg(g, w, h);
    const ratio = inkCount(g) / g.length;
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.55);
  });

  test("pure white and pure black are left alone", () => {
    const white = new Uint8Array(16).fill(255);
    const black = new Uint8Array(16).fill(0);
    ditherFloydSteinberg(white, 4, 4);
    ditherFloydSteinberg(black, 4, 4);
    expect(inkCount(white)).toBe(0);
    expect(inkCount(black)).toBe(16);
  });
});

import { describe, expect, test } from "bun:test";
import { createCanvas } from "@napi-rs/canvas";
import { FONT, lineHeightPx, renderText, wrapText } from "../src/render/text.js";
import { resolveFontSize } from "../src/units.js";
import { inkCount, inkSpan, sameBytes } from "./helpers.js";

describe("bundled font", () => {
  test("JetBrains Mono is registered and monospace at 0.6 em", () => {
    const ctx = createCanvas(1, 1).getContext("2d");
    ctx.font = `100px "${FONT}"`;
    const i = ctx.measureText("i").width;
    const w = ctx.measureText("W").width;
    expect(i).toBeCloseTo(w, 1);
    expect(w).toBeCloseTo(60, 0);
  });
});

describe("wrapText", () => {
  test("short text is one line, explicit newlines are kept", () => {
    expect(wrapText("hello")).toEqual(["hello"]);
    expect(wrapText("a\nb\n\nc")).toEqual(["a", "b", "", "c"]);
    expect(wrapText("")).toEqual([""]);
  });

  test("wraps at word boundaries and never exceeds the page", () => {
    const text = "The quick brown fox jumps over the lazy dog again and again and again";
    const lines = wrapText(text, { size: 24 }, 384);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ").replace(/\s+/g, " ")).toBe(text);
    const ctx = createCanvas(1, 1).getContext("2d");
    ctx.font = `24px "${FONT}"`;
    for (const l of lines) expect(ctx.measureText(l).width).toBeLessThanOrEqual(384 - 16);
  });

  test("preserves runs of spaces inside a line (hand-aligned tables)", () => {
    const row = "Coffee            2   $7.00";
    expect(wrapText(row, { columns: 32 })).toEqual([row]);
  });

  test("breaks a word longer than the line by character", () => {
    const long = "x".repeat(80);
    const lines = wrapText(long, { columns: 32 });
    expect(lines.length).toBe(3);
    expect(lines.map((l) => l.length)).toEqual([32, 32, 16]);
  });

  test("columns: N fits exactly N characters on a line", () => {
    expect(wrapText("a".repeat(32), { columns: 32 }).length).toBe(1);
    expect(wrapText("a".repeat(33), { columns: 32 }).length).toBe(2);
    expect(wrapText("a".repeat(42), { columns: 42 }).length).toBe(1);
  });

  test("respects a custom margin", () => {
    const text = "word ".repeat(30).trim();
    expect(wrapText(text, { size: 20, margin: 0 }).length).toBeLessThanOrEqual(wrapText(text, { size: 20, margin: 60 }).length);
  });
});

describe("renderText", () => {
  test("bitmap is page-wide and lines × line height tall", () => {
    const bmp = renderText("one\ntwo\nthree", { size: 24 }, 384);
    expect(bmp.width).toBe(384);
    expect(bmp.height).toBe(3 * Math.round(24 * 1.25));
    expect(bmp.gray.length).toBe(384 * bmp.height);
  });

  test("renders at any page width", () => {
    expect(renderText("hi", {}, 576).width).toBe(576);
    expect(lineHeightPx({ size: "md" }, 576)).toBe(Math.round(resolveFontSize({ size: "md" }, 576) * 1.25));
  });

  test("empty text still occupies one line", () => {
    const bmp = renderText("", { size: 20 });
    expect(bmp.height).toBe(25);
    expect(inkCount(bmp.gray)).toBe(0);
  });

  test("produces pure black / white with ink", () => {
    const bmp = renderText("Hello", { size: "lg" });
    expect(inkCount(bmp.gray)).toBeGreaterThan(50);
    expect(bmp.gray.every((v) => v === 0 || v === 255)).toBe(true);
  });

  test("bold uses more ink than regular", () => {
    const regular = inkCount(renderText("Hello world", { size: 28 }).gray);
    const bold = inkCount(renderText("Hello world", { size: 28, bold: true }).gray);
    expect(bold).toBeGreaterThan(regular);
  });

  test("align moves the ink", () => {
    const [l0] = inkSpan(renderText("abc", { align: "left" }));
    const [c0, c1] = inkSpan(renderText("abc", { align: "center" }));
    const [, r1] = inkSpan(renderText("abc", { align: "right" }));
    expect(l0).toBeLessThan(20);
    expect(Math.abs((c0 + c1) / 2 - 192)).toBeLessThan(4);
    expect(r1).toBeGreaterThan(384 - 20);
  });

  test("line height option", () => {
    expect(renderText("a\nb", { size: 20, lineHeight: 2 }).height).toBe(80);
  });

  test("noLigatures renders => as two glyphs", () => {
    const lig = inkSpan(renderText("=>", { size: 40, align: "left" }));
    const nl = inkSpan(renderText("=>", { size: 40, align: "left", noLigatures: true }));
    // Both occupy two advance widths, but the glyph shapes differ.
    expect(nl[1] - nl[0]).toBeGreaterThan(0);
    const a = renderText("=>", { size: 40, align: "left" }).gray;
    const b = renderText("=>", { size: 40, align: "left", noLigatures: true }).gray;
    expect(sameBytes(a, b)).toBe(false);
    expect(lig[0]).toBeLessThan(40);
  });
});

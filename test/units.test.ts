import { describe, expect, test } from "bun:test";
import { MONO_ADVANCE, PX_PER_MM, SIZE_PRESETS, mm, resolveFontSize, resolveLength } from "../src/units.js";

describe("resolveLength", () => {
  test("numbers are px, rounded", () => {
    expect(resolveLength(100, 384, 0)).toBe(100);
    expect(resolveLength(10.6, 384, 0)).toBe(11);
  });

  test("undefined gives the fallback", () => {
    expect(resolveLength(undefined, 384, 42)).toBe(42);
  });

  test("percent of the page width", () => {
    expect(resolveLength("50%", 384, 0)).toBe(192);
    expect(resolveLength("50%", 576, 0)).toBe(288);
    expect(resolveLength(" 33.3 % ", 384, 0)).toBe(128);
  });

  test("mm at 8 px/mm", () => {
    expect(resolveLength("30mm", 384, 0)).toBe(240);
    expect(resolveLength("1.5mm", 384, 0)).toBe(12);
    expect(mm(48)).toBe(384);
    expect(PX_PER_MM).toBe(8);
  });

  test("px strings and bare numeric strings", () => {
    expect(resolveLength("120px", 384, 0)).toBe(120);
    expect(resolveLength("120", 384, 0)).toBe(120);
  });

  test("rejects garbage", () => {
    expect(() => resolveLength("wide", 384, 0)).toThrow(/Bad length/);
    expect(() => resolveLength("10em", 384, 0)).toThrow(/Bad length/);
  });
});

describe("resolveFontSize", () => {
  test("defaults to md", () => {
    expect(resolveFontSize({}, 384)).toBe(SIZE_PRESETS.md);
  });

  test("presets scale with page width", () => {
    expect(resolveFontSize({ size: "xl" }, 384)).toBe(40);
    expect(resolveFontSize({ size: "xl" }, 576)).toBe(60);
    expect(resolveFontSize({ size: "xs" }, 512)).toBe(Math.round(16 * (512 / 384)));
  });

  test("numbers are px regardless of page width", () => {
    expect(resolveFontSize({ size: 28 }, 384)).toBe(28);
    expect(resolveFontSize({ size: 28 }, 576)).toBe(28);
  });

  test("columns picks the size so that many monospace chars fit", () => {
    const size = resolveFontSize({ columns: 32, margin: 8 }, 384);
    expect(size).toBe(Math.floor((384 - 16) / (32 * MONO_ADVANCE)));
    expect(size * MONO_ADVANCE * 32).toBeLessThanOrEqual(384 - 16);
    expect((size + 1) * MONO_ADVANCE * 32).toBeGreaterThan(384 - 16);
  });

  test("columns wins over size", () => {
    expect(resolveFontSize({ columns: 42, size: "xxl" }, 384)).toBe(resolveFontSize({ columns: 42 }, 384));
  });

  test("unknown preset throws with the list of presets", () => {
    expect(() => resolveFontSize({ size: "huge" as never }, 384)).toThrow(/xs, sm, md/);
  });
});

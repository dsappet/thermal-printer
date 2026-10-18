/** Shared helpers for the test suite. */
import type { Bitmap } from "../src/bitmap.js";

export const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");

export const inkCount = (g: Uint8Array) => g.reduce((n, v) => n + (v === 0 ? 1 : 0), 0);

export const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Columns of the bitmap that contain any ink: [first, last] (last = -1 when blank). */
export function inkSpan(bmp: Bitmap): [number, number] {
  let first = bmp.width, last = -1;
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) {
      if (bmp.gray[y * bmp.width + x] === 0) {
        if (x < first) first = x;
        if (x > last) last = x;
      }
    }
  }
  return [first, last];
}

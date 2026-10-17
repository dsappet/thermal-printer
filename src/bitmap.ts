/** 1-bit bitmaps stored as 8-bit grey: 0 = black, 255 = white. */
export interface Bitmap {
  width: number;
  height: number;
  gray: Uint8Array;
}

export type Align = "left" | "center" | "right";

export function blank(width: number, height: number, fill = 255): Bitmap {
  return { width, height, gray: new Uint8Array(width * height).fill(fill) };
}

/** Stack bitmaps vertically. All must share the same width. */
export function stack(parts: Bitmap[], width: number): Bitmap {
  const height = parts.reduce((h, p) => h + p.height, 0);
  const out = blank(width, height);
  let y = 0;
  for (const p of parts) {
    if (p.width !== width) throw new Error(`stack: bitmap width ${p.width} != ${width}`);
    out.gray.set(p.gray, y * width);
    y += p.height;
  }
  return out;
}

/** Place a narrower bitmap inside `width`, padding with white according to `align`. */
export function placeInWidth(bmp: Bitmap, width: number, align: Align = "center"): Bitmap {
  if (bmp.width === width) return bmp;
  if (bmp.width > width) throw new Error(`placeInWidth: ${bmp.width} > ${width}`);
  const xOff =
    align === "left" ? 0 : align === "right" ? width - bmp.width : Math.floor((width - bmp.width) / 2);
  const out = blank(width, bmp.height);
  for (let y = 0; y < bmp.height; y++) {
    out.gray.set(bmp.gray.subarray(y * bmp.width, (y + 1) * bmp.width), y * width + xOff);
  }
  return out;
}

/** Floyd–Steinberg error diffusion. Leaves only 0 / 255 values. */
export function ditherFloydSteinberg(gray: Uint8Array, width: number, height: number) {
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

export function threshold(gray: Uint8Array, cutoff = 128) {
  for (let i = 0; i < gray.length; i++) gray[i] = gray[i] < cutoff ? 0 : 255;
}

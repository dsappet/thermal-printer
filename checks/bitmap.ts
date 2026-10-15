import sharp from "sharp";

/** Both protocols we're testing assume a 384-dot (48-byte) print head. */
export const PRINT_WIDTH = 384;

/** 1-bit image, row-major. pixels[i] === 1 means "burn this dot" (black). */
export type Bitmap = { width: number; height: number; pixels: Uint8Array };

/**
 * Load an image file and Floyd–Steinberg dither it to `width` dots wide.
 * With no path, returns a built-in test pattern (no fonts needed, since these
 * printers have no font ROM and we don't want a text-rendering dependency).
 */
export async function loadBitmap(
  path?: string,
  width = PRINT_WIDTH
): Promise<Bitmap> {
  if (!path) return testPattern(width);

  const { data, info } = await sharp(path)
    .flatten({ background: "#ffffff" })
    .resize(width, null, { fit: "inside" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const h = info.height;
  const w = info.width;
  const grey = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) grey[i] = data[i * info.channels];

  // Pad to full head width so row byte counts are always 48.
  const out = new Uint8Array(width * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = grey[i];
      const v = old < 128 ? 0 : 255;
      out[y * width + x] = v === 0 ? 1 : 0;
      const err = old - v;
      if (x + 1 < w) grey[i + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) grey[i + w - 1] += (err * 3) / 16;
        grey[i + w] += (err * 5) / 16;
        if (x + 1 < w) grey[i + w + 1] += err / 16;
      }
    }
  }
  return { width, height: h, pixels: out };
}

/**
 * Border, an 8-dot ruler along the top, a solid bar, a checkerboard and a
 * diagonal. If the print comes out mirrored, shifted or garbled, this makes it
 * obvious which (bit order vs. width vs. dropped bytes).
 */
export function testPattern(width = PRINT_WIDTH, height = 160): Bitmap {
  const px = new Uint8Array(width * height);
  const set = (x: number, y: number) => {
    if (x >= 0 && x < width && y >= 0 && y < height) px[y * width + x] = 1;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const border = x < 3 || x >= width - 3 || y < 3 || y >= height - 3;
      const ruler = y < 16 && x % 8 === 0 && (x % 64 === 0 || y < 8);
      const bar = y >= 24 && y < 48 && x >= 16 && x < width / 2; // left half only
      const checker =
        y >= 64 && y < 128 && x >= width / 2 && ((x >> 3) + (y >> 3)) % 2 === 0;
      if (border || ruler || bar || checker) set(x, y);
    }
  }
  for (let i = 0; i < Math.min(64, width); i++) set(16 + i, 64 + i); // diagonal ↘
  return { width, height, pixels: px };
}

/** Pack one row, leftmost pixel in the MOST significant bit (ESC/POS order). */
export function packRowMSB(bm: Bitmap, y: number): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(bm.width / 8));
  for (let x = 0; x < bm.width; x++) {
    if (bm.pixels[y * bm.width + x]) bytes[x >> 3] |= 0x80 >> (x & 7);
  }
  return bytes;
}

/** Pack one row, leftmost pixel in the LEAST significant bit (cat printer order). */
export function packRowLSB(bm: Bitmap, y: number): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(bm.width / 8));
  for (let x = 0; x < bm.width; x++) {
    if (bm.pixels[y * bm.width + x]) bytes[x >> 3] |= 1 << (x & 7);
  }
  return bytes;
}

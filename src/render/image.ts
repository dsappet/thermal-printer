/** Image file/buffer → bitmap using sharp. */
import sharp from "sharp";
import { type Align, type Bitmap, ditherFloydSteinberg, placeInWidth, threshold } from "../bitmap.js";
import { type Length, resolveLength } from "../units.js";

export interface ImageOptions {
  /** Target width: px, "50%" of the page, or "30mm". Default: full page width. */
  width?: Length;
  /** Cap on height (px, "%" of page width, or "mm"); aspect ratio is preserved. */
  maxHeight?: Length;
  align?: Align;
  /** Floyd–Steinberg dithering (true) or plain threshold (false). Default true. */
  dither?: boolean;
}

export async function renderImage(input: string | Buffer, opts: ImageOptions = {}, pageWidth = 384): Promise<Bitmap> {
  const width = Math.min(resolveLength(opts.width, pageWidth, pageWidth), pageWidth);
  const maxHeight = opts.maxHeight === undefined ? undefined : resolveLength(opts.maxHeight, pageWidth, 0);

  const { data, info } = await sharp(input)
    .rotate() // honour EXIF orientation
    .flatten({ background: "#fff" })
    .resize({ width, height: maxHeight, fit: "inside" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const gray = new Uint8Array(data.buffer, data.byteOffset, data.length);
  if (opts.dither ?? true) ditherFloydSteinberg(gray, info.width, info.height);
  else threshold(gray);

  return placeInWidth({ width: info.width, height: info.height, gray }, pageWidth, opts.align ?? "center");
}

/** Save a bitmap as PNG (for previews). */
export async function bitmapToPng(bmp: Bitmap, path: string) {
  await sharp(Buffer.from(bmp.gray), { raw: { width: bmp.width, height: bmp.height, channels: 1 } })
    .png()
    .toFile(path);
}

/**
 * This script compares the raw output of the image-pixels library with the raw output of the sharp library.
 * image-pixels output works for the printer, but sharp does not.
 * The goal here is to figure out why (and maybe fix it)
 */

import pixels from "image-pixels";
import sharp from "sharp";

const imagePath = "./images/unicorn-superhero.jpg";

async function main() {
  // read the image with Bun
  const image = await Bun.file(imagePath).arrayBuffer();
  const sharpOut = await sharp(image)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelsOut = await pixels(image);

  // compare the lengths of the two buffers to start
  console.log(sharpOut.data.length, pixelsOut.data.length);
}

main();

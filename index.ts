import noble from "@abandonware/noble";
import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";
import sharp from "sharp";
import pixels from "image-pixels";

// import { renderTextToImage } from "./helpers/htmlToImage";
import { connectToPrinter } from "./bluetooth";
import { generateImage } from "./openai";

// 48 characters/columns (bytes) wide is the wide format 80mm paper
// 32 characters/columns (bytes) wide is the standard format 57mm paper
const IMG_WIDTH = 256; // 32* 8bits // 384(this is full width); // 48 bytes * 8 bits (384 pixels wide)

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processImage(imagePath: string | Buffer) {
  try {
    const image = await sharp(imagePath)
      .resize(IMG_WIDTH, IMG_WIDTH, {
        fit: "contain",
        withoutEnlargement: true,
      })
      // .trim() // This will remove the white space
      .toBuffer({ resolveWithObject: true });

    // Now use a library that does a better job getting the right raw output
    const pixelsOut = await pixels(image.data);
    image.data = pixelsOut.data;

    return image;
  } catch (error) {
    console.error("Error processing image:", error);
    throw error;
  }
}

async function printImage(
  image: string | Buffer,
  characteristic: noble.Characteristic
) {
  try {
    const { data, info } = await processImage(image);
    const { width, height } = info;

    console.log(`Processed image size: ${width}x${height}`);

    const encoder = new ReceiptPrinterEncoder({
      columns: 32, // 384 pixels / 8 dots per byte = 48 columns
      // feedBeforeCut: 2,
      imageMode: "raster",
    });

    const printData = encoder
      .initialize()
      .raw([0x1b, 0x61, 0x02]) // Right align - this doesn't work
      .image({ data, width, height }, info.width, info.height, "atkinson")
      // .newline(4) // this doesn't seem to work
      // .raw([0x1b, 0x64, 0x04]) // 4 new lines
      .encode();

    await characteristic.writeAsync(Buffer.from(printData), false);

    // For some reason we need to send a ton of zeros. Equal to half the buffer sent
    const bufferSize = Math.floor(printData.length / 2);
    const buffer = Buffer.alloc(bufferSize, 0x00);

    // const printTwo = encoder.image({ data, width, height }, info.width, info.height, "atkinson").encode();
    await characteristic.writeAsync(Buffer.from(buffer), false);

    // send 6 newlines
    await characteristic.writeAsync(Buffer.from([0x1b, 0x64, 0x06]), false);
  } catch (error) {
    console.error("Error in printImage:", error);
    throw error;
  }
}

async function main() {
  try {
    const { peripheral, writeCharacteristic, readCharacteristic } =
      await connectToPrinter();

    readCharacteristic.on("data", (d) => {
      console.log("OMG I GOT SOMETHING", d);
    });

    writeCharacteristic.on("data", (d) => {
      console.log("OMG I GOT SOMETHING", d);
    });

    await printImage("images/jellybean-unicorn.jpg", writeCharacteristic);

    console.log("Image printed successfully");

    console.log("Press Enter to continue...");
    await new Promise((resolve) => {
      process.stdin.once("data", () => {
        resolve();
      });
    });

    await peripheral.disconnectAsync();
    console.log("Disconnected from printer");
  } catch (error) {
    console.error("Error:", error.message);
  }
  process.exit();
}

main();

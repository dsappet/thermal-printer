import noble from "@abandonware/noble";
import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";
import sharp from "sharp";
import pixels from "image-pixels";

import { connectToPrinter } from "./bluetooth";

const IMG_WIDTH = 256;

async function processImage(imagePath: string | Buffer) {
  try {
    const image = await sharp(imagePath)
      .resize(IMG_WIDTH, null, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .toBuffer({ resolveWithObject: true });

    const pixelsOut = await pixels(image.data);
    image.data = pixelsOut.data;

    return image;
  } catch (error) {
    console.error("Error processing image:", error);
    throw error;
  }
}

async function printImageWithNewConnection(image: string | Buffer) {
  console.log("\nEstablishing new connection for print...");
  const { peripheral, writeCharacteristic } = await connectToPrinter();

  try {
    const { data, info } = await processImage(image);
    const { width, height } = info;

    console.log(`Processed image size: ${width}x${height}`);

    // Initialize printer
    const initCommands = Buffer.from([
      0x1b,
      0x40, // ESC @ - Initialize printer
      0x1b,
      0x4c,
      0x00, // ESC L 0 - Left margin 0
    ]);
    await writeCharacteristic.writeAsync(initCommands, true);

    const encoder = new ReceiptPrinterEncoder({
      columns: 32,
      imageMode: "raster",
    });

    const printData = encoder
      .image({ data, width, height }, width, height, "atkinson")
      .encode();

    console.log(`Total data size: ${printData.length} bytes`);
    console.time("Data transfer");

    await writeCharacteristic.writeAsync(Buffer.from(printData), false);

    console.timeEnd("Data transfer");

    // Feed lines
    const endCommands = Buffer.from([0x0a, 0x0a, 0x0a, 0x0a]);
    await writeCharacteristic.writeAsync(endCommands, true);

    // Wait a moment for print to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Disconnect before returning
    await peripheral.disconnectAsync();
    console.log("Disconnected after print");
  } catch (error) {
    console.error("Error in printImage:", error);
    try {
      await peripheral.disconnectAsync();
    } catch (e) {
      console.error("Error disconnecting:", e);
    }
    throw error;
  }
}

async function main() {
  try {
    // Print first image
    console.log("Printing first image...");
    await printImageWithNewConnection("images/jellybean-unicorn.jpg");

    console.log("\nPress Enter to print second image...");
    await new Promise((resolve) => {
      process.stdin.once("data", () => {
        resolve();
      });
    });

    // Print second image with fresh connection
    console.log("\nPrinting second image...");
    await printImageWithNewConnection("images/jellybean-unicorn.jpg");

    console.log("\nBoth prints completed. Press Enter to exit...");
    await new Promise((resolve) => {
      process.stdin.once("data", () => {
        resolve();
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
  }
  process.exit();
}

main();

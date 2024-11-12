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

// Keep-alive function
function startKeepAlive(characteristic: noble.Characteristic) {
  const keepAliveInterval = 50; // ms between keep-alive signals
  let keepAliveActive = true;

  // Create a minimal no-op command
  const keepAliveCommand = Buffer.from([0x1b, 0x4c, 0x00]); // ESC L 0 - Set left margin to 0

  const intervalId = setInterval(async () => {
    if (keepAliveActive) {
      try {
        await characteristic.writeAsync(keepAliveCommand, false);
      } catch (error) {
        console.log("Keep-alive write failed:", error);
      }
    }
  }, keepAliveInterval);

  // Return a function to stop the keep-alive
  return () => {
    keepAliveActive = false;
    clearInterval(intervalId);
  };
}

async function printImage(
  image: string | Buffer,
  characteristic: noble.Characteristic
) {
  try {
    const { data, info } = await processImage(image);
    const { width, height } = info;

    console.log(`Processed image size: ${width}x${height}`);

    // Initialize printer
    const initCommands = Buffer.from([
      0x1b,
      0x40, // ESC @ - Initialize printer
      0x1b,
      0x61,
      0x01, // ESC a 1 - Center alignment
      0x1b,
      0x4c,
      0x00, // ESC L 0 - Left margin 0
    ]);
    await characteristic.writeAsync(initCommands, true);

    // Start keep-alive before main data transfer
    console.log("Starting keep-alive signals...");
    const stopKeepAlive = startKeepAlive(characteristic);

    const encoder = new ReceiptPrinterEncoder({
      columns: 32,
      imageMode: "raster",
    });

    const printData = encoder
    .line()
      .align("right")
      .image({ data, width, height }, width, height, "atkinson")
      .encode();

    console.log(`Total data size: ${printData.length} bytes`);

    // Send the entire print data
    await characteristic.writeAsync(Buffer.from(printData), false);

    console.log("Main data transfer complete, keeping connection active...");

    // Keep the keep-alive running for a while after data transfer
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Stop keep-alive and send final commands
    stopKeepAlive();
    console.log("Stopped keep-alive signals");

    // Feed and restore alignment
    const endCommands = Buffer.from([
      0x1b,
      0x61,
      0x00, // ESC a 0 - Restore left alignment
      0x1b,
      0x64,
      0x04, // ESC d 4 - Feed 4 lines
    ]);
    await characteristic.writeAsync(endCommands, true);

    console.log("All data sent to printer");
  } catch (error) {
    console.error("Error in printImage:", error);
    throw error;
  }
}

async function main() {
  try {
    const { peripheral, writeCharacteristic } = await connectToPrinter();

    console.log("Starting print job...");
    await printImage("images/jellybean-unicorn.jpg", writeCharacteristic);
    console.log("Print job data fully sent");

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

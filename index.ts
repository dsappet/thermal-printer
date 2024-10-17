import noble from "@abandonware/noble";
import sharp from "sharp";
import { renderTextToImage } from "./helpers/htmlToImage";

const IMG_WIDTH = 384; // 48 bytes * 8 bits (384 pixels wide)
const DITHER_THRESHOLD = 100;
const CHUNK_SIZE = 128; // Send data in smaller chunks
const DELAY_BETWEEN_CHUNKS = 150; // Milliseconds to wait between chunks
const PRINTER_DPI = 203;
const PRINTER_WIDTH_INCHES = 1.89; // 48mm in inches
const BYTES_PER_LINE = IMG_WIDTH / 8;

const PRINTER_COMMANDS = {
  INIT: Buffer.from([0x1b, 0x40]),
  JUSTIFY_CENTER: Buffer.from([0x1b, 0x61, 0x01]),
  JUSTIFY_LEFT: Buffer.from([0x1b, 0x61, 0x00]),
  PRINT_RASTER: Buffer.from([0x1d, 0x76, 0x30, 0x00]), // the last value is Mode: 0=normal, 1=double width, 2=double height, 3=quadruple
  PRINT_AND_FEED: Buffer.from([0x1b, 0x64]),
  FOOTER: Buffer.from([
    0x1f, 0x11, 0x08, 0x1f, 0x11, 0x0e, 0x1f, 0x11, 0x07, 0x1f, 0x11, 0x09,
  ]),
  SET_DENSITY: [0x1d, 0x21, 0x08], // GS ! [density] density is 0-8 with 8 being darkest
  TEXT_SIZE: [0x1d, 0x21], // GS ! command for character size
  // LINE_SPACING: [0x1b, 0x33], // ESC 3 command for line spacing
  TEXT_MODE: [0x1b, 0x21, 0x00], // Standard text mode
  LINE_SPACING: [0x1b, 0x33, 0x24], // Set line spacing to 36 dots
  // ALIGN_CENTER: [0x1b, 0x61, 0x01],
  // ALIGN_LEFT: [0x1b, 0x61, 0x00],
  QR_CODE: [0x1d, 0x28, 0x6b], // GS ( k
};

async function connectToPrinter() {
  return new Promise((resolve, reject) => {
    noble.on("stateChange", async (state) => {
      if (state === "poweredOn") {
        console.log("Scanning for printer...");
        await noble.startScanningAsync([], false);
      }
    });

    noble.on("discover", async (peripheral) => {
      if (peripheral.advertisement.localName === "M02L") {
        await noble.stopScanningAsync();
        try {
          await peripheral.connectAsync();
          console.log("Connected successfully!");

          const services = await peripheral.discoverServicesAsync([]);
          const characteristics =
            await services[0].discoverCharacteristicsAsync([]);
          const writeCharacteristic = characteristics.find((c) =>
            c.properties.includes("write")
          );

          if (writeCharacteristic) {
            resolve({ peripheral, writeCharacteristic });
          } else {
            reject(new Error("No writable characteristic found"));
          }
        } catch (error) {
          reject(error);
        }
      }
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


async function processImage(imagePath: string) {
  try {
    const image = await sharp(imagePath)
      .resize(IMG_WIDTH, null, {
        fit: "contain",
        // background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      // .sharpen()
      .grayscale()
      .normalize()
      // .linear(1.1, -(255 * 0.1))
      // .blur(0.3)
      // .threshold(DITHER_THRESHOLD)
      .trim() // This will remove the white space
      .raw()
      .toBuffer({ resolveWithObject: true });

    return image;
  } catch (error) {
    console.error("Error processing image:", error);
    throw error;
  }
}

async function printImage(
  imagePath: string,
  characteristic: noble.Characteristic
) {
  try {
    const { data, info } = await processImage(imagePath);
    const { width, height } = info;

    console.log(`Processed image size: ${width}x${height}`);

    // Initialize the printer
    await characteristic.writeAsync(
      Buffer.from([
        ...PRINTER_COMMANDS.INIT,
        ...PRINTER_COMMANDS.JUSTIFY_CENTER,
        ...PRINTER_COMMANDS.SET_DENSITY,
      ]),
      false
    );

    // GS v 0 - Print raster image - same as PRINTER_COMMANDS.PRINT_RASTER
    const GSV0 = Buffer.from([0x1d, 0x76, 0x30, 0x00]);

    const IMAGE_WIDTH_BYTES = width / 8;

    // The raster header (block marker) requires
    // Print Raster
    // Bytes per line
    // 0
    // Number of lines to print in this block.
    // 0

    for (let startIndex = 0; startIndex < info.height; startIndex += 256) {
      const endIndex = Math.min(startIndex + 256, info.height);
      const lineHeight = endIndex - startIndex;

      const BLOCK_MARKER = Buffer.concat([
        GSV0,
        Buffer.from([IMAGE_WIDTH_BYTES, 0x00, lineHeight - 1, 0x00]),
      ]);
      await characteristic.writeAsync(BLOCK_MARKER, false);

      for (
        let imageLineIndex = 0;
        imageLineIndex < lineHeight;
        imageLineIndex++
      ) {
        let imageLine = Buffer.alloc(0);
        for (let byteStart = 0; byteStart < info.width / 8; byteStart++) {
          let byte = 0;
          for (let bit = 0; bit < 8; bit++) {
            const pixelIndex =
              (imageLineIndex + startIndex) * info.width + byteStart * 8 + bit;
            if (data[pixelIndex] === 0) {
              byte |= 1 << (7 - bit);
            }
          }
          // 0x0a breaks the rendering
          // 0x0a alone is processed like LineFeed by the printer
          // so change it to something close
          if (byte === 0x0a) {
            byte = 0x14;
          }
          imageLine = Buffer.concat([imageLine, Buffer.from([byte])]);
        }
        await characteristic.writeAsync(imageLine, false);
      }
    }
    await characteristic.writeAsync(Buffer.from(data), false);

    await characteristic.writeAsync(
      Buffer.from([
        ...PRINTER_COMMANDS.PRINT_AND_FEED,
        0x04,
        ...PRINTER_COMMANDS.FOOTER,
      ]),
      false
    );

  } catch (error) {
    console.error("Error in printImage:", error);
    throw error;
  }
}

async function main() {
  try {
    const { peripheral, writeCharacteristic } = await connectToPrinter();

    // Print text
    // await printTextImage("Hello, Phomemo M02!", writeCharacteristic);
    // console.log("Text printed successfully");
    // await printText("Hello, Phomemo M02!", writeCharacteristic);
    // console.log("Text printed successfully");

    // Print QR Code
    // await printQRCode("Hello, QR Code!", writeCharacteristic);
    // console.log("QR Code printed successfully");

    // Print image (replace 'path/to/your/image.png' with an actual image path)
    await printImage("test.jpg", writeCharacteristic);
    // await printImage("hello.png", writeCharacteristic);
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

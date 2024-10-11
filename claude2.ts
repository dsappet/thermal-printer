import { BunFile } from "bun";
import noble from "@abandonware/noble";
import sharp from "sharp";

const IMG_WIDTH = 384; // 48 bytes * 8 bits
const IMG_HEIGHT = 384; // Making it square for simplicity
const CHUNK_HEIGHT = 128; // Process image in chunks
const DITHER_THRESHOLD = 100;

const PRINTER_COMMANDS = {
  INIT: Buffer.from([0x1b, 0x40]),
  JUSTIFY_CENTER: Buffer.from([0x1b, 0x61, 0x01]),
  JUSTIFY_LEFT: Buffer.from([0x1b, 0x61, 0x00]),
  PRINT_RASTER: Buffer.from([0x1d, 0x76, 0x30, 0x00]),
  PRINT_AND_FEED: Buffer.from([0x1b, 0x64]),
  FOOTER: Buffer.from([
    0x1f, 0x11, 0x08, 0x1f, 0x11, 0x0e, 0x1f, 0x11, 0x07, 0x1f, 0x11, 0x09,
  ]),
};

async function connectToPrinter() {
  return new Promise((resolve, reject) => {
    noble.on("stateChange", async (state) => {
      if (state === "poweredOn") {
        await noble.startScanningAsync([], false);
      }
    });

    noble.on("discover", async (peripheral) => {
      if (peripheral.advertisement.localName === "M02L") {
        await noble.stopScanningAsync();
        try {
          await peripheral.connectAsync();
          console.log("Connected successfully!");

          const { characteristics } =
            await peripheral.discoverAllServicesAndCharacteristicsAsync();
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

async function printText(text, characteristic) {
  const encoder = new TextEncoder();
  const printData = [];

  // Header
  printData.push(...PRINTER_COMMANDS.INIT, ...PRINTER_COMMANDS.JUSTIFY_CENTER);

  // Prepare text data
  const textBytes = encoder.encode(text);
  const bytesPerLine = IMG_WIDTH / 8;
  const lines = Math.ceil(textBytes.length / bytesPerLine);

  // Print raster bit image command
  printData.push(
    ...PRINTER_COMMANDS.PRINT_RASTER,
    bytesPerLine,
    0x00,
    lines & 0xff,
    (lines >> 8) & 0xff
  );

  // Add text data
  for (let i = 0; i < textBytes.length; i += bytesPerLine) {
    const line = new Uint8Array(bytesPerLine);
    line.fill(0);
    line.set(textBytes.slice(i, i + bytesPerLine));
    printData.push(...line);
  }

  // Footer
  printData.push(
    ...PRINTER_COMMANDS.PRINT_AND_FEED,
    0x02,
    ...PRINTER_COMMANDS.PRINT_AND_FEED,
    0x02,
    ...PRINTER_COMMANDS.FOOTER
  );

  // Send data to printer
  await characteristic.write(Buffer.from(printData));
}

async function processImage(imagePath) {
  try {
    const image = await sharp(imagePath)
      .resize(IMG_WIDTH, null, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .grayscale()
      .normalize() // Normalize contrast
      .linear(1.1, -(255 * 0.1)) // Slightly increase contrast
      .blur(0.3) // Slight blur can help with dithering effect
      .threshold(DITHER_THRESHOLD) // Adjustable threshold
      .raw()
      .toBuffer({ resolveWithObject: true });

    return image;
  } catch (error) {
    console.error("Error processing image:", error);
    throw error;
  }
}

async function printImage(imagePath, characteristic) {
  try {
    const { data, info } = await processImage(imagePath);
    const { width, height } = info;

    console.log(`Processed image size: ${width}x${height}`);

    await characteristic.write(
      Buffer.from([
        ...PRINTER_COMMANDS.INIT,
        ...PRINTER_COMMANDS.JUSTIFY_CENTER,
      ])
    );

    const rasterHeader = [
      ...PRINTER_COMMANDS.PRINT_RASTER,
      width / 8,
      0x00,
      height & 0xff,
      (height >> 8) & 0xff,
    ];
    await characteristic.write(Buffer.from(rasterHeader));

    for (let y = 0; y < height; y++) {
      const lineBuffer = new Uint8Array(width / 8);
      for (let x = 0; x < width; x++) {
        if (data[y * width + x] === 0) {
          lineBuffer[Math.floor(x / 8)] |= 0x80 >> x % 8;
        }
      }
      await characteristic.write(Buffer.from(lineBuffer));
    }

    await characteristic.write(
      Buffer.from([
        ...PRINTER_COMMANDS.PRINT_AND_FEED,
        ...PRINTER_COMMANDS.FOOTER,
      ])
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
    // await printText("Hello, Phomemo M02!", writeCharacteristic);
    // console.log("Text printed successfully");

    // Print image (replace 'path/to/your/image.png' with an actual image path)

    await printImage("mascot.png", writeCharacteristic);
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

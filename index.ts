import noble from "@abandonware/noble";
import sharp from "sharp";
import { renderTextToImage } from "./helpers/htmlToImage";

const IMG_WIDTH = 384; // 48 bytes * 8 bits (384 pixels wide)
const DITHER_THRESHOLD = 100;
const CHUNK_SIZE = 128; // Send data in smaller chunks
const DELAY_BETWEEN_CHUNKS = 50; // Milliseconds to wait between chunks
const PRINTER_DPI = 203;
const PRINTER_WIDTH_INCHES = 1.89; // 48mm in inches
const BYTES_PER_LINE = IMG_WIDTH / 8;

const PRINTER_COMMANDS = {
  INIT: Buffer.from([0x1b, 0x40]),
  JUSTIFY_CENTER: Buffer.from([0x1b, 0x61, 0x01]),
  JUSTIFY_LEFT: Buffer.from([0x1b, 0x61, 0x00]),
  PRINT_RASTER: Buffer.from([0x1d, 0x76, 0x30, 0x00]),
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

async function writeChunked(characteristic, data) {
  console.log("Writing chunked data");
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.slice(i, i + CHUNK_SIZE);
    await characteristic.writeAsync(Buffer.from(chunk), false);
    await delay(DELAY_BETWEEN_CHUNKS);
    console.log(`Wrote chunk ${i} of ${data.length}`);
  }
}

async function sendCommand(characteristic, command) {
  await characteristic.writeAsync(Buffer.from(command), false);
  await delay(DELAY_BETWEEN_CHUNKS); // Small delay after each command
}

async function printQRCode(data, characteristic) {
  try {
    await sendCommand(characteristic, PRINTER_COMMANDS.INIT);
    await sendCommand(characteristic, PRINTER_COMMANDS.JUSTIFY_CENTER);

    // QR Code function
    const qrCommand = [
      ...PRINTER_COMMANDS.QR_CODE,
      4, // pL
      0, // pH
      49, // cn (49 = QR Code)
      65, // fn (65 = Select model)
      50, // m (50 = model 2)
      0, // d1..dk = NULL (auto-select smallest size)
    ];
    await sendCommand(characteristic, qrCommand);

    // QR Code size
    const size = Math.min(8, Math.floor((IMG_WIDTH - 10) / 24)); // Max 8 or what fits the width
    const sizeCommand = [
      ...PRINTER_COMMANDS.QR_CODE,
      3, // pL
      0, // pH
      49, // cn
      67, // fn (67 = Set module size)
      size, // Size (1-8)
    ];
    await sendCommand(characteristic, sizeCommand);

    // QR Code data
    const dataBuffer = Buffer.from(data);
    const dataCommand = [
      ...PRINTER_COMMANDS.QR_CODE,
      dataBuffer.length + 3, // pL
      0, // pH
      49, // cn
      80, // fn (80 = Store symbol data in memory)
      48, // m (48 = Auto-increment memory address)
      ...dataBuffer,
    ];
    await sendCommand(characteristic, dataCommand);

    // Print QR Code
    const printCommand = [
      ...PRINTER_COMMANDS.QR_CODE,
      3, // pL
      0, // pH
      49, // cn
      81, // fn (81 = Print symbol data in memory)
      48, // m (48 = Auto-increment memory address)
    ];
    await sendCommand(characteristic, printCommand);

    await sendCommand(characteristic, [
      ...PRINTER_COMMANDS.PRINT_AND_FEED,
      0x04,
    ]);
    await sendCommand(characteristic, PRINTER_COMMANDS.FOOTER);
  } catch (error) {
    console.error("Error in printQRCode:", error);
    throw error;
  }
}

// STILL DOESN"T WORK
async function printText(text, characteristic) {
  try {
    await sendCommand(characteristic, PRINTER_COMMANDS.INIT);
    await sendCommand(characteristic, PRINTER_COMMANDS.TEXT_MODE);
    await sendCommand(characteristic, PRINTER_COMMANDS.LINE_SPACING);
    await sendCommand(characteristic, PRINTER_COMMANDS.JUSTIFY_LEFT);

    const textBuffer = Buffer.from(text + "\n");
    await characteristic.writeAsync(textBuffer, false);

    await sendCommand(characteristic, [
      ...PRINTER_COMMANDS.PRINT_AND_FEED,
      0x04,
    ]);
    await sendCommand(characteristic, PRINTER_COMMANDS.FOOTER);
  } catch (error) {
    console.error("Error in printText:", error);
    throw error;
  }
}

async function printTextImage(text, characteristic) {
  const printData = [];

  // Header
  printData.push(...PRINTER_COMMANDS.INIT, ...PRINTER_COMMANDS.JUSTIFY_CENTER);

  const textImage = await renderTextToImage(text, true);

  const { data, info } = textImage;
  const { width, height } = info;

  // Print raster bit image command
  printData.push(
    ...PRINTER_COMMANDS.PRINT_RASTER,
    width / 8,
    0x00,
    height & 0xff,
    (height >> 8) & 0xff
  );

  // Add image data
  for (let y = 0; y < height; y++) {
    const lineBuffer = new Uint8Array(width / 8);
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] === 0) {
        lineBuffer[Math.floor(x / 8)] |= 0x80 >> x % 8;
      }
    }
    printData.push(...lineBuffer);
  }

  // Footer
  printData.push(
    ...PRINTER_COMMANDS.PRINT_AND_FEED,
    0x02,
    ...PRINTER_COMMANDS.PRINT_AND_FEED,
    0x02,
    ...PRINTER_COMMANDS.FOOTER
  );

  // Send data to printer in chunks
  await writeChunked(characteristic, printData);
}

async function processImage(imagePath) {
  try {
    const image = await sharp(imagePath)
      .resize(IMG_WIDTH, null, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      // .sharpen()
      // .grayscale()
      // .normalize()
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

async function printImage(imagePath, characteristic) {
  try {
    const { data, info } = await processImage(imagePath);
    const { width, height } = info;

    console.log(`Processed image size: ${width}x${height}`);

    await characteristic.writeAsync(
      Buffer.from([
        ...PRINTER_COMMANDS.INIT,
        ...PRINTER_COMMANDS.JUSTIFY_CENTER,
        ...PRINTER_COMMANDS.SET_DENSITY,
      ]),
      false
    );

    const rasterHeader = [
      ...PRINTER_COMMANDS.PRINT_RASTER,
      width / 8,
      0x00,
      height & 0xff,
      (height >> 8) & 0xff,
    ];
    await characteristic.writeAsync(Buffer.from(rasterHeader), false);

    for (let y = 0; y < height; y++) {
      const lineBuffer = new Uint8Array(width / 8);
      for (let x = 0; x < width; x++) {
        if (data[y * width + x] === 0) {
          lineBuffer[Math.floor(x / 8)] |= 0x80 >> x % 8;
        }
      }
      await characteristic.writeAsync(Buffer.from(lineBuffer), false);
      await delay(DELAY_BETWEEN_CHUNKS);
    }

    await writeChunked(characteristic, [
      ...PRINTER_COMMANDS.PRINT_AND_FEED,
      0x04,
      ...PRINTER_COMMANDS.FOOTER,
    ]);

    // await characteristic.writeAsync(
    //   Buffer.from([
    //     ...PRINTER_COMMANDS.PRINT_AND_FEED,
    //     0x04,
    //     ...PRINTER_COMMANDS.FOOTER,
    //   ]),
    //   false
    // );
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
    await printImage("hello.png", writeCharacteristic);
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

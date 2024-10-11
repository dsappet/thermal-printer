const noble = require("@abandonware/noble");

const printerHeader = Buffer.from([
  0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1f, 0x11, 0x02, 0x04,
]);
const blockMarker = Buffer.from([0x1d, 0x76, 0x30, 0x00, 0x30, 0x00]);
const printerFooter = Buffer.from([
  0x1f, 0x11, 0x08, 0x1f, 0x11, 0x0e, 0x1f, 0x11, 0x07, 0x1f, 0x11, 0x09,
]);
const imagePadding = Buffer.from([0, 0, 0, 0]);

const bayerMatrix = [
  [1, 2],
  [3, 1],
];

const IMG_WIDTH = 384; // 48 bytes * 8 bits
const IMG_HEIGHT = 384; // Making it square for simplicity

// Create a simple square image
function createSquareImage() {
  const data = Buffer.alloc((IMG_WIDTH / 8) * IMG_HEIGHT, 0xff); // Start with all white
  const borderWidth = 5; // Width of the square border in pixels

  for (let y = 0; y < IMG_HEIGHT; y++) {
    for (let x = 0; x < IMG_WIDTH; x++) {
      // Check if we're on the border of the square
      if (
        x < borderWidth ||
        x >= IMG_WIDTH - borderWidth ||
        y < borderWidth ||
        y >= IMG_HEIGHT - borderWidth
      ) {
        const byteIndex = Math.floor((y * IMG_WIDTH) / 8 + x / 8);
        const bitIndex = 7 - (x % 8);
        data[byteIndex] &= ~(1 << bitIndex); // Set pixel to black
      }
    }
  }

  return {
    height: IMG_HEIGHT,
    data: data,
    params: [0, 2], // Example params
  };
}

async function printImage(data, characteristic) {
  await characteristic.write(printerHeader);

  for (let line = 0; line < data.height; line++) {
    await characteristic.write(blockMarker);
    await characteristic.write(Buffer.from([0x02, 0x00]));

    for (let lineRepeat = 0; lineRepeat < 2; lineRepeat++) {
      await characteristic.write(imagePadding);

      let lineBuffer = Buffer.alloc(IMG_WIDTH / 8);
      for (let lineByte = 0; lineByte < IMG_WIDTH / 8; lineByte++) {
        let originalPixels = data.data[line * (IMG_WIDTH / 8) + lineByte];
        let pixels = 0;

        for (let bit = 0; bit < 8; bit++) {
          let x = (lineByte * 8 + bit) % 2;
          let y = (line * 2 + lineRepeat) % 2;
          let originalBit = (originalPixels >> (7 - bit)) & 0x01;
          pixels |= originalBit < bayerMatrix[x][y] / 4 ? 0x00 : 0x80 >> bit;
        }

        lineBuffer[lineByte] = pixels;
      }
      const ESC = 0x1b;
      await characteristic.write(lineBuffer);
      await characteristic.write(imagePadding);
      await characteristic.write(Buffer.from([0x0a])); // Line feed
      await characteristic.write(Buffer.from([ESC, 0x64, 0x01]));
    }
  }

  await characteristic.write(
    Buffer.from([0x1b, 0x64, (data.params[1] & 0x0f) * 2])
  );
  await characteristic.write(printerFooter);
}

noble.on("stateChange", async (state) => {
  if (state === "poweredOn") {
    await noble.startScanningAsync([], false);
  }
});

noble.on("discover", async (peripheral) => {
  if (peripheral.advertisement.localName === "M02L") {
    await noble.stopScanningAsync();
    await peripheral.connectAsync();
    console.log("Connected successfully!");

    const { characteristics } =
      await peripheral.discoverAllServicesAndCharacteristicsAsync();
    const writeCharacteristic = characteristics.find((c) =>
      c.properties.includes("write")
    );

    if (writeCharacteristic) {
      const squareImage = createSquareImage();
      await printImage(squareImage, writeCharacteristic);
      console.log("Square image sent to printer");
    } else {
      console.log("No writable characteristic found");
    }

    // Wait for user input
    console.log('Press any key to continue...');
    await Bun.readableStreamToArray(Bun.stdin.stream());
    
    await peripheral.disconnectAsync();
    process.exit();
  }
});

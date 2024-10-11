import { Bluetooth } from "./escpos/bluetooth.js";
import iconv from "iconv-lite";

import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";

// This is the standard bluetooth address for the printer
const deviceAddress = "5F:83:BA:33:C6:9D";
const deviceName = "M02L"; //Local Name: M02L
const M02L_UUID = "ec1561328bfbe4d2c237cd992f0cf029"; //UUID: ec1561328bfbe4d2c237cd992f0cf029
const Q02_NAME = "MyQ-F22"; // This one is maybe jsut for discovery??
const Q02_UUID_DISCOVERY = "2bb3691ec1f956de708f532a9fce144a";
const Q02_UUID = "6c583b8ed28e786bf821ed5367d64481"; //Local Name: Q02
const deviceUUID = M02L_UUID;

// UUID is used for BLE (bluetooth low energy) and the noble library only works for BLE
// The device itself has both BLE and classic bluetooth
const bluetooth = new Bluetooth(deviceUUID);
// ESC/POS commands in Buffer format
const FF = 0x0c;
const NAK = 0x15;
const CAN = 0x18;
const ESC = 0x1b;
const GS = 0x1d;
const US = 0x1f;
const LF = 0x0a;
// const EOL = new Uint8Array([LF]); // End-of-Line character
const ESC_POS_INIT = [ESC, 0x40]; // Buffer.from([0x1b, 0x40]); // ESC @ (initialize)
const ESC_POS_FEED = [ESC, 0x0a]; // Buffer.from([0x0a]); // Line feed (LF)
const ESC_POS_CUT = Buffer.from([0x1d, 0x56, 0x00]); // Cut paper (GS V 0)

const header = [0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1f, 0x11, 0x02, 0x04];
const blockmarker = [0x1d, 0x76, 0x30, 0x00, 0x30, 0x00, 0xff, 0x00];
const textToPrint = "Hello Printer\n";
const footer = [
  0x1b, 0x64, 0x02, 0x1b, 0x64, 0x02, 0x1f, 0x11, 0x08, 0x1f, 0x11, 0x0e, 0x1f,
  0x11, 0x07, 0x1f, 0x11, 0x09,
];

// Command to get the printer's status (like US 0x11 0x0E)
const GET_TIMER_STATUS_COMMAND = new Uint8Array([0x1f, 0x11, 0x0e]);

try {
  await bluetooth.open();
  console.log("Connected to device.");

  // await bluetooth.write(new Uint8Array([ESC, 0x40, 0x02])); // reset
  // await bluetooth.write(new Uint8Array([ESC, 0x40])); // initialize
  let encoder = new ReceiptPrinterEncoder({ language: "esc-pos" }); // 'esc-pos' 'star-prnt' 'star-line'

  // let result = encoder
  //   .codepage("auto")
  //   .initialize()
  //   .text("hello world")
  //   // .newline(2)
  //   // .ercode("https://foobar.com")
  //   .raw([0x1b, 0x54, 0x00]) // # ESC T 0 (default table))
  //   .raw([0x1b, 0x21, 0x30]) //  # ESC ! 48 (bold + double width)
  //   .raw(["h", "e", "l", "l", "o", " ", "w", "o", "r", "l", "d"])
  //   .raw([0x1b, 0x4a, 0x10])
  //   .raw([ESC, 0x64, 0x01]) // this newline works
  //   .text("hello world")
  //   .raw([ESC, 0x64, 0x01]) // this newline works
  //   .raw([ESC, 0x64, 0x01]) // this newline works
  //   .encode();
  // let result = encoder
  //   .initialize()
  //   // Test 1: Basic text command
  //   .text("Test 1: Basic text")
  //   .raw([ESC, 0x64, 0x01]) // this newline works
  //   .raw([ESC, 0x64, 0x01]) // this newline works
  //   .raw([LF, LF])
  //   // Test 2: Raw byte text
  //   .raw([
  //     0x54, 0x65, 0x73, 0x74, 0x20, 0x32, 0x3a, 0x20, 0x52, 0x61, 0x77, 0x20,
  //     0x62, 0x79, 0x74, 0x65, 0x73,
  //   ]) // "Test 2: Raw bytes"
  //   .raw([LF, LF])
  //   // Test 3: Text with explicit encoding
  //   .raw([ESC, 0x74, 0x00]) // Select character code table (0 = PC437)
  //   .text("Test 3: Explicit encoding (PC437)")
  //   .raw([LF, LF])
  //   // Test 4: Text with different print modes
  //   .raw([ESC, 0x21, 0x00]) // Normal text
  //   .text("Test 4a: Normal")
  //   .raw([LF])
  //   .raw([ESC, 0x21, 0x08]) // Emphasized
  //   .text("Test 4b: Emphasized")
  //   .raw([LF])
  //   .raw([ESC, 0x21, 0x10]) // Double-height
  //   .text("Test 4c: Double-height")
  //   .raw([LF])
  //   .raw([ESC, 0x21, 0x20]) // Double-width
  //   .text("Test 4d: Double-width")
  //   .raw([LF, LF])
  //   // Test 5: Bit image mode (prints "Hi" in large letters)
  //   .raw([
  //     ESC,
  //     0x2a,
  //     0x01,
  //     0x08,
  //     0x00,
  //     0b11111000,
  //     0b00011000,
  //     0b00011000,
  //     0b11111000,
  //     0b00000000,
  //     0b11111100,
  //     0b00110000,
  //     0b00110000,
  //     0b11111000,
  //     0b00011000,
  //     0b00011000,
  //     0b11111000,
  //     0b00000000,
  //     0b11111100,
  //     0b00110000,
  //     0b00110000,
  //   ])
  //   .raw([LF, LF])
  //   .raw([ESC, 0x64, 0x02]) // this newline works
  //   .encode();

  // let result = encoder
  //   .initialize()
  //   // Test 1: Line feed then text
  //   .raw([ESC, 0x64, 0x01])
  //   .text("Test 1: After line feed")
  //   .raw([ESC, 0x64, 0x01])
  //   // Test 2: Text as raw bytes
  //   .raw([ESC, 0x64, 0x01])
  //   .raw([
  //     0x54, 0x65, 0x73, 0x74, 0x20, 0x32, 0x3a, 0x20, 0x52, 0x61, 0x77, 0x20,
  //     0x62, 0x79, 0x74, 0x65, 0x73,
  //   ])
  //   .raw([ESC, 0x64, 0x01])
  //   // Test 3: Line feed, select character code table, then text
  //   .raw([ESC, 0x64, 0x01])
  //   .raw([ESC, 0x74, 0x00]) // Select character code table (0 = PC437)
  //   .text("Test 3: After character table selection")
  //   .raw([ESC, 0x64, 0x01])
  //   // Test 4: Line feed, text mode, then text
  //   .raw([ESC, 0x64, 0x01])
  //   .raw([ESC, 0x21, 0x00]) // Normal text mode
  //   .text("Test 4: Normal text mode")
  //   .raw([ESC, 0x0, 0x0])
  //   .raw([0x0, 0x0, 0x0])
  //   .raw([ESC, 0x64, 0x01])
  //   // Test 5: Multiple line feeds to ensure visibility
  //   .text("Test 5: Multiple line feeds")
  //   .raw([ESC, 0x64, 0x01]) // 5 line feeds
  //   .encode();

  // console.log(result);
  let result = encoder
    .initialize()
    .raw([
      0x1b,
      0x40, // Initialize printer
      0x1b,
      0x61,
      0x01, // Center justification
    ])
    .qrcode("https://google.com", {
      ecLevel: "M",
      model: 1,
      size: 4,
    })
    .raw([ESC, 0x64, 0x01])
    .newline(2)
    .encode();

  const writeCharacteristic = await bluetooth.write(result);
  // await bluetooth.write(new Uint8Array([ESC, 0x61, 0x01])); // align center
  // // Example: Sending the GS r 1 command to request the printer's status
  // const GS = 0x1d;
  // const statusCommand = new Uint8Array([GS, 0x72, 0x01]); // GS r 1 (Request printer status)
  // await bluetooth.write(statusCommand);
  // console.log("wrote status command");
  // await bluetooth.write(new Uint8Array([LF]));
  // console.log("wrote LF");
  // const TEXT_TO_PRINT = "Hello, World!\n"; // The text you want to print
  // await bluetooth.write(TEXT_TO_PRINT);
  // await bluetooth.writeText(TEXT_TO_PRINT);
  // // await bluetooth.writeCharacteristic.writeAsync(
  // //   Buffer.from(TEXT_TO_PRINT, "ascii"),
  // //   false
  // // );
  // // bluetooth.emit("write", TEXT_TO_PRINT);
  // console.log("wrote text");
  // await bluetooth.write(new Uint8Array([ESC, LF]));
  // console.log("wrote LF 2");

  // This line feed works to scroll the paper
  // await bluetooth.write(new Uint8Array([ESC, 0x64, 0x01])); // feed line (the last byte is the number of lines to feed (5 lines, editable))
  // console.log("wrote feed line");

  // Define a text command (this is ASCII mode; different encodings may need different values for `n`)
  // const PRINT_TEXT_COMMAND = new Uint8Array([ESC, 0x40]); // ESC @ (initialize)
  // const LINE_FEED = new Uint8Array([0x0a]); // Line feed (move to next line)
  // Step 1: Send initialize command to reset the printer state
  // await bluetooth.write(PRINT_TEXT_COMMAND);
  // const TEXT_MODE_COMMAND = new Uint8Array([ESC, 0x21, 0x00]); // ESC ! 0x00 to set normal text mode
  // await bluetooth.write(TEXT_MODE_COMMAND);
  // const SET_UTF8_ENCODING_COMMAND = new Uint8Array([ESC, 0x74, 0x10]); // ESC t 0x10 for UTF-8
  // const SET_GB18030_ENCODING_COMMAND = new Uint8Array([ESC, 0x74, 0x01]); // ESC t 0x01 for GB18030
  // await bluetooth.write(SET_GB18030_ENCODING_COMMAND);
  // Step 2: Send the actual text as bytes to the printer

  // const textBuffer = iconv.encode("hello world", "gb18030");
  // console.log(textBuffer);
  // await writeCharacteristic.writeAsync(textBuffer, false);
  // await bluetooth.writeText("hello world\n");
  // console.log("wrote text");
  // await bluetooth.write([LF]); // Line feed - which one?
  // await bluetooth.write(new Uint8Array([LF])); // Line feed
  // await bluetooth.write(new Uint8Array([ESC, 0x64, 0x03])); // feed line
  // await bluetooth.write(new Uint8Array([ESC, 0x64, 0x03])); // feed line
  // await bluetooth.write(new Uint8Array([ESC, 0x64, 0x03])); // feed line

  // Initialize the printer
  // const ESC_POS_INIT = [ESC, 0x40]; // ESC @ (initialize)
  // const PRINT_IMAGE_CMD = [GS, 0x76, 0x30, 0x00]; // GS v 0 (raster bit image print mode)

  // const oneLineImage = new Uint8Array([
  //   0b11111111, // Black pixels
  // ]);
  // // const oneLineImage = new Uint8Array([
  // //   0b11111111, // First row: Black pixels
  // //   0b00000000, // Second row: White pixels
  // //   0b11111111, // Third row: Black pixels
  // // ]);
  // // Image dimensions
  // const imageWidthInBytes = 10; // 1 byte (8 pixels wide)
  // const imageHeightInBits = 1; // 1 pixel high (1 row)

  // // Define the image width and height for the command
  // const imageWidthLowByte = imageWidthInBytes & 0xff;
  // const imageWidthHighByte = (imageWidthInBytes >> 8) & 0xff;
  // const imageHeightLowByte = imageHeightInBits & 0xff;
  // const imageHeightHighByte = (imageHeightInBits >> 8) & 0xff;

  // // const imageHeightInBits = 3; // 3 pixels high
  // // Step 1: Initialize printer
  // // await bluetooth.write(new Uint8Array(ESC_POS_INIT)); // Initialize printer

  // // Step 2: Send the command to print the raster image
  // // await bluetooth.write(new Uint8Array(PRINT_IMAGE_CMD)); // Start raster image mode
  // // await bluetooth.write(
  // // new Uint8Array([imageWidthLowByte, imageWidthHighByte])
  // // ); // Set image width
  // // await bluetooth.write(
  // //   new Uint8Array([imageHeightLowByte, imageHeightHighByte])
  // // ); // Set image height
  // // await bluetooth.write(oneLineImage); // Send the image data

  // // // Step 3: Send line feed to move to the next line
  // // await bluetooth.write(new Uint8Array([LF])); // Line feed

  // // console.log("Image printed successfully.");

  // await bluetooth.write(new Uint8Array([US, 0x11, 0x0e])); // get device timer
  await pollForPrinterCompletion(writeCharacteristic);
  // await bluetooth.write([...header, ...blockmarker, textToPrint, ...footer]);
  // await bluetooth.write(blockmarker);
  // await bluetooth.write(footer);
  // Combine ESC/POS commands and text
  // await bluetooth.write(ESC_POS_INIT);
  // await bluetooth.write(textToPrint);
  // await bluetooth.write(ESC_POS_FEED);
  // await bluetooth.write(ESC_POS_CUT);
  // const dataToSend = Buffer.concat([
  //   ESC_POS_INIT, // Initialize printer
  //   Buffer.from(textToPrint), // Print text
  //   ESC_POS_FEED, // Line feed
  //   ESC_POS_CUT, // Cut paper
  // ]);

  // // Write data to the printer
  // await bluetooth.write(dataToSend);
  console.log("Data written successfully.");

  // Optionally close the connection
  await bluetooth.close();
  console.log("Connection closed.");
} catch (err) {
  console.error("An error occurred:", err);
}

// Exit the program
process.exit(0);

async function pollForPrinterCompletion(characteristic) {
  return new Promise((resolve) => {
    characteristic.on("data", (data, isNotification) => {
      const timerValue = data[2]; // Assuming the 3rd byte contains the timer value like in your previous code
      console.log(`Received timer value: ${timerValue}`);

      if (timerValue === 0) {
        console.log("Printing completed");
        resolve();
      }
    });

    // Enable notifications to listen for responses
    characteristic.subscribe((error) => {
      if (error) {
        console.error("Error enabling notifications:", error);
      } else {
        console.log("Waiting for timer response...");
      }
    });
  });
}

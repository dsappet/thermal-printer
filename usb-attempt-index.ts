import escpos from "escpos";
import { Bluetooth } from "escpos";
// import usb from "escpos-usb";
// import { usb, getDeviceList } from "usb";

const devices: usb.Device[] = getDeviceList();
console.log(devices);

const VENDOR_ID = 11652;
const PRODUCT_ID = 9067;

const deviceUUID = "ec1561328bfbe4d2c237cd992f0cf029"; //UUID: ec1561328bfbe4d2c237cd992f0cf029

// Select your printer's device (it auto-detects USB thermal printers)
// const device = new usb(VENDOR_ID, PRODUCT_ID);
// const device = usb.findByIds(VENDOR_ID, PRODUCT_ID);
// console.log("device");
// // Create the printer instance
// const printer = new escpos.Printer(device);
// console.log("printer");
// // Open the device, initialize, and print
// device.open();
// console.log("device.open");

// printer
//   .initialize() // Initialize printer
//   .align("ct") // Align text to center
//   .text("Hello, World!") // Print text
//   .cut() // Cut paper
//   .close(); // Close connection

// import escpos from 'escpos';
// import USBAdapter from 'escpos-usb';  // Import escpos USB adapter

// const VENDOR_ID = 11652;
// const PRODUCT_ID = 9067;
// const SERIAL_NUMBER = "281PA241290195";

// // Find the USB device based on vendor and product IDs
// const device = new USBAdapter(VENDOR_ID, PRODUCT_ID);

// // Define printer options
// const options = { encoding: "GB18030" };  // Optional encoding

// // Create the printer object using the USB device
// const printer = new escpos.Printer(device, options);

// // Open the USB connection to the printer
// device.open((error) => {
//   if (error) {
//     console.error('Error opening USB device:', error);
//     return;
//   }

//   // Start printing
//   printer
//     .font('a')           // Set font 'a'
//     .align('ct')         // Align text center
//     .style('bu')         // Bold + underline style
//     .size(1, 1)          // Normal size text
//     .text('The quick brown fox jumps over the lazy dog')  // Print text
//     .text('敏捷的棕色狐狸跳过懒狗')                        // Print Chinese text
//     .barcode('1234567', 'EAN8')  // Print barcode
//     .table(["One", "Two", "Three"])  // Print table
//     .tableCustom(  // Custom table with alignments
//       [
//         { text: "Left", align: "LEFT", width: 0.33, style: 'B' },
//         { text: "Center", align: "CENTER", width: 0.33 },
//         { text: "Right", align: "RIGHT", width: 0.33 }
//       ],
//       { encoding: 'cp857', size: [1, 1] }  // Optional encoding for the table
//     )
//     .qrimage('https://github.com/song940/node-escpos', function (err) {
//       if (err) {
//         console.error('Error printing QR code:', err);
//         return;
//       }

//       // After QR code, cut the paper
//       this.cut();

//       // Close the printer connection
//       this.close(() => {
//         console.log('Print job complete, printer connection closed.');
//       });
//     });
// });

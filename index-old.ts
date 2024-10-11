console.log("Hello via Bun!");

import usb from "usb";

const SERIAL_NUMBER = "281PA241290195";
const VENDOR_ID = 11652;
const PRODUCT_ID = 9067;
const VERBOSE = process.env.VERBOSE === "true" ? true : false;

const device = usb.findByIds(VENDOR_ID, PRODUCT_ID);
console.log("device found");
if (!device) {
  console.log("Device not found");
  process.exit(0);
}

device.open();

// Assume the device has an interface (usually interface[0])
const iface = device.interfaces[0];

// console.log(iface);

//       // Claim the interface before interacting with the device
iface.claim();

// Try selecting an alternate setting if available
iface.setAltSetting(0, (err) => {
  if (err) throw err;
});

//       // Your interaction code with the device goes here

// Find the correct endpoint
if (VERBOSE === true) {
  iface.endpoints.forEach((ep) => {
    console.log(ep);
  });
}

const endpoint = iface.endpoints.find((ep) => ep.direction === "out");

const endpointIn = iface.endpoints.find((ep) => ep.direction === "in");

// Function to send data to the printer
function sendToPrinter(data) {
  return endpoint.transferAsync(data);
  // return new Promise((resolve, reject) => {
  //   endpoint.transfer(data, (err) => {
  //     if (err) {
  //       return reject(err);
  //     }
  //     resolve();
  //   });
  // });
}

// Function to read status from printer
function readPrinterStatus() {
  return new Promise((resolve, reject) => {
    endpointIn.transfer(4, (data, err) => {
      // Assuming 4-byte response
      if (err) {
        return reject(err);
      }
      resolve(data);
    });
  });
}
// try {
//   // Send real-time printer status request (DLE EOT 1 - Printer status)
//   const statusRequestCommand = Buffer.from([0x10, 0x04, 0x01]); // Request printer status
//   await sendToPrinter(statusRequestCommand);

//   // Read and print the status response
//   const statusResponse = await readPrinterStatus();
//   console.log("BP81 Printer Status:", statusResponse);
// } catch (err) {
//   console.error("Error: ", err);
// }

// Initialize the printer (ESC/POS Initialize command)
const initializeCommand = Buffer.from([0x1b, 0x40]);
await sendToPrinter(initializeCommand);
console.log("initialized");

await new Promise((resolve) => setTimeout(resolve, 500));

// Print a line of text
const text = "Hello, World!\n";
const encodedText = Buffer.from(text, "ascii");
await sendToPrinter(encodedText);
console.log("printed text");

await new Promise((resolve) => setTimeout(resolve, 500));

// Optionally add line feed (ESC/POS newline command)
const lineFeed = Buffer.from([0x0a]);
await sendToPrinter(lineFeed);
console.log("printed line feed");

await new Promise((resolve) => setTimeout(resolve, 500));

//       // Release the interface after you're done
// const releaseInterfaceAsync = (iface) => {
//   return new Promise((resolve, reject) => {
//     iface.release(true, (err) => {
//       if (err) {
//         reject(err);
//       } else {
//         resolve();
//       }
//     });
//   });
// };

const closeDeviceAsync = (device) => {
  return new Promise((resolve, reject) => {
    device.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};
setTimeout(() => {
  (async () => {
    try {
      await iface.releaseAsync();
      // await releaseInterfaceAsync(iface);
      console.log("Interface released successfully");
      await closeDeviceAsync(device);
      console.log("Device closed successfully");
    } catch (err) {
      console.error("Error:", err);
    }
  })();
}, 2000);

/////////////////////////////////////////

// import escpos from 'escpos';
// install escpos-usb adapter module manually
// import escposUsb from 'escpos-usb';
// escpos.USB = escposUsb;

// Select the adapter based on your printer type
// const device  = new escpos.USB(VENDOR_ID, PRODUCT_ID);
// Find the USB device based on vendor and product IDs
// const device = new usb.Device(VENDOR_ID, PRODUCT_ID);

// const device  = new escpos.Network('localhost');
// const device  = new escpos.Serial('/dev/usb/lp0');

// const options = { encoding: "GB18030" /* default */ }
// // encoding is optional

// const printer = new escpos.Printer(foundDevice, options);

// foundDevice.open(function(error){
//   printer
//   .font('a')
//   .align('ct')
//   .style('bu')
//   .size(1, 1)
//   .text('The quick brown fox jumps over the lazy dog')
//   .text('敏捷的棕色狐狸跳过懒狗')
//   .barcode('1234567', 'EAN8')
//   .table(["One", "Two", "Three"])
//   .tableCustom(
//     [
//       { text:"Left", align:"LEFT", width:0.33, style: 'B' },
//       { text:"Center", align:"CENTER", width:0.33},
//       { text:"Right", align:"RIGHT", width:0.33 }
//     ],
//     { encoding: 'cp857', size: [1, 1] } // Optional
//   )
//   .qrimage('https://github.com/song940/node-escpos', function(err){
//     this.cut();
//     this.close();
//   });
// });

// const promises = devices.map(async (device) => {
//   // Open the device to access descriptors
//   device.open();

//   // Get the device descriptor
//   const descriptor = device.deviceDescriptor;

//   // console.log(
//   //   `Device Vendor ID: ${descriptor.idVendor}, Product ID: ${descriptor.idProduct}`
//   // );

//   // Fetch manufacturer, product, and serial number

//   try {
//     const manufacturer = await getStringDescriptorAsync(
//       device,
//       descriptor.iManufacturer
//     );
//     // console.log(`Manufacturer: ${manufacturer}`);
//   } catch (err) {
//     console.error("Error getting manufacturer:", err);
//   }

//   try {
//     const product = await getStringDescriptorAsync(device, descriptor.iProduct);
//     // console.log(`Product: ${product}`);
//   } catch (err) {
//     console.error("Error getting product name:", err);
//   }

//   try {
//     const serialNumber = await getStringDescriptorAsync(
//       device,
//       descriptor.iSerialNumber
//     );
//     // console.log(`Serial Number: ${serialNumber}`);
//     if (serialNumber === SERIAL_NUMBER) {
//       console.log(`Found Device With Serial Number: ${serialNumber}`);
//       console.log(
//         `Device Vendor ID: ${descriptor.idVendor}, Product ID: ${descriptor.idProduct}`
//       );
//       foundDevice = device;
//     }
//   } catch (err) {
//     console.error("Error getting serial number:", err);
//   }

//   device.close();
// });

// await Promise.allSettled(promises);

// Iterate through each connected device
// devices.forEach(device => {
//   // Open the device to access descriptors
//   device.open();

//   // Get the device descriptor
//   const descriptor = device.deviceDescriptor;

//   // Retrieve the serial number string descriptor
//   device.getStringDescriptor(descriptor.iSerialNumber, (err, serialNumber) => {
//     if (err) {
//       console.error('Error retrieving serial number:', err);
//       // Close the device if there's an error
//       device.close();
//     } else if (serialNumber === SERIAL_NUMBER) {
//       console.log(`Device found with serial number: ${serialNumber}`);
//       foundDevice = device;  // Store the matching device

//       // Print the vendor and product ID
//       console.log(`Vendor ID: ${descriptor.idVendor}, Product ID: ${descriptor.idProduct}`);

//       // Assume the device has an interface (usually interface[0])
//       const iface = device.interfaces[0];

//       // Claim the interface before interacting with the device
//       iface.claim();

//       // Your interaction code with the device goes here

//       // Release the interface after you're done
//       iface.release(true, err => {
//         if (err) {
//           console.error('Error releasing interface:', err);
//         } else {
//           console.log('Interface released successfully');
//         }

//         // Finally, close the device
//         device.close();
//         console.log('Device closed successfully');
//       });
//     } else {
//       console.log(`Serial number: ${serialNumber} does not match`);
//       // Close the device if it's not the target device
//       device.close();
//     }
//   });
// });

// Example of how to open and communicate with a device
// const printer = devices.find(
//   (device) => device.deviceDescriptor.idVendor === YOUR_VENDOR_ID
// );
// // const printer = devices.find(device => device.deviceDescriptor.idVendor === YOUR_VENDOR_ID);

// if (printer) {
//   printer.open();
//   const i = printer.interfaces[0];
//   i.claim();

//   const endpoint = i.endpoints[0];
//   endpoint.transfer(Buffer.from("Hello Printer!"), (err) => {
//     if (err) console.error("Error writing to printer:", err);
//     else console.log("Message sent to printer.");
//   });
// } else {
//   console.log("Printer not found.");
// }

import noble from "@abandonware/noble";
import { connectToPrinter } from "./bluetooth";
async function exploreFlowControl(
  peripheral: noble.Peripheral,
  characteristic: noble.Characteristic
) {
  try {
    // Get the current MTU
    console.log("Attempting to get MTU...");
    // @ts-ignore - mtu exists but isn't in types
    const currentMtu = peripheral.mtu || "unknown";
    console.log(`Current MTU: ${currentMtu}`);

    // Try to request a larger MTU
    console.log("\nAttempting to request larger MTU...");
    try {
      // @ts-ignore - exchangeMtu exists but isn't in types
      await peripheral.exchangeMtuAsync(512);
      // @ts-ignore
      console.log(`New MTU: ${peripheral.mtu}`);
    } catch (error) {
      console.log("MTU negotiation not supported or failed:", error);
    }

    // Get write properties
    console.log("\nCharacteristic properties:");
    console.log(characteristic.properties);

    // Check write types supported
    if (characteristic.properties.includes("write")) {
      console.log("Supports Write With Response");
    }
    if (characteristic.properties.includes("writeWithoutResponse")) {
      console.log("Supports Write Without Response");
    }

    // Get maximum write length
    // @ts-ignore - maxWriteLength exists but isn't in types
    const maxWrite = characteristic.maxWriteLength || "unknown";
    console.log(`\nMaximum write length: ${maxWrite}`);

    // Test different write modes
    const testData = Buffer.from([0x1b, 0x40]); // Simple init command

    console.log("\nTesting write with response...");
    try {
      await characteristic.writeAsync(testData, true);
      console.log("Write with response succeeded");
    } catch (error) {
      console.log("Write with response failed:", error);
    }

    console.log("\nTesting write without response...");
    try {
      await characteristic.writeAsync(testData, false);
      console.log("Write without response succeeded");
    } catch (error) {
      console.log("Write without response failed:", error);
    }
  } catch (error) {
    console.error("Error during flow control exploration:", error);
  }
}

async function main() {
  try {
    console.log("Connecting to printer...");
    const { peripheral, writeCharacteristic } = await connectToPrinter();

    console.log("\nExploring flow control options...");
    await exploreFlowControl(peripheral, writeCharacteristic);

    console.log("\nPress Enter to disconnect...");
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

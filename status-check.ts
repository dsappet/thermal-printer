import noble from "@abandonware/noble";
import { connectToPrinter } from "./bluetooth";

async function testPrinterStatus(characteristic: noble.Characteristic) {
  // Extended set of status commands to try
  const statusCommands = [
    // Standard ESC/POS commands
    {
      name: "Get Status (GS r)",
      command: Buffer.from([0x1D, 0x72, 0x01]),
      description: "Common on many ESC/POS printers"
    },
    {
      name: "Get Status (GS r n=2)",
      command: Buffer.from([0x1D, 0x72, 0x02]),
      description: "Offline status query"
    },
    {
      name: "Get Status (ESC u)",
      command: Buffer.from([0x1B, 0x75, 0x00]),
      description: "Transmit peripheral status"
    },
    {
      name: "Get Status (ESC S)",
      command: Buffer.from([0x1B, 0x53]),
      description: "Simple status request"
    },
    // Alternative versions
    {
      name: "Status Request (GS I)",
      command: Buffer.from([0x1D, 0x49, 0x01]),
      description: "Printer ID request"
    },
    {
      name: "Status Request (GS I n=49)",
      command: Buffer.from([0x1D, 0x49, 0x31]),
      description: "Printer info request"
    },
    // Common vendor-specific
    {
      name: "Status Request (FS ?)",
      command: Buffer.from([0x1C, 0x3F]),
      description: "Vendor specific status"
    },
    {
      name: "Extended Status (DC3)",
      command: Buffer.from([0x13]),
      description: "Simple DC3 status request"
    },
    // Paper status specific
    {
      name: "Paper Status (ESC t)",
      command: Buffer.from([0x1B, 0x74]),
      description: "Paper sensor status"
    },
    // More exotic ones that sometimes work
    {
      name: "Multi-status request",
      command: Buffer.from([0x1D, 0x61, 0xFF]),
      description: "Request all status types"
    }
  ];

  // Set up notification handler with more detailed logging
  console.log("Setting up notification handler...");
  let notificationCount = 0;
  
  characteristic.on('notify', (data: Buffer) => {
    notificationCount++;
    console.log(`\nNotification #${notificationCount} received:`);
    console.log('Raw data:', data);
    console.log('Hex data:', data.toString('hex'));
    console.log('Binary:', Array.from(data).map(b => b.toString(2).padStart(8, '0')).join(' '));
    
    // Try to interpret common status bits
    if (data.length > 0) {
      console.log('Status interpretation attempt:');
      const firstByte = data[0];
      console.log('- Drawer kick-out: ' + ((firstByte & 0x04) ? 'Open' : 'Closed'));
      console.log('- Online: ' + ((firstByte & 0x08) ? 'Yes' : 'No'));
      console.log('- Error: ' + ((firstByte & 0x40) ? 'Yes' : 'No'));
      console.log('- Paper out: ' + ((firstByte & 0x20) ? 'Yes' : 'No'));
    }
  });

  // Enable notifications
  try {
    console.log("Enabling notifications...");
    await characteristic.subscribeAsync();
    console.log("Notifications enabled successfully");
  } catch (error) {
    console.log("Failed to enable notifications:", error);
  }

  // Test each command with delays between attempts
  for (const test of statusCommands) {
    console.log(`\n=== Testing ${test.name} ===`);
    console.log(`Description: ${test.description}`);
    console.log(`Command hex: ${test.command.toString('hex')}`);
    
    try {
      // Try with write with response
      console.log("Attempting write with response...");
      await characteristic.writeAsync(test.command, true);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Try without response
      console.log("Attempting write without response...");
      await characteristic.writeAsync(test.command, false);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Try sequence with initialize first
      console.log("Attempting with initialization sequence...");
      const initCommand = Buffer.from([0x1B, 0x40]); // ESC @
      await characteristic.writeAsync(initCommand, false);
      await new Promise(resolve => setTimeout(resolve, 100));
      await characteristic.writeAsync(test.command, false);
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.log(`Error during ${test.name}:`, error);
    }
  }
}

async function main() {
  try {
    console.log("Connecting to printer...");
    const { peripheral, writeCharacteristic } = await connectToPrinter();
    
    console.log("Starting extended status tests...");
    await testPrinterStatus(writeCharacteristic);
    
    console.log("\nAll tests completed. Press Enter to disconnect...");
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
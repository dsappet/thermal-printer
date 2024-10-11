import { EventEmitter } from "events";
import noble from "@abandonware/noble";
import iconv from "iconv-lite";

export class Bluetooth extends EventEmitter {
  address: string;
  peripheral: any;
  readCharacteristic: any;
  writeCharacteristic: any;
  notifyCharacteristic: any;

  constructor(address: string) {
    super();
    this.address = address;
    this.peripheral = null; // Store the connected peripheral
  }

  /**
   * Open a connection to the Bluetooth device
   * @return {Promise} Resolves when the connection is established
   */
  async open() {
    return new Promise((resolve, reject) => {
      noble.on("stateChange", async (state) => {
        if (state === "poweredOn") {
          await noble.startScanningAsync([], false); // Start scanning for any devices
        } else {
          noble.stopScanning();
          reject(new Error("Bluetooth adapter is not powered on."));
        }
      });

      // Discover the peripheral (device)
      noble.on("discover", async (peripheral) => {
        console.log(`Peripheral discovered:`);
        console.log(`UUID: ${peripheral.id}`); // UUID of the peripheral (this acts as an identifier)
        console.log(
          `Local Name: ${peripheral.advertisement.localName || "Unknown"}`
        ); // Display name of the peripheral (if available)
        console.log(`RSSI: ${peripheral.rssi}`); // Signal strength

        if (
          peripheral.address === this.address ||
          peripheral.id === this.address
        ) {
          await noble.stopScanningAsync(); // Stop scanning once the device is found
          this.peripheral = peripheral; // Store the peripheral for later use

          try {
            // Connect to the device
            await peripheral.connectAsync();
            // console.log(`Connected to device: ${peripheral}`);
            console.log("Connected to device");

            //       const all = await this.peripheral.discoverAllServicesAndCharacteristicsAsync();
            // console.log("All:", all);

            // Update RSSI (signal strength)
            const rssi = await peripheral.updateRssiAsync();
            console.log(`Signal strength (RSSI): ${rssi}`);

            // Discover services
            const services = await peripheral.discoverServicesAsync([]);
            for (const service of services) {
              const characteristics =
                await service.discoverCharacteristicsAsync([]);

              // Find a readable characteristic
              this.readCharacteristic = characteristics.find((char) =>
                char.properties.includes("read")
              );
              // Create a listener for the read characteristic
              this.readCharacteristic?.on("data", (data) => {
                console.log(`Received read data: ${data}`);
                this.emit("data", data);
              });
              // Find a notification characteristic
              this.notifyCharacteristic = characteristics.find((char) =>
                char.properties.includes("notify")
              );
              // Create a listener for the notification characteristic
              this.notifyCharacteristic?.on("data", (data) => {
                console.log(`Received notification: ${data}`);
                this.emit("notify", data);
              });
              // Find a writable characteristic
              this.writeCharacteristic = characteristics.find((char) =>
                char.properties.includes("write")
              );
            }

            this.emit("connect", peripheral); // Emit connect event
            resolve(this.writeCharacteristic);
          } catch (err) {
            reject(err);
          }
        }
      });
    });
  }

  /**
   * Write data to the Bluetooth device
   * @param {Buffer | string} data Data to write to the device
   * @return {Promise} Resolves when the write operation is complete
   */
  async write(data) {
    if (!this.peripheral) {
      throw new Error("No device is connected.");
    }

    try {
      // Discover services and characteristics
      const services = await this.peripheral.discoverServicesAsync([]);
      // console.log("Services:", services);
      for (const service of services) {
        const characteristics = await service.discoverCharacteristicsAsync([]);

        // Find a writable characteristic
        const writeCharacteristic = characteristics.find((char) =>
          char.properties.includes("write")
        );

        if (writeCharacteristic) {
          await writeCharacteristic.writeAsync(Buffer.from(data), false);
          // await writeCharacteristic.writeAsync(data, false);
          // const textBuffer = iconv.encode(data, "gb18030");
          // await writeCharacteristic.writeAsync(textBuffer, false);
          console.log("Data written to device");
          this.emit("write", data);
          return writeCharacteristic;
        }
      }

      throw new Error("No writable characteristic found.");
    } catch (err) {
      throw err;
    }
  }

  async writeText(data) {
    if (!this.peripheral) {
      throw new Error("No device is connected.");
    }

    try {
      // Discover services and characteristics
      const services = await this.peripheral.discoverServicesAsync([]);
      // console.log("Services:", services);
      for (const service of services) {
        const characteristics = await service.discoverCharacteristicsAsync([]);

        // Find a writable characteristic
        const writeCharacteristic = characteristics.find((char) =>
          char.properties.includes("write")
        );

        if (writeCharacteristic) {
          // await writeCharacteristic.writeAsync(
          //   Buffer.from(data),
          //   false
          // );
          const textBuffer = iconv.encode(data, "gb18030");
          await writeCharacteristic.writeAsync(textBuffer, false);
          console.log("Data written to device");
          this.emit("write", data);
          return writeCharacteristic;
        }
      }

      throw new Error("No writable characteristic found.");
    } catch (err) {
      throw err;
    }
  }

  /**
   * Close the connection to the Bluetooth device
   * @return {Promise} Resolves when the connection is closed
   */
  async close() {
    if (!this.peripheral) {
      throw new Error("No device is connected.");
    }

    try {
      await this.peripheral.disconnectAsync();
      console.log("Disconnected from device.");
      this.emit("disconnect", this.peripheral);
      this.peripheral = null;
    } catch (err) {
      throw err;
    }
  }
}

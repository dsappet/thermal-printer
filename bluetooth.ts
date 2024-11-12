import noble from "@abandonware/noble";

export async function connectToPrinter() {
  return new Promise((resolve, reject) => {
    noble.on("stateChange", async (state) => {
      if (state === "poweredOn") {
        console.log("Scanning for printer...");
        await noble.startScanningAsync([], false);
      }
    });

    noble.on("discover", async (peripheral) => {
      if (
        peripheral.advertisement.localName === "M02L" ||
        peripheral.advertisement.localName?.indexOf("Q02") > -1
      ) {
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
          const readCharacteristic = characteristics.find((c) =>
            c.properties.includes("read")
          );

          if (writeCharacteristic) {
            resolve({ peripheral, writeCharacteristic, readCharacteristic });
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

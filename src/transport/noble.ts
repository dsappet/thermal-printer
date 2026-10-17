/** BLE transport for Bun/Node via @abandonware/noble. */
import noble from "@abandonware/noble";
import type { Transport } from "../printer";

const WRITE_UUID = "ff02";
const NOTIFY_UUIDS = ["ff03", "ff01"];

export interface NobleTransportOptions {
  /** Bytes per BLE write. Default 182 (MTU 185 - 3, what macOS negotiates with the M02). */
  chunkSize?: number;
  /** Write without response: faster but CoreBluetooth drops packets on big jobs. Default false. */
  withoutResponse?: boolean;
  /** Pause between chunks in ms. Default 0. */
  chunkDelayMs?: number;
  /**
   * Whether close() should disconnect the peripheral. Default: true when this module
   * connected it, false when you passed in an already-connected peripheral.
   */
  ownsConnection?: boolean;
  log?: (msg: string) => void;
}

export interface NobleOptions extends NobleTransportOptions {
  /** Advertised name to match. Default /^(M02|Q02|T02)/i. */
  name?: RegExp;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Scan for the printer and resolve with its (not yet connected) peripheral. */
export async function findNoblePeripheral(opts: NobleOptions = {}): Promise<noble.Peripheral> {
  const nameMatch = opts.name ?? /^(M02|Q02|T02)/i;
  const timeoutMs = opts.timeoutMs ?? 20000;
  const log = opts.log ?? (() => {});

  return new Promise<noble.Peripheral>((resolve, reject) => {
    const timer = setTimeout(() => {
      noble.removeListener("discover", onDiscover);
      noble.stopScanningAsync().catch(() => {});
      reject(new Error("Timed out scanning for printer (is it on, and is Bluetooth on?)"));
    }, timeoutMs);
    const onDiscover = async (p: noble.Peripheral) => {
      const name = p.advertisement.localName ?? "";
      if (!nameMatch.test(name)) return;
      clearTimeout(timer);
      noble.removeListener("discover", onDiscover);
      await noble.stopScanningAsync();
      log(`found ${name} (${p.id}) rssi=${p.rssi}`);
      resolve(p);
    };
    noble.on("discover", onDiscover);
    const start = () => noble.startScanningAsync([], false).catch(reject);
    if ((noble as unknown as { _state: string })._state === "poweredOn") start();
    else {
      noble.once("stateChange", (s) => (s === "poweredOn" ? start() : reject(new Error(`Bluetooth is ${s}`))));
    }
  });
}

/**
 * Wrap a noble peripheral you manage yourself. Connects it if it isn't connected yet.
 * close() only disconnects when ownsConnection is true (default: only if we connected it).
 */
export async function nobleTransport(
  peripheral: noble.Peripheral,
  opts: NobleTransportOptions = {}
): Promise<Transport> {
  const chunkSize = opts.chunkSize ?? 182;
  const withoutResponse = opts.withoutResponse ?? false;
  const delay = opts.chunkDelayMs ?? 0;
  const log = opts.log ?? (() => {});

  const wasConnected = peripheral.state === "connected";
  if (!wasConnected) await peripheral.connectAsync();
  const owns = opts.ownsConnection ?? !wasConnected;

  const { characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync();
  const write =
    characteristics.find((c) => c.uuid === WRITE_UUID) ??
    characteristics.find((c) => c.properties.includes("writeWithoutResponse")) ??
    characteristics.find((c) => c.properties.includes("write"));
  if (!write) throw new Error("No writable characteristic found");
  const notify = characteristics.find((c) => NOTIFY_UUIDS.includes(c.uuid) && c.properties.includes("notify"));

  const listeners = new Set<(data: Uint8Array) => void>();
  const onData = (d: Buffer) => listeners.forEach((fn) => fn(new Uint8Array(d)));
  if (notify) {
    notify.on("data", onData);
    await notify.subscribeAsync();
  }
  log(`connected write=${write.uuid} notify=${notify?.uuid ?? "none"} chunk=${chunkSize} owns=${owns}`);

  return {
    async write(data: Uint8Array) {
      for (let i = 0; i < data.length; i += chunkSize) {
        await write.writeAsync(Buffer.from(data.subarray(i, i + chunkSize)), withoutResponse);
        if (delay) await sleep(delay);
      }
    },
    onNotify(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onDisconnect(fn) {
      peripheral.once("disconnect", fn);
      return () => peripheral.removeListener("disconnect", fn);
    },
    async close() {
      notify?.removeListener("data", onData);
      listeners.clear();
      if (owns) await peripheral.disconnectAsync();
    },
  };
}

/** Scan, connect and wrap in one go. */
export async function connectNoble(opts: NobleOptions = {}): Promise<Transport> {
  const peripheral = await findNoblePeripheral(opts);
  return nobleTransport(peripheral, { ownsConnection: true, ...opts });
}

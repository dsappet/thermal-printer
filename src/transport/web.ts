/**
 * Web Bluetooth transport for browsers (Chrome/Edge/Android; not Safari/Firefox).
 * requestDevice() must be called from a user gesture (click).
 */
import type { Transport } from "../printer";

const SERVICE_UUID = 0xff00;
const WRITE_UUID = 0xff02;
const NOTIFY_UUID = 0xff03;

export interface WebTransportOptions {
  /** Bytes per write. Default 182. Web Bluetooth caps a single write at 512. */
  chunkSize?: number;
  /**
   * Whether close() should disconnect the GATT server. Default: true when this module
   * connected it, false when you passed in an already-connected device/server.
   */
  ownsConnection?: boolean;
  log?: (msg: string) => void;
}

export interface WebBluetoothOptions extends WebTransportOptions {
  /** Advertised name prefixes to offer in the chooser. Default ["M02", "Q02", "T02"]. */
  namePrefixes?: string[];
}

/** Open the browser's device chooser and return the chosen (not yet connected) device. */
export async function requestWebDevice(opts: WebBluetoothOptions = {}): Promise<BluetoothDevice> {
  const bt = (globalThis.navigator as Navigator | undefined)?.bluetooth;
  if (!bt) throw new Error("Web Bluetooth is not available in this browser");
  return bt.requestDevice({
    filters: (opts.namePrefixes ?? ["M02", "Q02", "T02"]).map((namePrefix) => ({ namePrefix })),
    optionalServices: [SERVICE_UUID],
  });
}

/**
 * Wrap a BluetoothDevice or BluetoothRemoteGATTServer you manage yourself.
 * Connects if needed. close() only disconnects when ownsConnection is true.
 */
export async function webTransport(
  handle: BluetoothDevice | BluetoothRemoteGATTServer,
  opts: WebTransportOptions = {}
): Promise<Transport> {
  const chunkSize = opts.chunkSize ?? 182;
  const log = opts.log ?? (() => {});

  const isServer = (h: BluetoothDevice | BluetoothRemoteGATTServer): h is BluetoothRemoteGATTServer =>
    "getPrimaryService" in h;
  const device: BluetoothDevice = isServer(handle) ? handle.device : handle;
  const gatt: BluetoothRemoteGATTServer | undefined = isServer(handle) ? handle : handle.gatt;
  if (!gatt) throw new Error("Device has no GATT server");
  const wasConnected = gatt.connected;
  const server = wasConnected ? gatt : await gatt.connect();
  const owns = opts.ownsConnection ?? !wasConnected;

  const service = await server.getPrimaryService(SERVICE_UUID);
  const write = await service.getCharacteristic(WRITE_UUID);
  const notify = await service.getCharacteristic(NOTIFY_UUID).catch(() => undefined);

  const listeners = new Set<(data: Uint8Array) => void>();
  const onChanged = (ev: Event) => {
    const v = (ev.target as BluetoothRemoteGATTCharacteristic).value;
    if (v) listeners.forEach((fn) => fn(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)));
  };
  if (notify) {
    await notify.startNotifications();
    notify.addEventListener("characteristicvaluechanged", onChanged);
  }
  log(`connected to ${device.name} chunk=${chunkSize} owns=${owns}`);

  return {
    async write(data: Uint8Array) {
      for (let i = 0; i < data.length; i += chunkSize) {
        // With response: flow controlled, the printer acks each one.
        await write.writeValueWithResponse(data.subarray(i, i + chunkSize));
      }
    },
    onNotify(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onDisconnect(fn) {
      device.addEventListener("gattserverdisconnected", fn, { once: true });
      return () => device.removeEventListener("gattserverdisconnected", fn);
    },
    async close() {
      notify?.removeEventListener("characteristicvaluechanged", onChanged);
      listeners.clear();
      if (owns) gatt.disconnect();
    },
  };
}

/** Chooser + connect + wrap in one go. */
export async function connectWeb(opts: WebBluetoothOptions = {}): Promise<Transport> {
  const device = await requestWebDevice(opts);
  return webTransport(device, { ownsConnection: true, ...opts });
}

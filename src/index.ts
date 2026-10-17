export { Document, doc, type DocumentOptions } from "./document";
export { Printer, type Printable, type PrinterOptions, type Status, type Transport } from "./printer";
export {
  connectNoble,
  findNoblePeripheral,
  nobleTransport,
  type NobleOptions,
  type NobleTransportOptions,
} from "./transport/noble";
export {
  connectWeb,
  requestWebDevice,
  webTransport,
  type WebBluetoothOptions,
  type WebTransportOptions,
} from "./transport/web";
export { renderText, wrapText, FONT, FONT_NL, type TextOptions } from "./render/text";
export { renderImage, bitmapToPng, type ImageOptions } from "./render/image";
export * from "./bitmap";
export * from "./protocol";
export * from "./units";

import type noble from "@abandonware/noble";
import { Printer, type PrinterOptions, type Transport } from "./printer";
import type { NobleOptions } from "./transport/noble";
import { connectWeb, webTransport, type WebBluetoothOptions } from "./transport/web";

/** A connection you already hold: a noble peripheral, a Web Bluetooth device/server, or a Transport. */
export type DeviceHandle = noble.Peripheral | BluetoothDevice | BluetoothRemoteGATTServer | Transport;

export type ConnectOptions = PrinterOptions &
  NobleOptions &
  WebBluetoothOptions & {
    /** Force a transport. Default: "web" when `navigator.bluetooth` exists, otherwise "noble". */
    transport?: "web" | "noble";
    /**
     * Use an existing connection instead of scanning. The library will not disconnect it
     * on printer.disconnect() unless you pass ownsConnection: true.
     */
    device?: DeviceHandle;
  };

/** True when the Web Bluetooth API is available (browser). */
export function isWebBluetooth(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator && !!navigator.bluetooth;
}

function isTransport(h: DeviceHandle): h is Transport {
  return typeof (h as Transport).write === "function" && typeof (h as Transport).onNotify === "function";
}
function isWebHandle(h: DeviceHandle): h is BluetoothDevice | BluetoothRemoteGATTServer {
  return "getPrimaryService" in h || ("gatt" in h && !("connectAsync" in h));
}

/** Wrap an existing handle into a Transport, loading noble only if the handle is a noble peripheral. */
export async function transportFrom(handle: DeviceHandle, opts: ConnectOptions = {}): Promise<Transport> {
  if (isTransport(handle)) return handle;
  if (isWebHandle(handle)) return webTransport(handle, opts);
  const { nobleTransport } = await import("./transport/noble");
  return nobleTransport(handle as noble.Peripheral, opts);
}

/**
 * Connect to the printer and return a ready Printer.
 * - `device` given: wraps your existing connection (noble peripheral, Web Bluetooth device/server, or Transport).
 * - otherwise: Web Bluetooth in the browser (call from a click handler), noble in Bun/Node. noble is
 *   loaded lazily so the browser path never touches it; when bundling for the web import "thermal-printer/web".
 */
export async function connect(opts: ConnectOptions = {}): Promise<Printer> {
  let transport: Transport;
  if (opts.device) {
    transport = await transportFrom(opts.device, opts);
  } else {
    const which = opts.transport ?? (isWebBluetooth() ? "web" : "noble");
    transport =
      which === "web" ? await connectWeb(opts) : await (await import("./transport/noble")).connectNoble(opts);
  }
  return new Printer(transport, opts);
}

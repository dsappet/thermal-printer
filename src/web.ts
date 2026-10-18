/// <reference types="web-bluetooth" />
/**
 * Browser entry point: protocol + bitmaps + Printer + Web Bluetooth transport.
 * No noble, no sharp, no @napi-rs/canvas. Rendering text/images in the browser is on the
 * roadmap (DOM canvas or satori); until then pass pre-rendered bitmaps.
 */
export * from "./bitmap.js";
export * from "./protocol.js";
export * from "./units.js";
export { Printer, type Printable, type PrinterOptions, type Status, type Transport } from "./printer.js";
export {
  connectWeb,
  requestWebDevice,
  webTransport,
  type WebBluetoothOptions,
  type WebTransportOptions,
} from "./transport/web.js";

import { Printer, type PrinterOptions, type Transport } from "./printer.js";
import { connectWeb, webTransport, type WebBluetoothOptions } from "./transport/web.js";

export type WebConnectOptions = WebBluetoothOptions &
  PrinterOptions & {
    /** Use a device/server you already hold (or a Transport) instead of opening the chooser. */
    device?: BluetoothDevice | BluetoothRemoteGATTServer | Transport;
  };

/** Open the chooser (or wrap `device`) and return a ready Printer. Call from a click handler. */
export async function connect(opts: WebConnectOptions = {}): Promise<Printer> {
  const d = opts.device;
  const transport = !d
    ? await connectWeb(opts)
    : "write" in d && typeof d.write === "function"
      ? (d as Transport)
      : await webTransport(d as BluetoothDevice | BluetoothRemoteGATTServer, opts);
  return new Printer(transport, opts);
}
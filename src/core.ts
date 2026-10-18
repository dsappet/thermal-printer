/** Runtime-agnostic core: protocol bytes, bitmaps and the Printer/Transport contract. No I/O, no deps. */
export * from "./bitmap.js";
export * from "./protocol.js";
export * from "./units.js";
export { Printer, type Printable, type PrinterOptions, type Status, type Transport } from "./printer.js";

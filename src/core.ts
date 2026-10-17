/** Runtime-agnostic core: protocol bytes, bitmaps and the Printer/Transport contract. No I/O, no deps. */
export * from "./bitmap";
export * from "./protocol";
export * from "./units";
export { Printer, type Printable, type PrinterOptions, type Status, type Transport } from "./printer";

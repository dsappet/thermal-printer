import { describe, expect, test } from "bun:test";
import { blank } from "../src/bitmap.js";
import { Printer, type Transport } from "../src/printer.js";
import { FOOTER, HEADER, MODELS, QUERY } from "../src/protocol.js";

import { hex } from "./helpers.js";
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * In-memory transport that behaves like the M02: acks every write, answers status
 * queries, and lets the test inject frames (e.g. print complete) at any moment.
 */
function fakeTransport(opts: { autoComplete?: boolean; battery?: number } = {}) {
  const listeners = new Set<(d: Uint8Array) => void>();
  const disconnectListeners = new Set<() => void>();
  const writes: Uint8Array[] = [];
  const emit = (...b: number[]) => listeners.forEach((fn) => fn(Uint8Array.from(b)));
  let closed = false;

  const transport: Transport = {
    async write(data) {
      writes.push(data);
      emit(0x01, 0x01); // ack
      // Reply to vendor queries the way the printer does.
      if (data.length === 3 && data[0] === 0x1f && data[1] === 0x11) {
        switch (data[2]) {
          case QUERY.firmware: emit(0x1a, 0x07, 1, 0, 1); break;
          case QUERY.battery: emit(0x1a, 0x04, opts.battery ?? 72); break;
          case QUERY.serial: emit(0x1a, 0x08, 0x41, 0x42); break;
          case QUERY.paper: emit(0x1a, 0x06, 0x89); break;
          case QUERY.cover: emit(0x1a, 0x05, 0x98); break;
          case QUERY.temperature: emit(0x1a, 0x03, 0xa8); break;
        }
      }
      // A raster job ends with the footer; the real printer sends 1A 0F a little later.
      if (opts.autoComplete && data.length > FOOTER.length && hex(data.subarray(data.length - FOOTER.length)) === hex(FOOTER)) {
        setTimeout(() => emit(0x1a, 0x0f, 0x0c), 5);
      }
    },
    onNotify(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onDisconnect(fn) {
      disconnectListeners.add(fn);
      return () => disconnectListeners.delete(fn);
    },
    async close() {
      closed = true;
    },
  };
  return {
    transport,
    writes,
    emit,
    get closed() { return closed; },
    dropLink: () => disconnectListeners.forEach((fn) => fn()),
  };
}

describe("Printer", () => {
  test("width comes from the model, default M02", () => {
    const { transport } = fakeTransport();
    expect(new Printer(transport).width).toBe(384);
    expect(new Printer(transport, { model: MODELS.M02Pro }).width).toBe(576);
  });

  test("print sends one job and resolves on print complete", async () => {
    const fake = fakeTransport({ autoComplete: true });
    const printer = new Printer(fake.transport);
    await printer.print(blank(384, 10));
    expect(fake.writes.length).toBe(1);
    const job = fake.writes[0];
    expect(hex(job.subarray(0, HEADER.length))).toBe(hex(HEADER));
    expect(job.length).toBe(HEADER.length + 8 + 48 * 10 + FOOTER.length);
  });

  test("print renders a Document-like at the printer width", async () => {
    const fake = fakeTransport({ autoComplete: true });
    const printer = new Printer(fake.transport, { model: MODELS.M02S });
    let seenWidth = 0;
    await printer.print({ render: (w) => { seenWidth = w; return blank(w, 2); } });
    expect(seenWidth).toBe(512);
    expect(fake.writes[0].length).toBe(HEADER.length + 8 + 64 * 2 + FOOTER.length);
  });

  test("print passes feedLines through", async () => {
    const fake = fakeTransport({ autoComplete: true });
    await new Printer(fake.transport).print(blank(384, 1), { feedLines: 3 });
    const job = fake.writes[0];
    const at = HEADER.length + 8 + 48;
    expect(hex(job.subarray(at, at + 3))).toBe("1b 64 03");
  });

  test("print times out when the printer never reports completion", async () => {
    const fake = fakeTransport({ autoComplete: false });
    const printer = new Printer(fake.transport);
    await expect(printer.print(blank(384, 1), { timeoutMs: 20 })).rejects.toThrow(/Timed out/);
  });

  test("a stale print-complete received during the transfer does not end the wait", async () => {
    const fake = fakeTransport({ autoComplete: false });
    // Emit a stale 1A 0F in the middle of the write, like the jammed-job case in the notes.
    const original = fake.transport.write;
    fake.transport.write = async (d) => {
      fake.emit(0x1a, 0x0f, 0x0c);
      await original(d);
    };
    const printer = new Printer(fake.transport);
    const p = printer.print(blank(384, 1), { timeoutMs: 40 });
    await expect(p).rejects.toThrow(/Timed out/);
  });

  test("a print-complete after the transfer resolves the print", async () => {
    const fake = fakeTransport({ autoComplete: false });
    const printer = new Printer(fake.transport);
    const p = printer.print(blank(384, 1), { timeoutMs: 500 });
    await tick();
    fake.emit(0x1a, 0x0f, 0x0c);
    await expect(p).resolves.toBeUndefined();
  });

  test("status queries each field and decodes the replies", async () => {
    const fake = fakeTransport({ battery: 55 });
    const printer = new Printer(fake.transport);
    const s = await printer.status();
    expect(s).toEqual({ firmware: "1.0.1", battery: 55, serial: "AB", paper: true, cover: true, temperature: true });
    expect(fake.writes.map(hex)).toEqual([
      "1f 11 07", "1f 11 08", "1f 11 09", "1f 11 11", "1f 11 12", "1f 11 13",
    ]);
  });

  test("feed sends ESC d n", async () => {
    const fake = fakeTransport();
    await new Printer(fake.transport).feed(5);
    expect(hex(fake.writes[0])).toBe("1b 64 05");
  });

  test("log receives decoded non-ack notifications", async () => {
    const fake = fakeTransport();
    const lines: string[] = [];
    const printer = new Printer(fake.transport, { log: (m) => lines.push(m) });
    await printer.feed(1);
    expect(lines.length).toBe(0); // acks are not logged
    fake.emit(0x1a, 0x04, 90);
    expect(lines[0]).toContain('"battery"');
  });

  test("keepAlive sends battery queries on an interval until stopped", async () => {
    const fake = fakeTransport({ battery: 80 });
    const printer = new Printer(fake.transport);
    const ticks: Array<number | undefined> = [];
    printer.keepAlive(10, (b) => ticks.push(b));
    await new Promise((r) => setTimeout(r, 55));
    printer.stopKeepAlive();
    const n = fake.writes.length;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(fake.writes.every((w) => hex(w) === "1f 11 08")).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(fake.writes.length).toBe(n); // stopped
    expect(ticks.every((t) => t === 80)).toBe(true);
  });

  test("onDisconnect forwards to the transport and can be unsubscribed", () => {
    const fake = fakeTransport();
    const printer = new Printer(fake.transport);
    let calls = 0;
    const off = printer.onDisconnect(() => calls++);
    fake.dropLink();
    off();
    fake.dropLink();
    expect(calls).toBe(1);
  });

  test("onDisconnect is a no-op for transports that cannot report it", () => {
    const { transport } = fakeTransport();
    const minimal: Transport = { write: transport.write, onNotify: transport.onNotify, close: transport.close };
    expect(() => new Printer(minimal).onDisconnect(() => {})()).not.toThrow();
  });

  test("disconnect stops keep-alive and closes the transport", async () => {
    const fake = fakeTransport();
    const printer = new Printer(fake.transport).keepAlive(10);
    await printer.disconnect();
    expect(fake.closed).toBe(true);
    const n = fake.writes.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(fake.writes.length).toBe(n);
  });
});

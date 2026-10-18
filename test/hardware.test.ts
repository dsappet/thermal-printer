/**
 * Talks to a real printer. Skipped unless POCKET_HARDWARE=1:
 *
 *   POCKET_HARDWARE=1 bun test test/hardware.test.ts      (or: bun run test:hardware)
 *
 * Needs Bluetooth on and the printer powered on and in range. It prints one short line.
 */
import { afterAll, describe, expect, test } from "bun:test";
import type { Printer } from "../src/printer.js";

const enabled = process.env.POCKET_HARDWARE === "1";

describe.skipIf(!enabled)("real printer", () => {
  let printer: Printer;

  afterAll(async () => {
    await printer?.disconnect();
  });

  test("connects", async () => {
    const { connect } = await import("../src/index.js");
    printer = await connect({ log: (m) => console.log("  ", m), timeoutMs: 20000 });
    expect(printer.width).toBe(384);
  }, 30000);

  test("reports status", async () => {
    const s = await printer.status();
    expect(s.firmware).toMatch(/^\d+\.\d+\.\d+$/);
    expect(s.battery).toBeGreaterThanOrEqual(0);
    expect(s.battery).toBeLessThanOrEqual(100);
    expect(s.serial).toBeTruthy();
    expect(s.paper).toBe(true);
    expect(s.cover).toBe(true);
    expect(s.temperature).toBe(true);
  }, 15000);

  test("prints a line and gets print complete", async () => {
    const { doc } = await import("../src/index.js");
    const d = doc().text(`phomemo test ${new Date().toLocaleTimeString()}`, { size: "sm", align: "center" }).feed(2);
    await expect(printer.print(d)).resolves.toBeUndefined();
  }, 40000);
});

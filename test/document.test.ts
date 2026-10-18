import { describe, expect, test } from "bun:test";
import { blank } from "../src/bitmap.js";
import { Document, doc } from "../src/document.js";
import { lineHeightPx, renderText } from "../src/render/text.js";
import { inkCount, sameBytes } from "./helpers.js";

const rowInk = (bmp: { width: number; gray: Uint8Array }, y: number) =>
  inkCount(bmp.gray.subarray(y * bmp.width, (y + 1) * bmp.width));

describe("Document", () => {
  test("doc() is a Document and chains", () => {
    const d = doc();
    expect(d).toBeInstanceOf(Document);
    expect(d.text("a")).toBe(d);
  });

  test("empty document renders zero height", async () => {
    const bmp = await doc().render();
    expect(bmp.width).toBe(384);
    expect(bmp.height).toBe(0);
  });

  test("blocks stack in order and heights add up", async () => {
    const bmp = await doc().text("a", { size: 20 }).space(10).text("b", { size: 20 }).render();
    expect(bmp.height).toBe(25 + 10 + 25);
  });

  test("renders at the width it is given", async () => {
    const bmp = await doc().text("wide").render(576);
    expect(bmp.width).toBe(576);
  });

  test("newline uses the line height of the most recent text", async () => {
    const d = doc().text("x", { size: 20 }).newline(2).text("y", { size: 40 }).feed(1);
    const bmp = await d.render();
    expect(bmp.height).toBe(25 + 2 * 25 + 50 + 50);
  });

  test("newline before any text uses the document defaults", async () => {
    const bmp = await doc({ text: { size: 32 } }).newline().render();
    expect(bmp.height).toBe(lineHeightPx({ size: 32 }, 384));
  });

  test("document-level text defaults apply and can be overridden", async () => {
    const d = doc({ text: { size: 40 } }).text("a").text("b", { size: 20 });
    expect((await d.render()).height).toBe(50 + 25);
  });

  test("space accepts px, %, mm", async () => {
    expect((await doc().space(16).render()).height).toBe(16);
    expect((await doc().space("4mm").render()).height).toBe(32);
    expect((await doc().space("10%").render(384)).height).toBe(38);
    expect((await doc().space(-5).render()).height).toBe(0);
  });

  test("rule draws a bar inset by the margin with padding above and below", async () => {
    const bmp = await doc().rule({ thickness: 2, margin: 8, padding: 6 }).render();
    expect(bmp.height).toBe(14);
    expect(rowInk(bmp, 0)).toBe(0);
    expect(rowInk(bmp, 5)).toBe(0);
    expect(rowInk(bmp, 6)).toBe(384 - 16);
    expect(rowInk(bmp, 7)).toBe(384 - 16);
    expect(rowInk(bmp, 8)).toBe(0);
    expect(bmp.gray[6 * 384 + 7]).toBe(255);
    expect(bmp.gray[6 * 384 + 8]).toBe(0);
  });

  test("rule margin accepts percent", async () => {
    const bmp = await doc().rule({ thickness: 1, margin: "25%", padding: 0 }).render();
    expect(rowInk(bmp, 0)).toBe(192);
  });

  test("bitmap blocks are passed through", async () => {
    const b = blank(384, 7, 0);
    const bmp = await doc().bitmap(b).render();
    expect(bmp.height).toBe(7);
    expect(inkCount(bmp.gray)).toBe(384 * 7);
  });

  test("a bitmap of the wrong width fails at render time", async () => {
    await expect(doc().bitmap(blank(200, 1)).render()).rejects.toThrow(/width 200/);
  });

  test("text block equals renderText with the same options", async () => {
    const opts = { size: "lg" as const, bold: true, align: "center" as const };
    const viaDoc = await doc().text("Receipt", opts).render();
    const direct = renderText("Receipt", opts, 384);
    expect(sameBytes(viaDoc.gray, direct.gray)).toBe(true);
  });

  test("image block fits the page", async () => {
    const bmp = await doc().image("images/dog-owl.jpeg", { width: "50%" }).render();
    expect(bmp.width).toBe(384);
    expect(bmp.height).toBe(192);
  });
});

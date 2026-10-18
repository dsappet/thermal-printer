#!/usr/bin/env node
/**
 * `pocket-printer` command line tool, built on the library.
 *
 *   pocket-printer text "some text" [--size md|xl|28] [--columns 32] [--bold] [--align left|center|right] [--no-ligatures]
 *   pocket-printer image <file> [--width 50%|30mm|300] [--max-height 60mm] [--no-dither] [--align center]
 *   pocket-printer demo [--image <file>]        # text + rule + table + image in one document
 *   pocket-printer status
 *   pocket-printer feed [lines]
 *
 * Add --preview [file.png] to any print command to write a PNG instead of printing.
 * Env: POCKET_CHUNK (bytes per BLE write, default 182), POCKET_NO_RESPONSE=1 (fast, unsafe writes),
 *      POCKET_NAME (regex for the advertised name, default M02|Q02|T02).
 */
import { type Align, Document, type SizePreset, bitmapToPng, connect, doc } from "./index.js";

const USAGE = `usage:
  pocket-printer text "..."      [--size xs|sm|md|lg|xl|xxl|<px>] [--columns N] [--bold] [--align left|center|right] [--no-ligatures]
  pocket-printer image <file>    [--width 50%|30mm|<px>] [--max-height <len>] [--no-dither] [--align left|center|right]
  pocket-printer demo            [--image <file>]
  pocket-printer status
  pocket-printer feed [lines]

  --preview [out.png]  render to a PNG instead of printing (default preview.png)
  --width-px <n>       page width for --preview (default 384)`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--") ? undefined : v;
}
const has = (args: string[], name: string) => args.includes(`--${name}`);
const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));
const size = (v: string | undefined) => (v === undefined ? undefined : /^\d+$/.test(v) ? Number(v) : (v as SizePreset));

function build(cmd: string, args: string[]): Document | undefined {
  const align = flag(args, "align") as Align | undefined;
  switch (cmd) {
    case "text":
      return doc().text(args[0] ?? "", {
        size: size(flag(args, "size")),
        columns: num(flag(args, "columns")),
        bold: has(args, "bold"),
        align,
        noLigatures: has(args, "no-ligatures"),
      });
    case "image":
      if (!args[0] || args[0].startsWith("--")) throw new Error("image: missing <file>");
      return doc().image(args[0], {
        width: flag(args, "width"),
        maxHeight: flag(args, "max-height"),
        dither: !has(args, "no-dither"),
        align,
      });
    case "demo": {
      const d = doc()
        .text("Phomemo M02", { size: "xl", bold: true, align: "center" })
        .text("high-level API demo", { size: "sm", align: "center" })
        .rule()
        .text("Text wraps at the paper width by default. Explicit\nnewlines work too, and the font is JetBrains Mono.")
        .newline()
        .text("Item            Qty   Price\nCoffee            2   $7.00\nBagel             1   $3.50", { columns: 32 })
        .newline()
        .text("const x = () => 0x1F;", { noLigatures: true, size: "sm" })
        .space("4mm");
      const image = flag(args, "image");
      if (image) d.image(image, { width: "66%" });
      return d.rule({ thickness: 1, margin: "10%" }).text("right aligned, bold", { bold: true, align: "right", size: "sm" });
    }
    default:
      return undefined;
  }
}

async function main() {
  const [cmd = "", ...args] = process.argv.slice(2);
  if (!cmd || has(args, "help") || cmd === "help" || cmd === "--help") {
    console.log(USAGE);
    process.exit(cmd ? 0 : 1);
  }
  const document = build(cmd, args);
  if (!document && !["status", "feed"].includes(cmd)) {
    console.error(`unknown command "${cmd}"\n${USAGE}`);
    process.exit(1);
  }

  if (document && has(args, "preview")) {
    const out = flag(args, "preview") ?? "preview.png";
    const bmp = await document.render(num(flag(args, "width-px")) ?? 384);
    await bitmapToPng(bmp, out);
    console.log(`Wrote ${out} (${bmp.width}x${bmp.height})`);
    return;
  }

  const printer = await connect({
    log: (m) => console.log(m),
    chunkSize: num(process.env.POCKET_CHUNK),
    withoutResponse: process.env.POCKET_NO_RESPONSE === "1",
    name: process.env.POCKET_NAME ? new RegExp(process.env.POCKET_NAME, "i") : undefined,
  });
  try {
    if (cmd === "status") console.log(await printer.status());
    else if (cmd === "feed") await printer.feed(num(args[0]) ?? 2);
    else if (document) await printer.print(document);
  } finally {
    await printer.disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Error:", e instanceof Error ? e.message : e);
    process.exit(1);
  });

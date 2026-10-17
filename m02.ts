/**
 * CLI for the Phomemo M02, built on the library in src/.
 *
 *   bun m02.ts text "some text" [--size md|xl|28] [--columns 32] [--bold] [--align left|center|right] [--no-ligatures]
 *   bun m02.ts image <file> [--width 50%|30mm|300] [--max-height 60mm] [--no-dither] [--align center]
 *   bun m02.ts demo                  # text + rule + image + newlines in one document
 *   bun m02.ts status
 *   bun m02.ts feed [lines]
 *
 * Add --preview to any print command to write preview.png instead of printing.
 * Env: M02_CHUNK (bytes per BLE write, default 182), M02_NO_RESPONSE=1 (fast, unsafe writes).
 */
import { type Align, Document, type SizePreset, bitmapToPng, connect, doc } from "./src";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}
const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));
const size = (v: string | undefined) => (v === undefined ? undefined : /^\d+$/.test(v) ? Number(v) : (v as SizePreset));

function build(cmd: string, args: string[]): Document | undefined {
  const align = flag(args, "align") as Align | undefined;
  switch (cmd) {
    case "text":
      return doc().text(args[0] ?? "", {
        size: size(flag(args, "size")),
        columns: num(flag(args, "columns")),
        bold: args.includes("--bold"),
        align,
        noLigatures: args.includes("--no-ligatures"),
      });
    case "image":
      return doc().image(args[0], {
        width: flag(args, "width"),
        maxHeight: flag(args, "max-height"),
        dither: !args.includes("--no-dither"),
        align,
      });
    case "demo":
      return doc()
        .text("Phomemo M02", { size: "xl", bold: true, align: "center" })
        .text("high-level API demo", { size: "sm", align: "center" })
        .rule()
        .text("Text wraps at the paper width by default. Explicit\nnewlines work too, and the font is JetBrains Mono.")
        .newline()
        .text("Item            Qty   Price\nCoffee            2   $7.00\nBagel             1   $3.50", { columns: 32 })
        .newline()
        .text("const x = () => 0x1F;", { noLigatures: true, size: "sm" })
        .space("4mm")
        .image("images/dog-owl.jpeg", { width: "66%" })
        .rule({ thickness: 1, margin: "10%" })
        .text("right aligned, bold", { bold: true, align: "right", size: "sm" });
    default:
      return undefined;
  }
}

async function main() {
  const [cmd = "", ...args] = process.argv.slice(2);
  const document = build(cmd, args);
  if (!document && !["status", "feed"].includes(cmd)) {
    console.log('usage: bun m02.ts text "..." | image <file> | demo | status | feed [n]   [--preview]');
    process.exit(1);
  }

  if (document && args.includes("--preview")) {
    const bmp = await document.render(384);
    await bitmapToPng(bmp, "preview.png");
    console.log(`Wrote preview.png (${bmp.width}x${bmp.height})`);
    return;
  }

  const printer = await connect({
    log: (m) => console.log(m),
    chunkSize: num(process.env.M02_CHUNK),
    withoutResponse: process.env.M02_NO_RESPONSE === "1",
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
    console.error("Error:", e.message ?? e);
    process.exit(1);
  });

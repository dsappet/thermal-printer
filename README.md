# thermal-printer

A library + CLI for printing to the Phomemo M02 over Bluetooth LE, from Bun/Node (noble)
or the browser (Web Bluetooth).

The M02 is **raster-only**: no font ROM, ESC/POS text commands are ignored. Everything is
rendered to a 384 px wide 1-bit bitmap on the host and sent as `GS v 0` blocks. The font
is JetBrains Mono, bundled in `fonts/` (SIL OFL), so nothing depends on system fonts.
See [M02-NOTES.md](M02-NOTES.md) for the protocol research and [TODO.md](TODO.md) for the roadmap.

## CLI

```sh
bun install
bun m02.ts text "Hello M02" --size xl --bold --align center
bun m02.ts text "Item   Qty  Price" --columns 32
bun m02.ts image images/dog-owl.jpeg --width 50% --max-height 40mm
bun m02.ts demo                    # text + rules + image in one document
bun m02.ts status                  # { firmware, battery, serial, paper, cover, temperature }
bun m02.ts feed 3
bun m02.ts demo --preview          # writes preview.png, no printer needed
```

## Library (Bun / Node)

```ts
import { connect, doc } from "thermal-printer";

const printer = await connect({ log: console.log }); // noble in Bun/Node, Web Bluetooth in a browser

await printer.print(
  doc()
    .text("Receipt", { size: "xl", bold: true, align: "center" })
    .rule()
    .text("Long text wraps at the paper width automatically. Explicit\nnewlines are honoured.")
    .text("Item        Qty   Price\nCoffee        2   $7.00", { columns: 32 })
    .newline(2)
    .image("photo.jpg", { width: "60%", maxHeight: "50mm" })
    .text("const x = () => 1;", { noLigatures: true, size: "sm" })
    .feed(3)
);

console.log(await printer.status());
await printer.disconnect();
```

### Sizes and units

Documents don't know the printer width until they are printed (`printer.width`, 384 px on
the M02, 512 on the M02S, 576 on the M02 Pro), so sizes are relative where it matters:

- **Text** `size`: a preset `xs | sm | md | lg | xl | xxl` (md = 24 px on the M02, scaled
  for wider printers) or a number in px. Or give `columns: 32` and the size is chosen so
  that many characters fit a line (32 = ESC/POS Font A, 42 = Font B).
- **Lengths** (`image.width`, `image.maxHeight`, `space`, `rule.margin`, `text.margin`): a
  number is px, `"50%"` is a fraction of the page width, `"30mm"` is physical (8 px/mm,
  203 dpi). The page is 48 mm wide on the M02.
- `doc.render(width)` renders at an explicit width for previews; `printer.print(doc)` uses
  the printer's own width.

`Document` methods: `text(str, { size, columns, bold, align, lineHeight, margin, noLigatures })`,
`newline(n)` / `feed(n)`, `space(length)`, `rule({ thickness, margin, padding })`,
`image(pathOrBuffer, { width, maxHeight, align, dither })`, `bitmap(bmp)`, `render(width)`.

`Printer` methods: `print(documentOrBitmap)` (resolves when the printer reports the job
complete), `status()`, `feed(n)`, `disconnect()`; properties `width`, `model`.

`connect()` detects the runtime: if `navigator.bluetooth` exists it uses Web Bluetooth,
otherwise it lazily loads noble. Pass `{ transport: "web" | "noble" }` to force one.

### Bring your own connection

If you manage the Bluetooth connection yourself, hand it over and the library will use it
without disconnecting it (unless you pass `ownsConnection: true`):

```ts
// noble: a peripheral, connected or not
const printer = await connect({ device: peripheral });

// browser: a BluetoothDevice or BluetoothRemoteGATTServer from your own requestDevice()
const printer = await connect({ device: device.gatt });

// anything else: implement Transport { write, onNotify, close } yourself
const printer = new Printer(myTransport);
```

Lower-level pieces are exported too: `findNoblePeripheral()`, `nobleTransport(peripheral)`,
`requestWebDevice()`, `webTransport(deviceOrServer)`, and `transportFrom(handle)`.

## Library (browser)

```ts
import { connect, buildJob } from "thermal-printer/web"; // Web Bluetooth, no native deps

button.onclick = async () => {
  const printer = await connect();      // opens the browser's device chooser
  await printer.print(bitmap);          // a { width: 384, height, gray } bitmap
};
```

Text/image rendering in the browser is on the roadmap; today the web entry takes
pre-rendered bitmaps. Chrome/Edge/Android only (Safari and Firefox lack Web Bluetooth).

## Layout

```
src/protocol.ts        bytes, packing, status decoding      (no deps)
src/bitmap.ts          bitmap type, dither, stack/pad       (no deps)
src/printer.ts         Printer + Transport interface        (no deps)
src/document.ts        Document builder
src/render/text.ts     text via @napi-rs/canvas + bundled JetBrains Mono
src/render/image.ts    images via sharp
src/transport/noble.ts BLE for Bun/Node
src/transport/web.ts   Web Bluetooth
src/index.ts           Bun/Node entry   src/web.ts  browser entry   src/core.ts  no-I/O core
```

Env knobs for the CLI: `M02_CHUNK` (bytes per BLE write, default 182),
`M02_NO_RESPONSE=1` (write without response: faster but drops packets on big jobs).

## Auto power-off

The M02 switches itself off after some idle minutes on battery, but only while nothing is
connected: a silent open BLE connection kept it on for 40 minutes in testing. On a working
charger it stayed on for 26+ minutes disconnected, so "turns off even when plugged in"
usually means the charger isn't actually delivering power.
For a long-running app, connect once and stay connected. `printer.keepAlive(ms)` sends a
harmless battery query periodically if you want belt and braces, and
`printer.onDisconnect(fn)` tells you when the printer did go away.

Charge it from a plain 5 V / 2 A USB-A adapter: a USB-C laptop charger delivered nothing
(charge LED off, gauge stuck). The battery percentage is voltage-based and jumps while charging.

## Notes

- Bluetooth must be on (`blueutil -p 1`) and the printer powered on. It advertises as `M02L`.
- If it buzzes but doesn't feed, it's a paper jam / unlatched lid, not the code.
- `npm rebuild @abandonware/noble` was needed to build for M3 macs.
- `index.ts`, `test.ts`, `status-check.ts`, `bt-checks.ts` are the older experiments.

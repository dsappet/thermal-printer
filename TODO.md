# Roadmap

Transports: Web Bluetooth standard in the browser, noble for Bun/Node (decided 2026-10-16).

Goal: a reusable library for the Phomemo M02 (and siblings) that renders everything to
raster on the host. JetBrains Mono (bundled, `fonts/`) is the font everywhere.

## 1. High-level API (now)

- [x] Library layout under `src/`: `protocol` (bytes, packing, status; no deps), `bitmap`,
      `render/text`, `render/image`, `document`, `transport/noble`, `printer`, `index`
- [x] `Document` builder: `.text()` with default word wrap, `.newline(n)` / `.feed(n)`,
      `.image()` (fit + dither + align), `.rule()` divider, `.space(px)`
- [x] `Printer` class: `connect()`, `print(doc | bitmap | string)`, `status()` → parsed object,
      `feed(n)`, `disconnect()`; waits for the printer's print-complete frame
- [x] `m02.ts` CLI rebuilt on the library (`text`, `image`, `status`, `--preview`)
- [x] README usage for the API
- [x] `connect({ device })` accepts a user-managed noble peripheral / Web Bluetooth device or server / Transport, and leaves it connected
- [x] Sizes and units: text presets (`xs`..`xxl`) and `columns`, lengths as px / `%` / `mm`, page width resolved at print time from `printer.width`
- [x] Package metadata so it can be imported from other projects (`exports`, name)

## 2. Next

- [ ] Browser-side text/image rendering (DOM canvas with the bundled TTF via FontFace, or satori)

- [ ] HTML mode: satori (+ satori-html) → SVG → sharp, using the bundled TTFs; replaces
      canvas for text so text has no native dependency
- [x] Web Bluetooth transport so the same core runs in a browser
- [ ] Density / quality: try the `1F 11 02 NN` byte, dither choices, calibration strip
- [ ] Watch-folder auto-print (port from `index.ts`) and `ai` command via `openai.ts`
- [x] `keepAlive()` + `onDisconnect()`; verified a silent open connection alone keeps the printer on (40 min test)
- [ ] Reconnect / retry on BLE drop; MTU detection instead of the fixed 182-byte chunk
- [ ] Publish (npm or git dependency), remove the old `index.ts` / `test.ts` experiments

## 3. Last: fully compliant ESC/POS emulation

Accept a raw ESC/POS byte stream (e.g. from `receipt-printer-encoder`) and render it to
raster, so any ESC/POS library can target the M02 unchanged.

- [ ] Virtual page: Font A 12x24 → 32 columns at 384 px (JetBrains Mono 20 px),
      Font B 9x17 → 42 columns (15 px)
- [ ] Layout: `LF`, `ESC @`, `ESC a` align, `ESC d` / `ESC J` feed, `ESC 2` / `ESC 3` line
      spacing, `GS V` / `ESC i` cut → feed
- [ ] Style: `ESC !` mode byte, `ESC E` bold, `ESC -` underline, `ESC M` font, `GS !` width/height
      multipliers, `ESC {` upside down, `GS B` reverse
- [ ] Graphics: `GS v 0` raster pass-through, `ESC *` bit image, `GS ( L` if any lib uses it
- [ ] Codes: `GS ( k` QR, `GS k` barcodes (pure-JS generators)
- [ ] Text bytes: UTF-8 default, code pages via `iconv-lite` (`ESC t`)
- [ ] Tables / columns come from the ESC/POS library (they are just spaces); verify with
      `receipt-printer-encoder` `.table()`
- [ ] Unknown commands: consume parameters and skip, never corrupt the stream
- [ ] `bun m02.ts escpos <file | ->` entry point and a round-trip test

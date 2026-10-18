# Roadmap

Transports: Web Bluetooth standard in the browser, noble for Bun/Node 

Goal: a reusable library for the Phomemo M02 (and siblings) that renders everything to
raster on the host. JetBrains Mono (bundled, `fonts/`) is the font everywhere.


# Stories

- [ ] GitHub Action to publish to npm on release (typecheck, test, build, `npm publish --provenance`)
- [ ] **Demo website** (not published to npm): a static `demo/` page with a "Connect" button
      using `pocket-printer/web`, a textarea, an image picker and a canvas preview. Serve with any
      static server over `localhost` (Web Bluetooth needs a secure context). Also the place
      to verify the browser transport, which has only been typechecked so far.
- [ ] Bring your own fonts. Be able to load custom font files from a user.
- [ ] Browser-side text/image rendering (DOM canvas with the bundled TTF via `FontFace`, or satori),
      so the demo can print text without a server
- [ ] Auto-detect the model from the advertised name (M02 Pro / M03 → 576, M02S → 512) and widen
      discovery to the `ff00` service instead of a name list, so any Phomemo is found
- [ ] HTML mode: Raster a rendered HTML 
- [ ] Density / quality: try the `1F 11 02 NN` byte, dither choices, calibration strip
- [ ] Reconnect / retry on BLE drop; MTU detection instead of the fixed 182-byte chunk

- [ ] Fully compliant ESC/POS emulation

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
- [ ] `pocket-printer escpos <file | ->` entry point and a round-trip test

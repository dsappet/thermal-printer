# thermal-printer

Printing to a Phomemo M02 over Bluetooth LE from Bun.

The M02 is a **raster-only** printer: it has no font ROM and ignores ESC/POS text
commands. Everything is rendered to a 1-bit bitmap on the host and sent with
`GS v 0`. See [M02-NOTES.md](M02-NOTES.md) for the protocol research and the
experiment log.

## Usage

```sh
bun install

# print an image (dithered, fitted to 384 px wide)
bun m02.ts image images/dog-owl.jpeg

# print text (rendered with system fonts, word-wrapped)
bun m02.ts text "Hello M02" --size 28 --bold --align center --font Menlo

# query battery / paper / cover / temperature / firmware
bun m02.ts status

# render to preview.png instead of printing
bun m02.ts text "check layout first" --preview
```

Environment knobs: `M02_CHUNK` (BLE write size, default 182), `M02_DELAY`
(ms between chunks, default 0) and `M02_NO_RESPONSE=1` (use write-without-response;
faster but CoreBluetooth drops packets on big jobs).

## Notes

- Bluetooth must be on (`blueutil -p 1`) and the printer powered on. It advertises as `M02L`.
- I had to do `npm rebuild @abandonware/noble` to build for M3 macs.
- `index.ts` is the older encoder-based approach; `m02.ts` is the working driver.

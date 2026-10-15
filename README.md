# thermal-printer

I had to do `npm rebuild @abandonware/noble` to build for M3 macs.

## Protocol checks (`checks/`)

Two scripts to figure out which protocol the printer actually speaks. Both print a
built-in test pattern (border, 8-dot ruler, left-half bar, checkerboard, diagonal)
unless you pass an image path, and both dump the GATT table on connect.

```sh
bun run check:phomemo              # Phomemo-style ESC/POS raster (GS v 0)
bun run check:phomemo -- --no-vendor   # same, without the 1f 11 xx vendor bytes
bun run check:cat -- --probe-only  # cat-printer protocol: just ask for status
bun run check:cat                  # cat-printer protocol: print
bun test checks                    # offline encoder tests
```

The GATT dump alone is often the answer: service `ae30` means cat printer,
`ff00` means Phomemo/ESC-POS.

Env knobs: `PRINTER_NAME` (advertised-name substring), `CHUNK_SIZE`,
`CHUNK_DELAY_MS` (default 15), `WITH_RESPONSE=1`, `ENERGY` (cat only, default 12000).

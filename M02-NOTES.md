# Phomemo M02 — research & experiment log

Running log of what we know, what we tried, and what worked. Newest entries at the bottom of each section.

## TL;DR

- **The M02 has no text engine.** It does not implement ESC/POS text printing (no font ROM, no `ESC !`, no `ESC M`, no line spacing, etc). Every open-source driver and the official app render everything (text, QR, images) to a 1-bit bitmap on the host and send it with the raster command `GS v 0`. So yes: it can **only** raster images. To "print text" we render text to a bitmap first.
- The only commands the firmware acts on: `ESC @`, `ESC a`, `GS v 0`, `ESC d`, `ESC J`, and Phomemo vendor commands `1F 11 xx`.
- Full width is **384 px = 48 bytes/line** at 203 dpi. Max **255 lines per `GS v 0` block**; split taller images into multiple blocks.
- BLE: service `FF00`, write characteristic `FF02` (**write without response** is the only mode the firmware honours for print data), notify on `FF03`/`FF01`. Chunk writes to MTU-3 (~182 bytes on macOS) with a ~2 ms pause between chunks.

## Protocol (M02 / M02 Pro / T02 family)

Sources: vivier/phomemo-tools README, sgrankin/phomemo PROTOCOL.md (captured from the official iOS app), theacodes/phomemo_m02s.

### Job structure

```
1B 40                 ESC @      reset
1B 61 01              ESC a 1    justification (0 left, 1 center, 2 right)
1F 11 02 04           vendor     M02 init / print density (M02X uses 02 02)

1D 76 30 00  30 00  ll hh  <48*lines bytes>     GS v 0, mode 0, 48 bytes/line, lines<=255
... repeat GS v 0 block for every 255-line slice ...

1B 64 02              ESC d 2    print + feed 2 lines
1B 64 02              ESC d 2
1F 11 08              vendor     battery query
1F 11 0E              vendor
1F 11 07              vendor     firmware query
1F 11 09              vendor     serial query
```

Raster data: MSB-first, 1 = black, 0 = white, each row exactly 48 bytes.

### Vendor status queries (`1F 11 NN`, response on notify as `1A TT VV…`)

| query | response | meaning |
|---|---|---|
| 07 firmware | `1A 07 vL 00 vR` | version |
| 08 battery  | `1A 04 NN` | percent |
| 09 serial   | `1A 08 ascii…` | serial |
| 11 paper    | `1A 06 89/88` | 89 paper / 88 no paper |
| 12 cover    | `1A 05 98/99` | 98 closed / 99 open |
| 13 temp     | `1A 03 A8/A9` | A8 ok / A9 too hot |
| 0E (in footer) | `1A 09 0C` | unknown (observed on M02L fw 1.0.1) |
| — | `1A 0F 0C` | **print complete**, sent unsolicited ~0.1 s after the footer replies |
| — | `01 01` | ack for every write (one per BLE chunk) |
| — | `02 B6 00` | sent once right after connecting / subscribing; meaning unknown |

**Do not probe `1F 11 NN` past 0x14** — sgrankin reports higher opcodes may write firmware state and brick the printer.

### Widths by model

| model | px | bytes/line |
|---|---|---|
| M02, M02X, T02 | 384 | 48 |
| M02S | 512 | 64 |
| M02 Pro | 576 | 72 |

## What was already in this repo (before 2026-10-16)

- `index.ts`: resizes image to 256 px, encodes with `@point-of-sale/receipt-printer-encoder` (columns 32, raster mode), writes the whole buffer in one `writeAsync`. Works-ish but needs hacks:
  - "send a ton of zeros equal to half the buffer" after the image, otherwise the print doesn't finish.
  - `ESC d 6` doesn't work in one go, `ESC d 4` + `ESC d 2` does.
  - `ESC a 2` (right align) does nothing.
- `status-check.ts`: tried standard ESC/POS status commands (`GS r`, `ESC u`, `GS I`, DC3...) — none produce a response. Expected: M02 doesn't implement them; use `1F 11 xx` instead.
- `helpers/htmlToImage.ts`: HTML → SVG `<foreignObject>` → sharp. Sharp's librsvg does **not** render `foreignObject` HTML, so this yields a blank image. Needs replacing with plain SVG `<text>` or a canvas renderer.

## Experiment log

| date | what | result |
|---|---|---|
| 2026-10-16 | Research protocol (see above) | Confirmed: raster-only printer, text commands unsupported by design. |
| 2026-10-16 | Dumped what `receipt-printer-encoder` (columns 32) actually sends for a 256x256 image | Header `1d 76 30 00 20 00 ff 00` = 32 bytes/line, 255 lines. Total 8220 bytes. 32·h + "zeros hack" (4110) = 12302 ≈ 48·h = 12288. **Conclusion: the M02 ignores the width field and always consumes 48 bytes per line.** That's why the zeros were needed to finish the block, and why rows were probably printed re-chunked. Fix: always send 384 px / 48 bytes per row. |
| 2026-10-16 | sharp SVG `<text>` rendering | Blank output. sharp 0.35 here is the wasm build (resvg, no system fonts). `<circle>` renders, text never will. `helpers/htmlToImage.ts` (foreignObject) can't work either. |
| 2026-10-16 | `@napi-rs/canvas` for text | Works: system fonts, `measureText` for word wrap. Added as dependency. |
| 2026-10-16 | New driver `m02.ts` (`image`, `text`, `status`, `--preview`) | Preview PNGs correct for text and image. Job layout verified: header 9 B + 8 B per ≤255-line block + 48·h + 18 B footer. |
| 2026-10-16 | `bun m02.ts status` against the real printer (advertises as **M02L**) | GATT: `ff01[read] ff02[writeWithoutResponse,write] ff03[notify]`. Every `1F 11 xx` query answered on ff03: firmware 1.0.1, battery 72%, serial, paper ok, cover closed, temp ok. Each write is also acked with a `01 01` notification; a `02 b6 00` frame arrives right after connect (meaning unknown). Standard ESC/POS status commands (`status-check.ts`) never got any of this. |
| 2026-10-16 | First real prints with `m02.ts`: text (384x~90) then `images/dog-owl.jpeg` (384x384, 18475 B, 2 blocks) | Bytes went out in 267 ms (182-byte chunks, write-without-response, 2 ms gap). That is faster than BLE can carry, so CoreBluetooth is buffering. Footer status replies did **not** arrive within the 3 s sleep before disconnect → risk of disconnecting with data still queued. **Paper result: nothing came out of any job.** Doug heard the printer "trying" but no paper fed. |
| 2026-10-16 | Completion detection | Printer processes commands in order, so the reply to the footer's serial query (`1A 08 …`) means the raster job has been consumed. Driver now waits for that (30 s timeout) instead of a fixed sleep. |
| 2026-10-16 | Text print #2 (384x72, 3491 B) with completion wait | **Works end to end.** 20 chunks → 20 acks (+1 for the subscribe). Footer replies (battery, `1A 09 0C`, firmware, serial) arrived 2.46 s after sending, followed immediately by `1A 0F 0C` = print complete. So the printer processes commands strictly in order and tells us when it's done. Driver now waits for `1A 0F` (fallback: serial reply + 1.5 s). |
| 2026-10-16 | Image print #2 (384x384, 18475 B = 102 chunks of 182, write-without-response, 0 ms gap) | **Packet loss.** Only 80 acks for 102 chunks, no footer replies, `print complete` only after 18.3 s (printer waited for the missing raster bytes, timed out, printed what it had; the footer bytes were eaten as raster data). The 3.5 KB text job was fine because it fit CoreBluetooth's queue. Cause: noble never checks `canSendWriteWithoutResponse`, so macOS silently drops writes when its buffer fills. |
| 2026-10-16 | Switch to write **with** response (noble `writeAsync(buf, false)`) | Flow controlled: each chunk is ATT-acknowledged before the next goes out. `M02_NO_RESPONSE=1` restores the fast/unsafe mode. Result: see next row. |
| 2026-10-16 | Image print #3, same job, write **with** response | **Works.** 102/102 chunks acked, 3.2 s transfer (~5.7 KB/s), footer replies + `print complete` at 6.1 s. This is the configuration `m02.ts` now defaults to. |

| 2026-10-16 | Doug checked the paper: **none of the 6 jobs produced output.** Printer made noise but never fed. Yet the BLE side was perfect (acks, footer replies, `print complete`). So the firmware is consuming the job; the problem is either mechanical/paper or in how the raster is interpreted. | Bisecting below. |
| 2026-10-16 | Feed-only test: `1B 40  1B 64 08  1B 4A 64` (no raster) | Sent + acked. Printer made noise, **no paper moved**. |
| 2026-10-16 | Re-ran the committed `index.ts` path (encoder, 32-byte rows, zeros hack, single long write) which printed for Doug in 2024 | Script completed. Printer made noise, **nothing printed**. The 2024-working path fails the same way → **the problem is physical (paper / roller / lid), not the protocol.** Next: verify with the power-button feed (no Bluetooth involved), reseat the roll, and validate the paper/cover status codes by querying with the lid open and the roll removed. |

| 2026-10-16 | After Doug reseated the roll: status + feed-only (`1B 40 1B 64 08`) | Status still paper ok / cover closed. **Battery 72% → 55% over ~15 min of jobs that never fed paper** — the head/motor is drawing real current, so the printer is trying. Suspect low-battery torque/brown-out: M02s are known to stall the motor when the cell sags under load. Feed result: noise, no paper movement. |

| 2026-10-16 | **Power-button feed (no Bluetooth)**: noise, paper does not move. | Confirms a mechanical fault independent of anything we send. The firmware thinks it's printing (status ok, battery draining, `print complete` sent) but the platen roller isn't advancing paper. |
| 2026-10-16 | Feed-only again while on the USB charger | Sent + acked. Still no movement — Doug then found the **paper was jammed** and cleared it. |

| 2026-10-16 | After clearing the jam: `bun m02.ts text "it lives" --size 32 --bold --align center` (384x56, 2723 B, 15 chunks) | 15/15 acks. A `1A 0F` print-complete arrived *before* the transfer finished (stale, from the earlier stalled jobs) and tripped the completion wait early. Fixed: wait is armed only after the last chunk is acked. **Paper result: nothing printed.** Disconnecting ~0.9 s after the last ack apparently made the printer drop the job — so stay connected until `1A 0F`. |

| 2026-10-16 | Owl image after the jam fix (384x384, 102 chunks, with response) | 102/102 acks, footer replies, print complete at 6.0 s. **Paper result: printed perfectly.** First confirmed good print. |
| 2026-10-16 | Reprint "it lives" with the fixed wait (384x56, 833 black px) | 15/15 acks, footer replies, print complete at 2.55 s. **Paper result: printed.** Text and image both confirmed working. |

## Current working recipe (as of 2026-10-16) — confirmed on paper

1. Render to a 384-px-wide 1-bit bitmap on the host (sharp + Floyd–Steinberg for photos, `@napi-rs/canvas` for text).
2. Bytes: `1B 40  1B 61 01  1F 11 02 04`, then `1D 76 30 00 30 00 nL nH` + 48·n bytes per ≤255-line block, then `1B 64 02 1B 64 02 1F 11 08 1F 11 0E 1F 11 07 1F 11 09`.
3. Write to `ff02` in 182-byte chunks **with response**. Subscribe to `ff03`.
4. Wait for `1A 0F` (print complete) before disconnecting — arm the wait only after the last chunk is acked. Disconnecting early makes the printer drop the job.

## Lessons

- If the printer makes noise but nothing feeds, check for a paper jam / unlatched lid **before** touching the protocol. The firmware reports paper ok, cover closed and `print complete` even when the roller isn't moving, and the battery drains (72% → 55%) because the head still heats.
- Status codes from sgrankin's M02X doc (paper 0x89, cover 0x98, temp 0xA8) match the M02L.

## Open questions / ideas

- `ESC a` (justify) is in the header because the official app sends it; untested whether it does anything for raster blocks (we center by padding anyway).
- Density: `1F 11 02 04` — the `04` may be a heat/density level (M02X uses `02`). Worth trying 01–05 to see if the print gets darker/lighter.
- `02 B6 00` on connect and `1A 09 0C` reply to `1F 11 0E` are undecoded.
- M02_NO_RESPONSE mode could be made safe by pacing (e.g. ~15 ms per chunk ≈ 12 KB/s), but with-response is simpler and only ~2x slower.
| 2026-10-16 | Bundle JetBrains Mono v2.304 (SIL OFL) in `fonts/`, register via `GlobalFonts.registerFromPath`, make it the default text font | Works; verified the bundled file is what resolves (alias measures 48 px vs 63.7 px for a fallback). Ligatures turn `=>` into ⇒ and `<>` into ◇, so the NL (no-ligature) variant is bundled too as "JetBrains Mono NL". This Mac also has JetBrains Mono installed system-wide, so `GlobalFonts.has()` alone is not proof the bundle is used. |

## Text rendering options (research, 2026-10-16)

Real ESC/POS printers have 12x24 / 9x17 bitmap fonts in ROM; the M02 has none, so text is host-rendered. Choices:

| approach | deps | portability | notes |
|---|---|---|---|
| `@napi-rs/canvas` + bundled TTF (**current**) | native prebuilt | Node/Bun, not browser | easy, good quality, measureText for wrapping |
| embedded bitmap font (8x16 / 12x24) | none | everywhere | ESC/POS look, integer scaling only |
| opentype.js + own rasterizer | pure JS | everywhere | more work |
| satori (+ satori-html) → SVG → sharp | pure JS + sharp | Node/Bun; browser with resvg-wasm | **HTML mode**: flexbox CSS subset, text emitted as paths, fonts passed in explicitly (bundled TTF works) |
| Playwright/Puppeteer | Chromium | heavy | full HTML fidelity, bad fit for a library |

Plan for the library: dependency-free core (bytes, packing, status, transport interface) + optional renderers (image via sharp, html/text via satori) + transports (noble, Web Bluetooth).
| 2026-10-16 | Refactor into a library (`src/`): dependency-free protocol/bitmap/Printer core, Document builder, renderers, noble + Web Bluetooth transports | Typechecks. `webbluetooth` npm package (Web Bluetooth API for Node) was tried for Bun but its 7.x tarball is broken (`dist/index.js` requires a missing `./uuid`), and Doug wants noble for non-web anyway, so: Web Bluetooth standard in browsers, noble in Bun/Node. |
| 2026-10-16 | Bring-your-own-connection: `connect({ device: peripheral })` wrapping a noble peripheral the caller connected | Status works through it; `printer.disconnect()` leaves the peripheral connected (owns=false); the same peripheral can be wrapped a second time; caller disconnects. Web Bluetooth equivalent (`device` / `gatt` server) typechecks, untested in a browser yet. |
| 2026-10-16 | Units API: text `size` presets + `columns`, lengths as px/%/mm, Document rendered at `printer.width` | Demo (xl heading, columns:32 table, 66% image, 10%-margin rule, 4mm space) rendered 384x743 and printed: 196 chunks acked, complete at 8.1 s. |
| 2026-10-16 | Bug: word wrap collapsed runs of spaces, so a `columns: 32` table lost its alignment | Fixed: wrapper keeps whitespace tokens, only trims at wrap points. 32-column receipt table printed aligned (384x120, 32 acks). |
| 2026-10-16 | Auto power-off research | Phomemo docs only mention an adjustable shutdown time for the M02 Pro (app → Manage Devices). `1F 11 0E` is described as a "device timer" query; ours answers 12 — possibly the timer in minutes. The write opcode is undocumented and probing past 0x14 has bricked a unit, so not attempted. Added `printer.keepAlive(ms)` + `onDisconnect()`. Experiment: phase B 20 min with a battery query every 60 s → **still on**; phase A 20 min silent open connection, no traffic → **still on**. Conclusion: the idle timer only runs while nothing is connected; just staying connected keeps the M02 awake, keep-alive traffic is unnecessary. Battery reached 100% on a proper charger during the run. |
| 2026-10-16 | Battery stuck at 41% "all day on the charger" | Not charging: the charge LED was off on a USB-C laptop charger. A plain phone charger made the charge LED blink immediately. Use a basic 5 V / 2 A USB-A adapter (Phomemo's own guidance). Note the gauge reported a flat 41% through 16+ minutes of keep-alive ticks, so it may only re-sample on power-cycle. |
| 2026-10-16 | Idle power-off time after disconnect, printer on a working charger | Scanned for its advertisement for 26 min after disconnecting: **never went away**. So on real external power the M02 does not auto-off (at least not within 26 min). Doug's "turns off even when plugged in" happened on the laptop charger that was delivering nothing, i.e. effectively on battery. Open: measure the on-battery timeout (unplug, disconnect, scan) to see if it matches the 12 from `1F 11 0E`. |

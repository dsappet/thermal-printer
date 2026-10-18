/**
 * High-level document builder. Chain calls, then hand it to `Printer.print()`, which renders
 * it at the printer's width, or call `render(width)` yourself (e.g. for a preview).
 * Everything becomes raster because the M02 can't do anything else.
 */
import { type Bitmap, blank, stack } from "./bitmap.js";
import { type ImageOptions, renderImage } from "./render/image.js";
import { type TextOptions, lineHeightPx, renderText } from "./render/text.js";
import { type Length, REFERENCE_WIDTH, resolveLength } from "./units.js";

type Block = (pageWidth: number) => Promise<Bitmap> | Bitmap;

export interface DocumentOptions {
  /** Defaults applied to every .text() call. */
  text?: TextOptions;
}

export interface RuleOptions {
  thickness?: Length;
  /** Inset from each edge. Default 8. */
  margin?: Length;
  /** Whitespace above and below. Default 6. */
  padding?: Length;
}

export class Document {
  private readonly textDefaults: TextOptions;
  private blocks: Block[] = [];
  /** Options of the most recent text block; newline() uses its line height. */
  private lastText: TextOptions;

  constructor(opts: DocumentOptions = {}) {
    this.textDefaults = { ...opts.text };
    this.lastText = this.textDefaults;
  }

  /** Word-wrapped text. Explicit "\n" starts a new line. */
  text(text: string, opts: TextOptions = {}): this {
    const merged = { ...this.textDefaults, ...opts };
    this.lastText = merged;
    this.blocks.push((w) => renderText(text, merged, w));
    return this;
  }

  /** Advance n blank lines at the current text line height. */
  newline(n = 1): this {
    const opts = this.lastText;
    this.blocks.push((w) => blank(w, lineHeightPx(opts, w) * n));
    return this;
  }

  /** Alias of newline(n), ESC/POS style. */
  feed(n = 1): this {
    return this.newline(n);
  }

  /** Vertical whitespace: px, "%" of page width, or "mm". */
  space(length: Length): this {
    this.blocks.push((w) => blank(w, Math.max(0, resolveLength(length, w, 0))));
    return this;
  }

  /** Horizontal rule. */
  rule(opts: RuleOptions = {}): this {
    this.blocks.push((w) => {
      const t = resolveLength(opts.thickness, w, 2);
      const m = resolveLength(opts.margin, w, 8);
      const p = resolveLength(opts.padding, w, 6);
      const bmp = blank(w, t + p * 2);
      for (let y = p; y < p + t; y++) bmp.gray.fill(0, y * w + m, (y + 1) * w - m);
      return bmp;
    });
    return this;
  }

  /** Image from a path or buffer: fitted to `width` (default full page), dithered, aligned. */
  image(input: string | Buffer, opts: ImageOptions = {}): this {
    this.blocks.push((w) => renderImage(input, opts, w));
    return this;
  }

  /** A pre-rendered bitmap. Must match the page width at render time. */
  bitmap(bmp: Bitmap): this {
    this.blocks.push(() => bmp);
    return this;
  }

  /** Render all blocks into one bitmap of the given page width (default 384 = M02). */
  async render(pageWidth: number = REFERENCE_WIDTH): Promise<Bitmap> {
    const parts: Bitmap[] = [];
    for (const b of this.blocks) parts.push(await b(pageWidth));
    return stack(parts, pageWidth);
  }
}

/** Convenience: `doc().text("hi").newline()` */
export const doc = (opts?: DocumentOptions) => new Document(opts);

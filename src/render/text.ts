/** Text → bitmap using @napi-rs/canvas and the bundled JetBrains Mono. */
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { Align, Bitmap } from "../bitmap";
import { type FontSizeSpec, type Length, REFERENCE_WIDTH, resolveFontSize, resolveLength } from "../units";

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fonts");

/** JetBrains Mono is the font. "NL" is the same face without ligatures. */
export const FONT = "JetBrains Mono";
export const FONT_NL = "JetBrains Mono NL";

const BUNDLED: Record<string, string[]> = {
  [FONT]: ["JetBrainsMono-Regular.ttf", "JetBrainsMono-Bold.ttf"],
  [FONT_NL]: ["JetBrainsMonoNL-Regular.ttf", "JetBrainsMonoNL-Bold.ttf"],
};
for (const [family, files] of Object.entries(BUNDLED)) {
  for (const file of files) GlobalFonts.registerFromPath(join(FONT_DIR, file), family);
}

export interface TextOptions extends Omit<FontSizeSpec, "margin"> {
  bold?: boolean;
  align?: Align;
  /** Line height as a multiple of the font size. Default 1.25. */
  lineHeight?: number;
  /** Horizontal margin (px, "%", "mm"). Default 8. */
  margin?: Length;
  /** Disable ligatures (=> stays two characters). Default false. */
  noLigatures?: boolean;
}

export const TEXT_DEFAULTS = { lineHeight: 1.25, margin: 8 };

interface Resolved {
  width: number;
  size: number;
  margin: number;
  lineHeight: number;
  font: string;
}

function resolve(opts: TextOptions, pageWidth: number): Resolved {
  const margin = resolveLength(opts.margin, pageWidth, TEXT_DEFAULTS.margin);
  const size = resolveFontSize({ ...opts, margin }, pageWidth);
  const family = opts.noLigatures ? FONT_NL : FONT;
  return {
    width: pageWidth,
    size,
    margin,
    lineHeight: Math.round(size * (opts.lineHeight ?? TEXT_DEFAULTS.lineHeight)),
    font: `${opts.bold ? "bold " : ""}${size}px "${family}"`,
  };
}

/** Line height in px that .text() with these options would use on a page this wide. */
export function lineHeightPx(opts: TextOptions = {}, pageWidth = REFERENCE_WIDTH): number {
  return resolve(opts, pageWidth).lineHeight;
}

/**
 * Greedy word wrap honouring explicit newlines. Runs of spaces are preserved (so hand-aligned
 * columns survive); words longer than a line break by character.
 */
export function wrapText(text: string, opts: TextOptions = {}, pageWidth = REFERENCE_WIDTH): string[] {
  const r = resolve(opts, pageWidth);
  const maxWidth = r.width - r.margin * 2;
  const ctx = createCanvas(1, 1).getContext("2d");
  ctx.font = r.font;
  const fits = (s: string) => ctx.measureText(s).width <= maxWidth;

  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    if (fits(para)) {
      lines.push(para);
      continue;
    }
    let cur = "";
    for (const token of para.match(/\s+|\S+/g) ?? []) {
      if (fits(cur + token)) {
        cur += token;
        continue;
      }
      // Overflow: close the current line and start a new one with this token.
      if (cur.trim()) lines.push(cur.trimEnd());
      cur = "";
      if (/^\s+$/.test(token)) continue; // never start a line with wrapped whitespace
      if (fits(token)) {
        cur = token;
      } else {
        for (const ch of token) {
          if (!fits(cur + ch)) {
            lines.push(cur);
            cur = ch;
          } else cur += ch;
        }
      }
    }
    lines.push(cur.trimEnd()); // keeps blank lines
  }
  return lines;
}

/** Render wrapped text at the given page width. Height = lines * lineHeight. */
export function renderText(text: string, opts: TextOptions = {}, pageWidth = REFERENCE_WIDTH): Bitmap {
  const r = resolve(opts, pageWidth);
  const align = opts.align ?? "left";
  const lines = wrapText(text, opts, pageWidth);
  const height = Math.max(r.lineHeight, lines.length * r.lineHeight);

  const canvas = createCanvas(r.width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, r.width, height);
  ctx.fillStyle = "#000";
  ctx.font = r.font;
  ctx.textBaseline = "middle";
  ctx.textAlign = align;
  const x = align === "left" ? r.margin : align === "right" ? r.width - r.margin : r.width / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, i * r.lineHeight + r.lineHeight / 2));

  const rgba = ctx.getImageData(0, 0, r.width, height).data;
  const gray = new Uint8Array(r.width * height);
  for (let i = 0; i < gray.length; i++) {
    // Threshold a little aggressively so anti-aliased edges print solid.
    gray[i] = rgba[i * 4] < 160 ? 0 : 255;
  }
  return { width: r.width, height, gray };
}

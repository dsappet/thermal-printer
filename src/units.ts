/** Lengths and sizes. The page width is only known at print time, so everything resolves lazily. */

/** Phomemo M02 family prints at 203 dpi = 8 dots per mm. */
export const DPI = 203;
export const PX_PER_MM = 8;

/**
 * A length: a number is px; a string may be "50%" (of the page width), "30mm", or "120px".
 */
export type Length = number | string;

export function resolveLength(value: Length | undefined, pageWidth: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value === "number") return Math.round(value);
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(%|mm|px)?\s*$/.exec(value);
  if (!m) throw new Error(`Bad length "${value}" (use px, "50%" or "30mm")`);
  const n = Number(m[1]);
  switch (m[2]) {
    case "%": return Math.round((n / 100) * pageWidth);
    case "mm": return Math.round(n * PX_PER_MM);
    default: return Math.round(n);
  }
}

export const mm = (n: number) => n * PX_PER_MM;

/** Named text sizes, in px at the reference 384 px page; scaled for wider printers. */
export const SIZE_PRESETS = { xs: 16, sm: 20, md: 24, lg: 32, xl: 40, xxl: 52 } as const;
export type SizePreset = keyof typeof SIZE_PRESETS;
export const REFERENCE_WIDTH = 384;

/** JetBrains Mono advance width as a fraction of font size. */
export const MONO_ADVANCE = 0.6;

export interface FontSizeSpec {
  /** px, or a preset name. Default "md". */
  size?: number | SizePreset;
  /** Pick the size so this many characters fit on a line (wins over size). */
  columns?: number;
  /** Horizontal margin, used by the columns calculation. */
  margin?: number;
}

export function resolveFontSize(spec: FontSizeSpec, pageWidth: number): number {
  if (spec.columns && spec.columns > 0) {
    const usable = pageWidth - (spec.margin ?? 0) * 2;
    return Math.floor(usable / (spec.columns * MONO_ADVANCE));
  }
  const s = spec.size ?? "md";
  if (typeof s === "number") return Math.round(s);
  if (!(s in SIZE_PRESETS)) throw new Error(`Unknown text size "${s}" (${Object.keys(SIZE_PRESETS).join(", ")} or px)`);
  return Math.round(SIZE_PRESETS[s] * (pageWidth / REFERENCE_WIDTH));
}

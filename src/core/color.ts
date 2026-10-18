import type { Color, CurvsDocument, Paint, SrgbColor, Swatch } from './types';

export const rgb = (r: number, g: number, b: number, a = 1): SrgbColor => ({ space: 'srgb', r, g, b, a });

export function hexToColor(hex: string): SrgbColor | null {
  let h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3,4}$/i.test(h))
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return rgb(n(0), n(2), n(4), h.length === 8 ? n(6) : 1);
}

const to255 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
const hex2 = (v: number) => to255(v).toString(16).padStart(2, '0').toUpperCase();

export function colorToHex(c: SrgbColor, withAlpha = false): string {
  return hex2(c.r) + hex2(c.g) + hex2(c.b) + (withAlpha && c.a < 1 ? hex2(c.a) : '');
}

/** Resolve a color (following swatch links) into sRGB. */
export function resolveColor(c: Color, swatches: Swatch[] | CurvsDocument['swatches'] = []): SrgbColor {
  if ('swatch' in c) {
    const s = swatches.find((x) => x.id === c.swatch);
    return s ? resolveColor(s.color, []) : rgb(0, 0, 0, 1);
  }
  switch (c.space) {
    case 'srgb':
      return c;
    case 'display-p3':
      return p3ToSrgb(c.r, c.g, c.b, c.a);
    case 'cmyk':
      return rgb((1 - c.c) * (1 - c.k), (1 - c.m) * (1 - c.k), (1 - c.y) * (1 - c.k), c.a);
    case 'spot':
      return { ...c.fallback, a: c.a };
  }
}

export function cssColor(c: Color, swatches: Swatch[] = [], opacity = 1): string {
  const s = resolveColor(c, swatches);
  const a = Math.round(s.a * opacity * 1000) / 1000;
  return `rgba(${to255(s.r)}, ${to255(s.g)}, ${to255(s.b)}, ${a})`;
}

/** Short CSS for export: #RRGGBB when opaque. */
export function cssHex(c: Color, swatches: Swatch[] = []): { color: string; alpha: number } {
  const s = resolveColor(c, swatches);
  return { color: '#' + colorToHex(s).toLowerCase(), alpha: s.a };
}

export function paintPrimaryColor(p: Paint): Color {
  return p.type === 'solid' ? p.color : (p.stops[0]?.color ?? rgb(0, 0, 0));
}

// ---- HSB ----
export function rgbToHsb(c: SrgbColor): { h: number; s: number; b: number } {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === c.r) h = ((c.g - c.b) / d) % 6;
    else if (max === c.g) h = (c.b - c.r) / d + 2;
    else h = (c.r - c.g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, b: max };
}

export function hsbToRgb(h: number, s: number, v: number, a = 1): SrgbColor {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgb(f(5), f(3), f(1), a);
}

// ---- CMYK (naive device conversion, phase 1) ----
export function rgbToCmyk(c: SrgbColor) {
  const k = 1 - Math.max(c.r, c.g, c.b);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 };
  return { c: (1 - c.r - k) / (1 - k), m: (1 - c.g - k) / (1 - k), y: (1 - c.b - k) / (1 - k), k };
}

// ---- OKLCH ----
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

export function rgbToOklch(c: SrgbColor): { l: number; c: number; h: number } {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c: Math.hypot(A, B), h };
}

export function oklchToRgb(L: number, C: number, H: number, alpha = 1): SrgbColor {
  const hr = (H * Math.PI) / 180;
  const A = C * Math.cos(hr);
  const B = C * Math.sin(hr);
  const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
  const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
  const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return rgb(
    clamp(fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp(fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp(fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
    alpha,
  );
}

function p3ToSrgb(r: number, g: number, b: number, a: number): SrgbColor {
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return rgb(
    clamp(fromLinear(1.2249 * R - 0.2247 * G + 0 * B)),
    clamp(fromLinear(-0.042 * R + 1.0419 * G + 0 * B)),
    clamp(fromLinear(-0.0197 * R - 0.0786 * G + 1.0979 * B)),
    a,
  );
}

/** Parse a CSS color string (hex, rgb(), rgba(), named basics). */
export function parseCssColor(s: string): SrgbColor | null {
  const v = s.trim().toLowerCase();
  if (!v || v === 'none' || v === 'transparent') return null;
  if (v.startsWith('#')) return hexToColor(v);
  const m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (p: string) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p) / 255);
    const a =
      parts[3] !== undefined
        ? parts[3].endsWith('%')
          ? parseFloat(parts[3]) / 100
          : parseFloat(parts[3])
        : 1;
    return rgb(ch(parts[0]), ch(parts[1]), ch(parts[2]), a);
  }
  const hsl = v.match(/^hsla?\(([^)]+)\)$/);
  if (hsl) {
    const parts = hsl[1].split(/[\s,/]+/).filter(Boolean);
    const h = parseFloat(parts[0]);
    const sat = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
    const k = (n: number) => (n + h / 30) % 12;
    const aa = sat * Math.min(l, 1 - l);
    const f = (n: number) => l - aa * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return rgb(f(0), f(8), f(4), a);
  }
  const named = NAMED[v];
  return named ? hexToColor(named) : null;
}

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  navy: '#000080',
  teal: '#008080',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  cyan: '#00ffff',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  gold: '#ffd700',
  indigo: '#4b0082',
  violet: '#ee82ee',
  coral: '#ff7f50',
  salmon: '#fa8072',
  tomato: '#ff6347',
  crimson: '#dc143c',
  khaki: '#f0e68c',
  beige: '#f5f5dc',
  ivory: '#fffff0',
  lavender: '#e6e6fa',
  turquoise: '#40e0d0',
  tan: '#d2b48c',
  chocolate: '#d2691e',
  darkgray: '#a9a9a9',
  lightgray: '#d3d3d3',
  darkblue: '#00008b',
  darkgreen: '#006400',
  darkred: '#8b0000',
  steelblue: '#4682b4',
  skyblue: '#87ceeb',
  slategray: '#708090',
  whitesmoke: '#f5f5f5',
};

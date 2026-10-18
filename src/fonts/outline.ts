/* Text to outlines (Create Outlines, SVG/PDF export) and the canvas text measurer. */
import type { FontRef, PathNode, Subpath, TextNode, TextRun } from '../core/types';
import { cssFont, layoutText, primaryRun, setMeasurer, type Measurer } from '../core/text';
import { getFontBytes, onFontLoaded } from './loader';

/** The slice of opentype.js's Font this module uses. */
export type OtCommand =
  | { type: 'M' | 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'Z' };
export type OtFont = {
  unitsPerEm: number;
  getPath(
    text: string,
    x: number,
    y: number,
    fontSize: number,
    options?: Record<string, unknown>,
  ): { commands: OtCommand[] };
  getAdvanceWidth(text: string, fontSize: number, options?: Record<string, unknown>): number;
};

const DEFAULT_TAGS = ['liga', 'rlig'];

/** opentype render options for a run: kerning on, tracking in 1/1000 em, OpenType features toggled from run.features. */
function renderOptions(run: TextRun): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    kerning: run.features?.kern !== false,
    tracking: run.tracking || 0,
  };
  const feats = run.features ?? {};
  if (Object.keys(feats).length) {
    const tags = new Set(DEFAULT_TAGS);
    for (const [tag, on] of Object.entries(feats)) {
      if (tag === 'kern') continue;
      if (on) tags.add(tag);
      else tags.delete(tag);
    }
    opts.features = [{ script: 'latn', tags: [...tags] }];
  }
  return opts;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Mark a node smooth when both handles exist and are collinear through it. */
function classify(n: PathNode): PathNode {
  if (!n.in || !n.out) return n;
  const ax = n.x - n.in[0],
    ay = n.y - n.in[1],
    bx = n.out[0] - n.x,
    by = n.out[1] - n.y;
  const la = Math.hypot(ax, ay),
    lb = Math.hypot(bx, by);
  if (la < 1e-9 || lb < 1e-9) return n;
  const cross = (ax * by - ay * bx) / (la * lb);
  const dot = ax * bx + ay * by;
  if (Math.abs(cross) < 1e-3 && dot > 0) n.kind = Math.abs(la - lb) < 1e-6 ? 'symmetric' : 'smooth';
  return n;
}

/**
 * Convert opentype path commands (y-down) to subpaths; quadratic segments become cubics.
 * Glyph contours are always closed, but opentype omits the final Z of TrueType glyphs, so
 * `assumeClosed` closes every contour.
 */
export function commandsToSubpaths(commands: readonly OtCommand[], assumeClosed = false): Subpath[] {
  const out: Subpath[] = [];
  let cur: Subpath | null = null;
  const finish = () => {
    if (!cur) return;
    if (assumeClosed) cur.closed = true;
    const nodes = cur.nodes;
    if (cur.closed && nodes.length > 1) {
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (near(first.x, last.x) && near(first.y, last.y)) {
        first.in = last.in;
        nodes.pop();
      }
    }
    if (nodes.length) {
      nodes.forEach(classify);
      out.push(cur);
    }
    cur = null;
  };
  const node = (x: number, y: number): PathNode => ({ x, y, in: null, out: null, kind: 'sharp' });
  for (const c of commands) {
    if (c.type === 'M') {
      finish();
      cur = { closed: false, nodes: [node(c.x, c.y)] };
      continue;
    }
    if (c.type === 'Z') {
      if (cur) cur.closed = true;
      finish();
      continue;
    }
    if (!cur) cur = { closed: false, nodes: [node(0, 0)] };
    const prev = cur.nodes[cur.nodes.length - 1];
    if (c.type === 'L') cur.nodes.push(node(c.x, c.y));
    else if (c.type === 'C') {
      prev.out = [c.x1, c.y1];
      const n = node(c.x, c.y);
      n.in = [c.x2, c.y2];
      cur.nodes.push(n);
    } else if (c.type === 'Q') {
      prev.out = [prev.x + (2 / 3) * (c.x1 - prev.x), prev.y + (2 / 3) * (c.y1 - prev.y)];
      const n = node(c.x, c.y);
      n.in = [c.x + (2 / 3) * (c.x1 - c.x), c.y + (2 / 3) * (c.y1 - c.y)];
      cur.nodes.push(n);
    }
  }
  finish();
  return out;
}

/**
 * Outline a text node in its local space (y-down). Line positions and baselines come from
 * layoutText; centred and right-aligned lines are re-anchored on the font's own advance widths.
 */
export function textToSubpaths(node: TextNode, font: OtFont): Subpath[] {
  const run = primaryRun(node);
  if (!run) return [];
  const layout = layoutText(node);
  const opts = renderOptions(run);
  const out: Subpath[] = [];
  for (const line of layout.lines) {
    if (!line.text) continue;
    let x = line.x;
    if (node.paragraph.align === 'center' || node.paragraph.align === 'right') {
      // opentype adds tracking after the last glyph too; the layout measures n - 1 gaps.
      const w = font.getAdvanceWidth(line.text, run.size, opts) - ((run.tracking || 0) * run.size) / 1000;
      x = node.paragraph.align === 'center' ? line.x + (line.width - w) / 2 : line.x + line.width - w;
    }
    out.push(...commandsToSubpaths(font.getPath(line.text, x, line.baseline, run.size, opts).commands, true));
  }
  return out;
}

type OpentypeModule = { parse(buffer: ArrayBuffer): OtFont };
let otModule: Promise<OpentypeModule> | null = null;
const loadOpentype = () =>
  (otModule ??= import('opentype.js').then((m: unknown) => {
    const mod = m as Partial<OpentypeModule> & { default?: OpentypeModule };
    return (mod.parse ? mod : mod.default) as OpentypeModule;
  }));

const parsed = new Map<string, Promise<OtFont | null>>();

/** The parsed opentype font for a FontRef (cached), or null when the face is unavailable. */
export function getParsedFont(font: FontRef): Promise<OtFont | null> {
  const key = `${font.family}|${font.weight}|${font.style}`;
  let p = parsed.get(key);
  if (!p) {
    p = (async () => {
      const bytes = await getFontBytes(font);
      if (!bytes) return null;
      try {
        const ot = await loadOpentype();
        return ot.parse(bytes.slice().buffer);
      } catch {
        return null;
      }
    })();
    parsed.set(key, p);
    // A miss (offline) may succeed later in the session once bytes arrive from elsewhere.
    void p.then((f) => {
      if (!f) parsed.delete(key);
    });
  }
  return p;
}

/** Outline a text node with its primary run's face. Null when the face cannot be loaded. */
export async function outlineText(node: TextNode): Promise<Subpath[] | null> {
  const run = primaryRun(node);
  if (!run) return null;
  const font = await getParsedFont(run.font);
  return font ? textToSubpaths(node, font) : null;
}

/* ---------- canvas measurer ---------- */

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeContext(): Ctx2D | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(1, 1).getContext('2d');
      if (c) return c;
    }
  } catch {
    /* fall through */
  }
  try {
    if (typeof document === 'undefined') return null;
    return document.createElement('canvas').getContext('2d');
  } catch {
    return null;
  }
}

let uninstall: (() => void) | null = null;

/**
 * Measure text with a real 2D canvas so layout matches what the canvas draws.
 * Re-installs itself when a font loads (which also clears cached layouts).
 * Returns false (and leaves the estimate in place) when no 2D context exists.
 */
export function installCanvasMeasurer(): boolean {
  if (uninstall) return true;
  const ctx = makeContext();
  if (!ctx || typeof ctx.measureText !== 'function') return false;
  if ('fontKerning' in ctx) ctx.fontKerning = 'normal';
  const measure: Measurer = (text, run) => {
    if (!text) return 0;
    ctx.font = cssFont(run);
    const w = ctx.measureText(text).width;
    const n = [...text].length;
    return w + (Math.max(0, n - 1) * (run.tracking || 0) * run.size) / 1000;
  };
  setMeasurer(measure);
  const off = onFontLoaded(() => setMeasurer(measure));
  uninstall = () => {
    off();
    uninstall = null;
  };
  return true;
}

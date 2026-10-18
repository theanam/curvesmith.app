/* Font access for writers: TrueType bytes from the font loader, parsed with opentype.js for outlines. */
import type { FontRef, PathNode, Subpath, TextNode } from '../../core/types';
import { getFontBytes } from '../../fonts/loader';
import { layoutText, primaryRun } from '../../core/text';

type OtCommand = { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number };
export type OtFont = {
  unitsPerEm: number;
  getPath(
    text: string,
    x: number,
    y: number,
    fontSize: number,
    options?: Record<string, unknown>,
  ): { commands: OtCommand[] };
};
type OtModule = { parse(buffer: ArrayBuffer): OtFont };

let otModule: Promise<OtModule | null> | null = null;

/** opentype.js, loaded on first use. Handles both its ESM and UMD builds. */
export function loadOpentype(): Promise<OtModule | null> {
  otModule ??= import('opentype.js')
    .then((m: Record<string, unknown>) => {
      const mod = (typeof m.parse === 'function' ? m : (m.default as Record<string, unknown> | undefined)) as
        OtModule | undefined;
      return mod && typeof mod.parse === 'function' ? mod : null;
    })
    .catch(() => null);
  return otModule;
}

export const fontKey = (f: FontRef) => `${f.family}|${f.weight}|${f.style}`;

export type LoadedFont = { bytes: Uint8Array; font: OtFont | null };

/** Fetch and parse every font used by the given text nodes. Missing fonts are absent from the map. */
export async function loadFonts(nodes: TextNode[]): Promise<Map<string, LoadedFont>> {
  const out = new Map<string, LoadedFont>();
  const refs = new Map<string, FontRef>();
  for (const n of nodes) for (const r of n.runs) refs.set(fontKey(r.font), r.font);
  if (!refs.size) return out;
  const ot = await loadOpentype();
  for (const [key, ref] of refs) {
    let bytes: Uint8Array | null;
    try {
      bytes = await getFontBytes(ref);
    } catch {
      bytes = null;
    }
    if (!bytes) continue;
    let font: OtFont | null;
    try {
      font = ot ? ot.parse(bytes.slice().buffer) : null;
    } catch {
      font = null;
    }
    out.set(key, { bytes, font });
  }
  return out;
}

/** Glyph outlines of a text node, in its local space (same layout as the canvas renderer). */
export function textOutlines(n: TextNode, font: OtFont): Subpath[] {
  const run = primaryRun(n);
  const layout = layoutText(n);
  const out: Subpath[] = [];
  for (const line of layout.lines) {
    if (!line.text) continue;
    const path = font.getPath(line.text, line.x, line.baseline, run.size, {
      kerning: true,
      tracking: run.tracking,
    });
    out.push(...commandsToSubpaths(path.commands));
  }
  return out;
}

/** opentype.js path commands → closed subpaths (glyph contours are always closed, with or without Z). */
export function commandsToSubpaths(cmds: OtCommand[]): Subpath[] {
  const out: Subpath[] = [];
  let cur: Subpath | null = null;
  let x = 0;
  let y = 0;
  const node = (px: number, py: number): PathNode => ({ x: px, y: py, in: null, out: null, kind: 'sharp' });
  const close = () => {
    if (!cur) return;
    const f = cur.nodes[0];
    const l = cur.nodes[cur.nodes.length - 1];
    if (cur.nodes.length > 1 && Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) {
      f.in = l.in;
      cur.nodes.pop();
    }
    cur.closed = true;
    cur = null;
  };
  for (const c of cmds) {
    if (c.type === 'M') {
      close();
      cur = { closed: false, nodes: [node(c.x!, c.y!)] };
      out.push(cur);
      x = c.x!;
      y = c.y!;
    } else if (!cur) continue;
    else if (c.type === 'L') {
      cur.nodes.push(node(c.x!, c.y!));
      x = c.x!;
      y = c.y!;
    } else if (c.type === 'C' || c.type === 'Q') {
      const last = cur.nodes[cur.nodes.length - 1];
      let c1: [number, number];
      let c2: [number, number];
      if (c.type === 'C') {
        c1 = [c.x1!, c.y1!];
        c2 = [c.x2!, c.y2!];
      } else {
        c1 = [x + (2 / 3) * (c.x1! - x), y + (2 / 3) * (c.y1! - y)];
        c2 = [c.x! + (2 / 3) * (c.x1! - c.x!), c.y! + (2 / 3) * (c.y1! - c.y!)];
      }
      last.out = c1;
      cur.nodes.push({ ...node(c.x!, c.y!), in: c2 });
      x = c.x!;
      y = c.y!;
    } else if (c.type === 'Z') close();
  }
  close();
  return out.filter((s) => s.nodes.length > 1);
}

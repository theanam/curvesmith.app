/* DXF writer: AutoCAD R12 ASCII (AC1009), the version every cutter and CAD package reads.
   One layer per top-level group (else the artboard's name). Curves are flattened to closed/open POLYLINEs
   within a tolerance; circles stay CIRCLEs when the transform keeps them round. DXF is y-up: y is flipped
   against the page height. Fills and effects have no meaning for cutters and are left out. */
import type { CurvsDocument, ExportScope, Matrix, Paint, SceneNode, Subpath, Unit } from '../../core/types';
import { apply, multiply } from '../../core/matrix';
import { flattenSubpath, transformSubpath } from '../../core/geometry/bezier';
import { nodeSubpaths } from '../../core/geometry/node';
import { resolveColor } from '../../core/color';
import { layoutText, primaryRun } from '../../core/text';
import { PT_PER } from '../../core/units';
import { type ExportContext, warner } from '../types';
import type { DxfExportOptions } from '../registry';
import { pagesForScope } from '../shared/pages';
import { collectText } from '../shared/scene';
import { fontKey, loadFonts, textOutlines, type LoadedFont } from '../shared/fonts';

/** AutoCAD Color Index → sRGB for the standard colors used in both directions. */
export const ACI_BASIC: Record<number, [number, number, number]> = {
  1: [255, 0, 0],
  2: [255, 255, 0],
  3: [0, 255, 0],
  4: [0, 255, 255],
  5: [0, 0, 255],
  6: [255, 0, 255],
  7: [0, 0, 0],
  8: [128, 128, 128],
  9: [192, 192, 192],
  250: [51, 51, 51],
  251: [80, 80, 80],
  252: [105, 105, 105],
  253: [130, 130, 130],
  254: [190, 190, 190],
  255: [255, 255, 255],
};

/** ACI → RGB, including the hue wheel 10–249 (approximation of AutoCAD's palette). */
export function aciToRgb(i: number): [number, number, number] {
  const basic = ACI_BASIC[i];
  if (basic) return basic;
  if (i < 10 || i > 249) return [0, 0, 0];
  const hue = Math.floor((i - 10) / 10) * 15;
  const sub = (i - 10) % 10;
  const value = [1, 1, 0.8, 0.8, 0.6, 0.6, 0.5, 0.5, 0.3, 0.3][sub];
  const sat = sub % 2 ? 0.5 : 1;
  const f = (k: number) => {
    const kk = (k + hue / 60) % 6;
    return value - value * sat * Math.max(0, Math.min(kk, 4 - kk, 1));
  };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}

export function rgbToAci(r: number, g: number, b: number): number {
  let best = 7;
  let bestD = Infinity;
  for (let i = 1; i <= 255; i++) {
    const [R, G, B] = aciToRgb(i);
    const d = (R - r) ** 2 * 0.3 + (G - g) ** 2 * 0.59 + (B - b) ** 2 * 0.11;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export const INSUNITS: Record<DxfExportOptions['units'], number> = { mm: 4, in: 1, px: 0 };

const fmt = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? '0.0' : Number.isInteger(r) ? r.toFixed(1) : String(r);
};

class Dxf {
  lines: string[] = [];
  pair(code: number, value: string | number) {
    this.lines.push(String(code).padStart(3, ' '), typeof value === 'number' ? fmt(value) : value);
  }
  int(code: number, value: number) {
    this.lines.push(String(code).padStart(3, ' '), String(Math.round(value)).padStart(6, ' '));
  }
}

function layerName(name: string, used: Map<string, string>): string {
  const existing = used.get(name);
  if (existing) return existing;
  let base = name
    .toUpperCase()
    .replace(/[^A-Z0-9_$-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 31);
  if (!base) base = 'LAYER';
  let n = base;
  const taken = new Set(used.values());
  for (let i = 2; taken.has(n); i++) n = `${base.slice(0, 28)}_${i}`;
  used.set(name, n);
  return n;
}

type Shape =
  | { layer: string; color: number; kind: 'poly'; points: [number, number][]; closed: boolean }
  | { layer: string; color: number; kind: 'circle'; cx: number; cy: number; r: number }
  | {
      layer: string;
      color: number;
      kind: 'text';
      x: number;
      y: number;
      height: number;
      rotation: number;
      text: string;
    };

export async function exportDxfString(
  doc: CurvsDocument,
  scope: ExportScope,
  options: Partial<DxfExportOptions>,
  ctx: ExportContext,
): Promise<string> {
  const warn = warner(ctx);
  const units: DxfExportOptions['units'] = options.units ?? 'mm';
  const k = 1 / PT_PER[units as Unit];
  const tol = Math.max(0.005, options.tolerance ?? 0.1) * PT_PER[units as Unit];
  const page = pagesForScope(doc, scope, ctx, false)[0];
  if (!page) throw new Error('Nothing to export.');
  const fonts: Map<string, LoadedFont> = await loadFonts(collectText(page, doc));
  const H = page.height;
  // Page space (y down, pt) → DXF space (y up, units).
  const toDxf: Matrix = [k, 0, 0, -k, 0, H * k];
  const used = new Map<string, string>();
  const shapes: Shape[] = [];

  const colorOf = (n: SceneNode): number => {
    const items = n.appearance.items.filter((i) => i.visible);
    const pick = items.find((i) => i.kind === 'stroke') ?? items.find((i) => i.kind === 'fill');
    const p: Paint | null = pick && 'paint' in pick ? pick.paint : null;
    if (!p) return 7;
    const c = resolveColor(
      p.type === 'solid' ? p.color : (p.stops[0]?.color ?? { space: 'srgb', r: 0, g: 0, b: 0, a: 1 }),
      doc.swatches,
    );
    return rgbToAci(c.r * 255, c.g * 255, c.b * 255);
  };

  const emitSubpaths = (subpaths: Subpath[], m: Matrix, layer: string, color: number) => {
    for (const sp of subpaths) {
      if (sp.nodes.length < 2) continue;
      const pts = flattenSubpath(transformSubpath(sp, m), tol).map((p) => apply(toDxf, p));
      if (sp.closed && pts.length > 2) {
        const a = pts[0];
        const b = pts[pts.length - 1];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) pts.pop();
      }
      shapes.push({ layer, color, kind: 'poly', points: pts, closed: sp.closed });
    }
  };

  const visit = (n: SceneNode, parent: Matrix, layer: string, depth: number) => {
    if (!n.visible || depth > 64) return;
    const m = multiply(parent, n.transform);
    switch (n.type) {
      case 'group':
        n.children.forEach((c) => visit(c, m, layer, depth + 1));
        return;
      case 'clipGroup':
        warn('Clipping was ignored; clipped objects are exported whole.');
        n.children.forEach((c) => visit(c, m, layer, depth + 1));
        return;
      case 'instance': {
        const sym = doc.symbols.find((s) => s.id === n.symbol);
        if (sym) visit(sym.root, m, layer, depth + 1);
        return;
      }
      case 'image':
        warn('Images were left out.');
        return;
      case 'text': {
        const font = fonts.get(fontKey(n.runs[0].font))?.font;
        if (font) {
          emitSubpaths(textOutlines(n, font), m, layer, colorOf(n));
          return;
        }
        warn('Text without an available font was written as DXF text.');
        const run = primaryRun(n);
        const full = multiply(toDxf, m);
        const scale = Math.hypot(full[0], full[1]);
        const rot = (Math.atan2(full[1], full[0]) * 180) / Math.PI;
        for (const line of layoutText(n).lines) {
          if (!line.text) continue;
          const [x, y] = apply(full, [line.x, line.baseline]);
          shapes.push({
            layer,
            color: colorOf(n),
            kind: 'text',
            x,
            y,
            height: run.size * 0.72 * scale,
            rotation: rot,
            text: line.text,
          });
        }
        return;
      }
      case 'ellipse': {
        const full = multiply(toDxf, m);
        const sx = Math.hypot(full[0], full[1]);
        const sy = Math.hypot(full[2], full[3]);
        const orthogonal = Math.abs(full[0] * full[2] + full[1] * full[3]) < 1e-9 * sx * sy;
        const isFull =
          n.arcStart === undefined ||
          n.arcEnd === undefined ||
          n.arcStart === n.arcEnd ||
          Math.abs(n.arcEnd - n.arcStart) >= 360;
        if (
          isFull &&
          orthogonal &&
          Math.abs(Math.abs(n.rx) * sx - Math.abs(n.ry) * sy) < 1e-9 * Math.max(1, sx)
        ) {
          const [cx, cy] = apply(full, [0, 0]);
          shapes.push({ layer, color: colorOf(n), kind: 'circle', cx, cy, r: Math.abs(n.rx) * sx });
          return;
        }
        emitSubpaths(nodeSubpaths(n, doc), m, layer, colorOf(n));
        return;
      }
      default:
        emitSubpaths(nodeSubpaths(n, doc), m, layer, colorOf(n));
    }
  };
  for (const r of page.roots) visit(r.node, r.m, layerName(r.layer, used), 0);
  if (
    doc.artboards.some((a) =>
      a.children.some((c) => c.appearance.items.some((i) => i.kind === 'effect' && i.visible)),
    )
  )
    warn('Effects were left out.');

  const d = new Dxf();
  const W = page.width * k;
  const Hk = page.height * k;
  d.pair(0, 'SECTION');
  d.pair(2, 'HEADER');
  d.pair(9, '$ACADVER');
  d.pair(1, 'AC1009');
  d.pair(9, '$INSUNITS');
  d.int(70, INSUNITS[units]);
  d.pair(9, '$MEASUREMENT');
  d.int(70, units === 'in' ? 0 : 1);
  d.pair(9, '$EXTMIN');
  d.pair(10, 0);
  d.pair(20, 0);
  d.pair(30, 0);
  d.pair(9, '$EXTMAX');
  d.pair(10, W);
  d.pair(20, Hk);
  d.pair(30, 0);
  d.pair(9, '$LIMMIN');
  d.pair(10, 0);
  d.pair(20, 0);
  d.pair(9, '$LIMMAX');
  d.pair(10, W);
  d.pair(20, Hk);
  d.pair(0, 'ENDSEC');

  const layers = [...new Set(['0', ...shapes.map((s) => s.layer)])];
  d.pair(0, 'SECTION');
  d.pair(2, 'TABLES');
  d.pair(0, 'TABLE');
  d.pair(2, 'LTYPE');
  d.int(70, 1);
  d.pair(0, 'LTYPE');
  d.pair(2, 'CONTINUOUS');
  d.int(70, 0);
  d.pair(3, 'Solid line');
  d.int(72, 65);
  d.int(73, 0);
  d.pair(40, 0);
  d.pair(0, 'ENDTAB');
  d.pair(0, 'TABLE');
  d.pair(2, 'LAYER');
  d.int(70, layers.length);
  for (const l of layers) {
    d.pair(0, 'LAYER');
    d.pair(2, l);
    d.int(70, 0);
    d.int(62, 7);
    d.pair(6, 'CONTINUOUS');
  }
  d.pair(0, 'ENDTAB');
  d.pair(0, 'ENDSEC');

  d.pair(0, 'SECTION');
  d.pair(2, 'ENTITIES');
  for (const s of shapes) {
    if (s.kind === 'circle') {
      d.pair(0, 'CIRCLE');
      d.pair(8, s.layer);
      d.int(62, s.color);
      d.pair(10, s.cx);
      d.pair(20, s.cy);
      d.pair(30, 0);
      d.pair(40, s.r);
    } else if (s.kind === 'text') {
      d.pair(0, 'TEXT');
      d.pair(8, s.layer);
      d.int(62, s.color);
      d.pair(10, s.x);
      d.pair(20, s.y);
      d.pair(30, 0);
      d.pair(40, s.height);
      d.pair(1, s.text.replace(/[\r\n]/g, ' '));
      if (Math.abs(s.rotation) > 1e-6) d.pair(50, s.rotation);
    } else {
      if (s.points.length < 2) continue;
      d.pair(0, 'POLYLINE');
      d.pair(8, s.layer);
      d.int(62, s.color);
      d.int(66, 1);
      d.pair(10, 0);
      d.pair(20, 0);
      d.pair(30, 0);
      d.int(70, s.closed ? 1 : 0);
      for (const [x, y] of s.points) {
        d.pair(0, 'VERTEX');
        d.pair(8, s.layer);
        d.pair(10, x);
        d.pair(20, y);
        d.pair(30, 0);
      }
      d.pair(0, 'SEQEND');
      d.pair(8, s.layer);
    }
  }
  d.pair(0, 'ENDSEC');
  d.pair(0, 'EOF');
  return d.lines.join('\r\n') + '\r\n';
}

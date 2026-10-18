/* DXF reader (ASCII). Lines, polylines (with bulge arcs), circles, arcs, ellipses, splines, text and
   block inserts become paths, ellipses and text; each layer becomes a group. $INSUNITS sets the scale and
   the document units. DXF is y-up, so y is flipped against the drawing extents. */
import type {
  CurvsDocument,
  ImportReport,
  Matrix,
  PathNode,
  SceneNode,
  Subpath,
  Unit,
  Vec,
} from '../../core/types';
import { createDocument, makeEllipse, makeGroup, makePath, makeStroke, makeText } from '../../core/document';
import { apply, IDENTITY, multiply, rotate, scale, translate } from '../../core/matrix';
import { arcToCubics } from '../../core/geometry/pathdata';
import { type Rect, subpathsBounds, transformSubpath, unionRect } from '../../core/geometry/bezier';
import { fitCurve } from '../../core/geometry/fit';
import { layoutText } from '../../core/text';
import { rgb } from '../../core/color';
import { emptyReport, note, type ImportOptions } from '../types';
import { fromUtf8 } from '../shared/bytes';
import { aciToRgb } from './export';

type Pair = [number, string];
export type Entity = { type: string; pairs: Pair[]; vertices?: Entity[] };

const UNIT_SCALE: Record<number, { pt: number; unit: Unit }> = {
  1: { pt: 72, unit: 'in' },
  2: { pt: 864, unit: 'in' },
  4: { pt: 72 / 25.4, unit: 'mm' },
  5: { pt: 72 / 2.54, unit: 'cm' },
  6: { pt: 72 / 0.0254, unit: 'mm' },
  8: { pt: 72e-6, unit: 'in' },
  9: { pt: 72e-3, unit: 'in' },
  10: { pt: 72 * 36, unit: 'in' },
  14: { pt: (72 / 2.54) * 10, unit: 'cm' },
};

export function readPairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) throw new Error('This DXF file could not be read. It may be damaged.');
    out.push([code, lines[i + 1].trim()]);
  }
  return out;
}

const get = (e: Entity, code: number, def = 0) => {
  const p = e.pairs.find((x) => x[0] === code);
  if (!p) return def;
  const v = parseFloat(p[1]);
  return Number.isFinite(v) ? v : def;
};
const getStr = (e: Entity, code: number, def = '') => e.pairs.find((x) => x[0] === code)?.[1] ?? def;
const getAll = (e: Entity, code: number) => e.pairs.filter((x) => x[0] === code).map((x) => parseFloat(x[1]));

type Parsed = {
  header: Record<string, Pair[]>;
  layers: Map<string, { color: number; off: boolean }>;
  blocks: Map<string, { base: Vec; entities: Entity[] }>;
  entities: Entity[];
};

/** Group a pair stream into entities; POLYLINE collects its VERTEX entities up to SEQEND. */
function entitiesFrom(
  pairs: Pair[],
  start: number,
  stop: (p: Pair) => boolean,
): { list: Entity[]; end: number } {
  const list: Entity[] = [];
  let i = start;
  let poly: Entity | null = null;
  while (i < pairs.length && !stop(pairs[i])) {
    if (pairs[i][0] !== 0) {
      i++;
      continue;
    }
    const e: Entity = { type: pairs[i][1].toUpperCase(), pairs: [] };
    i++;
    while (i < pairs.length && pairs[i][0] !== 0) e.pairs.push(pairs[i++]);
    if (e.type === 'VERTEX' && poly) poly.vertices!.push(e);
    else if (e.type === 'SEQEND') poly = null;
    else {
      if (e.type === 'POLYLINE') {
        e.vertices = [];
        poly = e;
      } else poly = null;
      list.push(e);
    }
  }
  return { list, end: i };
}

export function parseDxf(text: string): Parsed {
  if (text.startsWith('AutoCAD Binary DXF'))
    throw new Error('Binary DXF files are not supported yet. Save as ASCII DXF and try again.');
  const pairs = readPairs(text);
  const out: Parsed = { header: {}, layers: new Map(), blocks: new Map(), entities: [] };
  let i = 0;
  while (i < pairs.length) {
    const [c, v] = pairs[i];
    if (c === 0 && v === 'SECTION' && pairs[i + 1]?.[0] === 2) {
      const name = pairs[i + 1][1].toUpperCase();
      i += 2;
      const isEnd = (p: Pair) => p[0] === 0 && p[1] === 'ENDSEC';
      if (name === 'HEADER') {
        let cur: string | null = null;
        while (i < pairs.length && !isEnd(pairs[i])) {
          if (pairs[i][0] === 9) {
            cur = pairs[i][1];
            out.header[cur] = [];
          } else if (cur) out.header[cur].push(pairs[i]);
          i++;
        }
      } else if (name === 'TABLES') {
        const { list, end } = entitiesFrom(pairs, i, isEnd);
        for (const e of list) {
          if (e.type !== 'LAYER') continue;
          const color = get(e, 62, 7);
          out.layers.set(getStr(e, 2, '0'), {
            color: Math.abs(color) || 7,
            off: color < 0 || (get(e, 70) & 1) === 1,
          });
        }
        i = end;
      } else if (name === 'BLOCKS') {
        const { list, end } = entitiesFrom(pairs, i, isEnd);
        let cur: { name: string; base: Vec; entities: Entity[] } | null = null;
        for (const e of list) {
          if (e.type === 'BLOCK') cur = { name: getStr(e, 2), base: [get(e, 10), get(e, 20)], entities: [] };
          else if (e.type === 'ENDBLK') {
            if (cur) out.blocks.set(cur.name, cur);
            cur = null;
          } else cur?.entities.push(e);
        }
        i = end;
      } else if (name === 'ENTITIES') {
        const { list, end } = entitiesFrom(pairs, i, isEnd);
        out.entities.push(...list);
        i = end;
      } else {
        while (i < pairs.length && !isEnd(pairs[i])) i++;
      }
    }
    i++;
  }
  return out;
}

const pn = (x: number, y: number): PathNode => ({ x, y, in: null, out: null, kind: 'sharp' });

/** Elliptical arc as cubics: point(t) = c + a·cos t + b·sin t, t from t0 to t1 (radians, increasing). */
export function ellipseArc(c: Vec, a: Vec, b: Vec, t0: number, t1: number): Subpath {
  const sweep = t1 - t0;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const step = sweep / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const at = (t: number): Vec => [
    c[0] + a[0] * Math.cos(t) + b[0] * Math.sin(t),
    c[1] + a[1] * Math.cos(t) + b[1] * Math.sin(t),
  ];
  const d = (t: number): Vec => [
    -a[0] * Math.sin(t) + b[0] * Math.cos(t),
    -a[1] * Math.sin(t) + b[1] * Math.cos(t),
  ];
  const nodes: PathNode[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + step * i;
    const p = at(t);
    const dv = d(t);
    nodes.push({
      x: p[0],
      y: p[1],
      in: i > 0 ? [p[0] - dv[0] * k, p[1] - dv[1] * k] : null,
      out: i < n ? [p[0] + dv[0] * k, p[1] + dv[1] * k] : null,
      kind: 'smooth',
    });
  }
  return { closed: false, nodes };
}

/** Polyline vertices with bulges → subpath (bulge = tan(θ/4), positive = counter-clockwise). */
export function bulgePolyline(verts: { x: number; y: number; bulge: number }[], closed: boolean): Subpath {
  const nodes: PathNode[] = verts.length ? [pn(verts[0].x, verts[0].y)] : [];
  const count = closed ? verts.length : verts.length - 1;
  for (let i = 0; i < count; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const last = nodes[nodes.length - 1];
    const isClosing = closed && i === verts.length - 1;
    if (Math.abs(a.bulge) < 1e-12) {
      if (!isClosing) nodes.push(pn(b.x, b.y));
      continue;
    }
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    if (chord < 1e-12) continue;
    const r = (chord * (1 + a.bulge * a.bulge)) / (4 * Math.abs(a.bulge));
    const segs = arcToCubics(a.x, a.y, r, r, 0, Math.abs(a.bulge) > 1, a.bulge > 0, b.x, b.y);
    segs.forEach(([c1, c2, end], j) => {
      const prev = nodes[nodes.length - 1] ?? last;
      prev.out = c1;
      if (isClosing && j === segs.length - 1) nodes[0].in = c2;
      else nodes.push({ x: end[0], y: end[1], in: c2, out: null, kind: 'sharp' });
    });
  }
  return { closed, nodes };
}

/** B-spline point via de Boor (rational when weights are given). */
function deBoor(t: number, degree: number, ctrl: Vec[], knots: number[], weights: number[] | null): Vec {
  const n = ctrl.length;
  let s = degree;
  while (s < n - 1 && t >= knots[s + 1]) s++;
  const d: [number, number, number][] = [];
  for (let j = 0; j <= degree; j++) {
    const idx = Math.min(n - 1, Math.max(0, j + s - degree));
    const w = weights ? (weights[idx] ?? 1) : 1;
    d.push([ctrl[idx][0] * w, ctrl[idx][1] * w, w]);
  }
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = j + s - degree;
      const denom = knots[i + degree - r + 1] - knots[i];
      const alpha = denom === 0 ? 0 : (t - knots[i]) / denom;
      d[j] = [
        (1 - alpha) * d[j - 1][0] + alpha * d[j][0],
        (1 - alpha) * d[j - 1][1] + alpha * d[j][1],
        (1 - alpha) * d[j - 1][2] + alpha * d[j][2],
      ];
    }
  }
  const [x, y, w] = d[degree];
  return [x / (w || 1), y / (w || 1)];
}

export function splineSubpath(e: Entity, tolerance: number): Subpath | null {
  const degree = Math.max(1, get(e, 71, 3));
  const flags = get(e, 70);
  const closed = (flags & 1) === 1;
  const xs = getAll(e, 10);
  const ys = getAll(e, 20);
  const ctrl: Vec[] = xs.map((x, i) => [x, ys[i] ?? 0]);
  const knots = getAll(e, 40);
  const weights = getAll(e, 41);
  let pts: Vec[];
  if (ctrl.length > degree && knots.length >= ctrl.length + degree + 1) {
    const t0 = knots[degree];
    const t1 = knots[ctrl.length];
    const N = Math.min(2000, Math.max(24, ctrl.length * 12));
    pts = [];
    for (let i = 0; i <= N; i++)
      pts.push(
        deBoor(
          t0 + ((t1 - t0) * i) / N,
          degree,
          ctrl,
          knots,
          weights.length === ctrl.length ? weights : null,
        ),
      );
  } else {
    const fx = getAll(e, 11);
    const fy = getAll(e, 21);
    pts = fx.map((x, i) => [x, fy[i] ?? 0]);
    if (pts.length < 2) pts = ctrl;
  }
  if (pts.length < 2) return null;
  if (degree === 1) return { closed, nodes: pts.map(([x, y]) => pn(x, y)) };
  return fitCurve(pts, tolerance, closed);
}

type Out = {
  layer: string;
  color: number;
  node:
    | { kind: 'path'; subpaths: Subpath[] }
    | { kind: 'circle'; c: Vec; r: number }
    | { kind: 'text'; at: Vec; height: number; rotation: number; text: string };
};

/** Convert DXF entities (in DXF space) under a transform. */
function convertEntities(
  entities: Entity[],
  m: Matrix,
  parsed: Parsed,
  report: Counts,
  outs: Out[],
  depth: number,
  insertLayer: string | null,
  tol: number,
) {
  for (const e of entities) {
    let layer = getStr(e, 8, '0');
    if (insertLayer && layer === '0') layer = insertLayer;
    const lc = parsed.layers.get(layer)?.color ?? 7;
    const raw = get(e, 62, 256);
    const color = raw === 256 || raw === 0 ? lc : Math.abs(raw);
    const flipX = get(e, 230, 1) < 0;
    const ocs: Matrix = flipX ? multiply(m, [-1, 0, 0, 1, 0, 0]) : m;
    const path = (subpaths: Subpath[], mm: Matrix = ocs) =>
      outs.push({
        layer,
        color,
        node: { kind: 'path', subpaths: subpaths.map((s) => transformSubpath(s, mm)) },
      });
    switch (e.type) {
      case 'LINE':
        path([{ closed: false, nodes: [pn(get(e, 10), get(e, 20)), pn(get(e, 11), get(e, 21))] }], m);
        break;
      case 'LWPOLYLINE': {
        const verts: { x: number; y: number; bulge: number }[] = [];
        for (const [c, v] of e.pairs) {
          if (c === 10) verts.push({ x: parseFloat(v), y: 0, bulge: 0 });
          else if (c === 20 && verts.length) verts[verts.length - 1].y = parseFloat(v);
          else if (c === 42 && verts.length) verts[verts.length - 1].bulge = parseFloat(v);
        }
        if (verts.length > 1) path([bulgePolyline(verts, (get(e, 70) & 1) === 1)]);
        break;
      }
      case 'POLYLINE': {
        const flags = get(e, 70);
        if (flags & (16 | 64)) {
          report.unsupported['POLYLINE mesh'] = (report.unsupported['POLYLINE mesh'] ?? 0) + 1;
          break;
        }
        const verts = (e.vertices ?? [])
          .filter((v) => !(get(v, 70) & 16))
          .map((v) => ({ x: get(v, 10), y: get(v, 20), bulge: get(v, 42) }));
        if (verts.length > 1) path([bulgePolyline(verts, (flags & 1) === 1)], flags & 8 ? m : ocs);
        break;
      }
      case 'CIRCLE': {
        const r = get(e, 40);
        if (r > 0) {
          const sx = Math.hypot(ocs[0], ocs[1]);
          const sy = Math.hypot(ocs[2], ocs[3]);
          const ortho = Math.abs(ocs[0] * ocs[2] + ocs[1] * ocs[3]) < 1e-9 * sx * sy;
          if (ortho && Math.abs(sx - sy) < 1e-9 * sx)
            outs.push({
              layer,
              color,
              node: { kind: 'circle', c: apply(ocs, [get(e, 10), get(e, 20)]), r: r * sx },
            });
          else
            path([{ ...ellipseArc([get(e, 10), get(e, 20)], [r, 0], [0, r], 0, Math.PI * 2), closed: true }]);
        }
        break;
      }
      case 'ARC': {
        const r = get(e, 40);
        const a0 = (get(e, 50) * Math.PI) / 180;
        let a1 = (get(e, 51, 360) * Math.PI) / 180;
        while (a1 <= a0) a1 += Math.PI * 2;
        if (r > 0) path([ellipseArc([get(e, 10), get(e, 20)], [r, 0], [0, r], a0, a1)]);
        break;
      }
      case 'ELLIPSE': {
        const c: Vec = [get(e, 10), get(e, 20)];
        const a: Vec = [get(e, 11), get(e, 21)];
        const ratio = get(e, 40, 1);
        const b: Vec = [-a[1] * ratio, a[0] * ratio];
        const t0 = get(e, 41, 0);
        let t1 = get(e, 42, Math.PI * 2);
        while (t1 <= t0) t1 += Math.PI * 2;
        const full = Math.abs(t1 - t0 - Math.PI * 2) < 1e-6;
        const sp = ellipseArc(c, a, b, t0, t1);
        if (full) {
          sp.closed = true;
          const last = sp.nodes.pop()!;
          sp.nodes[0].in = last.in;
        }
        path([sp]);
        break;
      }
      case 'SPLINE': {
        const sp = splineSubpath(e, tol);
        if (sp) path([sp]);
        break;
      }
      case 'TEXT':
      case 'MTEXT': {
        let text =
          e.type === 'MTEXT'
            ? [...e.pairs.filter((p) => p[0] === 3).map((p) => p[1]), getStr(e, 1)].join('')
            : getStr(e, 1);
        if (e.type === 'MTEXT')
          text = text
            .replace(/\\P/g, '\n')
            .replace(/\\[A-Za-z][^;\\{}]*;/g, '')
            .replace(/[{}]/g, '')
            .replace(/\\~/g, ' ');
        text = text
          .replace(/%%[cC]/g, '⌀')
          .replace(/%%[dD]/g, '°')
          .replace(/%%[pP]/g, '±');
        if (!text.trim()) break;
        const at = apply(m, [get(e, 10), get(e, 20)]);
        const h = get(e, 40, 2.5) * Math.hypot(m[0], m[1]);
        const rot = get(e, 50) + (Math.atan2(m[1], m[0]) * 180) / Math.PI;
        outs.push({ layer, color, node: { kind: 'text', at, height: h, rotation: rot, text } });
        break;
      }
      case 'INSERT': {
        const blk = parsed.blocks.get(getStr(e, 2));
        if (!blk || depth > 16) {
          report.unsupported.INSERT = (report.unsupported.INSERT ?? 0) + 1;
          break;
        }
        const cols = Math.max(1, get(e, 70, 1));
        const rows = Math.max(1, get(e, 71, 1));
        for (let ci = 0; ci < cols; ci++) {
          for (let ri = 0; ri < rows; ri++) {
            const ins: Vec = [get(e, 10) + ci * get(e, 44), get(e, 20) + ri * get(e, 45)];
            let t = multiply(translate(ins[0], ins[1]), rotate((get(e, 50) * Math.PI) / 180));
            t = multiply(t, scale(get(e, 41, 1), get(e, 42, 1)));
            t = multiply(t, translate(-blk.base[0], -blk.base[1]));
            convertEntities(blk.entities, multiply(ocs, t), parsed, report, outs, depth + 1, layer, tol);
          }
        }
        break;
      }
      case 'POINT':
      case 'VIEWPORT':
      case 'ATTDEF':
      case 'ATTRIB':
        break;
      default:
        report.unsupported[e.type] = (report.unsupported[e.type] ?? 0) + 1;
    }
  }
}

type Counts = { unsupported: Record<string, number> };

const headerNum = (p: Parsed, name: string, code: number): number | null => {
  const v = p.header[name]?.find((x) => x[0] === code);
  if (!v) return null;
  const n = parseFloat(v[1]);
  return Number.isFinite(n) ? n : null;
};

export async function importDxf(
  bytes: Uint8Array,
  opts: ImportOptions,
): Promise<{ doc: CurvsDocument; report: ImportReport }> {
  const parsed = parseDxf(fromUtf8(bytes));
  const report = emptyReport('dxf');
  const insunits = headerNum(parsed, '$INSUNITS', 70) ?? 0;
  let unit = UNIT_SCALE[insunits];
  if (!unit) {
    unit = { pt: 72 / 25.4, unit: 'mm' };
    report.warnings.push('The drawing has no units. It was read as millimeters.');
  }
  const counts: Counts = { unsupported: {} };
  const outs: Out[] = [];
  // Rough size for spline fitting tolerance.
  const extMin = [headerNum(parsed, '$EXTMIN', 10), headerNum(parsed, '$EXTMIN', 20)];
  const extMax = [headerNum(parsed, '$EXTMAX', 10), headerNum(parsed, '$EXTMAX', 20)];
  const extValid =
    extMin.every((v) => v !== null && Math.abs(v) < 1e19) &&
    extMax.every((v) => v !== null && Math.abs(v) < 1e19) &&
    extMax[0]! > extMin[0]! &&
    extMax[1]! > extMin[1]!;
  const tol = extValid
    ? Math.max(1e-4, Math.hypot(extMax[0]! - extMin[0]!, extMax[1]! - extMin[1]!) * 2e-4)
    : 0.01;
  convertEntities(parsed.entities, [...IDENTITY], parsed, counts, outs, 0, null, tol);

  // Bounds in DXF space.
  let b: Rect | null = null;
  for (const o of outs) {
    if (o.node.kind === 'path') b = unionRect(b, subpathsBounds(o.node.subpaths));
    else if (o.node.kind === 'circle')
      b = unionRect(b, {
        x: o.node.c[0] - o.node.r,
        y: o.node.c[1] - o.node.r,
        width: o.node.r * 2,
        height: o.node.r * 2,
      });
    else
      b = unionRect(b, {
        x: o.node.at[0],
        y: o.node.at[1],
        width: o.node.height * o.node.text.length * 0.6,
        height: o.node.height,
      });
  }
  let box = b ?? { x: 0, y: 0, width: 100, height: 100 };
  if (extValid && b) {
    const e = {
      x: extMin[0]!,
      y: extMin[1]!,
      width: extMax[0]! - extMin[0]!,
      height: extMax[1]! - extMin[1]!,
    };
    const eps = Math.max(e.width, e.height) * 1e-6;
    const inside =
      b.x >= e.x - eps &&
      b.y >= e.y - eps &&
      b.x + b.width <= e.x + e.width + eps &&
      b.y + b.height <= e.y + e.height + eps;
    if (inside) box = e;
  }
  const k = unit.pt;
  const M: Matrix = [k, 0, 0, -k, -box.x * k, (box.y + box.height) * k];
  const name = opts.fileName.replace(/\.dxf$/i, '') || 'Drawing';
  const doc = createDocument({
    name,
    width: Math.max(1, box.width * k),
    height: Math.max(1, box.height * k),
    units: unit.unit,
  });

  const groups = new Map<string, SceneNode[]>();
  for (const l of parsed.layers.keys()) groups.set(l, []);
  let count = 0;
  for (const o of outs) {
    const [r, g, bl] = aciToRgb(o.color);
    const stroke = makeStroke(rgb(r / 255, g / 255, bl / 255), 1);
    let node: SceneNode;
    if (o.node.kind === 'path') {
      node = makePath(
        o.node.subpaths.map((s) => transformSubpath(s, M)),
        { items: [stroke] },
      );
    } else if (o.node.kind === 'circle') {
      const c = apply(M, o.node.c);
      node = makeEllipse(c[0], c[1], o.node.r * k, o.node.r * k, { items: [stroke] });
    } else {
      const size = (o.node.height * k) / 0.72;
      const t = makeText(0, 0, o.node.text);
      t.runs[0] = { ...t.runs[0], size, font: { family: 'Geist', weight: 400, style: 'normal' } };
      t.appearance = {
        items: [
          { kind: 'fill', id: stroke.id, visible: true, paint: stroke.paint, opacity: 1, blend: 'normal' },
        ],
      };
      const at = apply(M, o.node.at);
      const ascent = layoutText(t).ascent;
      t.transform = multiply(
        translate(at[0], at[1]),
        multiply(rotate((-o.node.rotation * Math.PI) / 180), translate(0, -ascent)),
      );
      node = t;
    }
    if (!groups.has(o.layer)) groups.set(o.layer, []);
    groups.get(o.layer)!.push(node);
    count++;
  }
  const ab = doc.artboards[0];
  ab.background = null;
  for (const [layer, kids] of groups) {
    if (!kids.length) continue;
    const g = makeGroup(kids, layer);
    if (parsed.layers.get(layer)?.off) g.visible = false;
    ab.children.push(g);
  }
  for (const [type, n] of Object.entries(counts.unsupported)) {
    report.warnings.push(n === 1 ? `1 ${type} entity was skipped.` : `${n} ${type} entities were skipped.`);
    note(report, `skipped ${type}`, n);
  }
  note(report, 'objects', count);
  note(report, 'layers', ab.children.length);
  if (!count) report.warnings.push('The drawing has no shapes that Curvesmith can read.');
  return { doc, report };
}

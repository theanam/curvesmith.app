import type { Draft } from 'immer';
import type { CurvsDocument, PathNode, PathShape, SceneNode, Subpath, Vec } from '../core/types';
import type { Tool, ToolApi } from './types';
import { apply, invert, multiply } from '../core/matrix';
import { locate, makePath, parentWorldMatrix, worldMatrix, clone } from '../core/document';
import { insertNodeAt, intersectSegmentCubic, nearestOnSubpath, segments } from '../core/geometry/bezier';
import { nodeSubpaths } from '../core/geometry/node';
import { combine, loadPathKit, pathKitReady } from '../core/booleans';
import { hitTest } from '../render/hittest';
import { mutate, select } from '../state/store';
import { OVERLAY } from '../render/overlay';
import { drawHover } from './common';

let knife: { a: Vec; b: Vec } | null = null;

const asDoc = (d: Draft<CurvsDocument>) => d as unknown as CurvsDocument;
const cuttable = (n: SceneNode) =>
  n.type === 'path' || n.type === 'rect' || n.type === 'ellipse' || n.type === 'star' || n.type === 'shape';

/** Split a subpath at a node index: closed paths open there, open paths become two. */
export function splitAtNode(sp: Subpath, i: number): Subpath[] {
  const nodes = sp.nodes.map((n) => ({ ...n }));
  if (sp.closed) {
    const rotated = [...nodes.slice(i), ...nodes.slice(0, i), { ...nodes[i] }];
    rotated[0] = { ...rotated[0], in: null, kind: 'sharp' };
    rotated[rotated.length - 1] = { ...rotated[rotated.length - 1], out: null, kind: 'sharp' };
    return [{ closed: false, nodes: rotated }];
  }
  if (i <= 0 || i >= nodes.length - 1) return [sp];
  const a: PathNode[] = nodes.slice(0, i + 1);
  const b: PathNode[] = nodes.slice(i).map((n) => ({ ...n }));
  a[a.length - 1] = { ...a[a.length - 1], out: null, kind: 'sharp' };
  b[0] = { ...b[0], in: null, kind: 'sharp' };
  return [
    { closed: false, nodes: a },
    { closed: false, nodes: b },
  ];
}

/** Cut a subpath at every (segment, t) position. */
export function cutSubpath(sp: Subpath, cuts: { segment: number; t: number }[]): Subpath[] {
  // Insert nodes from the end so earlier indices stay valid.
  const sorted = [...cuts].sort((x, y) => y.segment - x.segment || y.t - x.t);
  let cur = sp;
  const indices: number[] = [];
  for (const c of sorted) {
    if (c.t < 1e-4) {
      indices.push(c.segment);
      continue;
    }
    if (c.t > 1 - 1e-4) {
      indices.push((c.segment + 1) % cur.nodes.length);
      continue;
    }
    cur = insertNodeAt(cur, c.segment, c.t);
    indices.forEach((v, k) => (indices[k] = v > c.segment ? v + 1 : v));
    indices.push(c.segment + 1);
  }
  let pieces: Subpath[] = [cur];
  const uniq = [...new Set(indices)].sort((x, y) => x - y);
  if (!uniq.length) return pieces;
  if (cur.closed) {
    const first = uniq[0];
    pieces = splitAtNode(cur, first);
    const shift = (k: number) => (k - first + cur.nodes.length) % cur.nodes.length;
    const rest = uniq
      .slice(1)
      .map(shift)
      .sort((x, y) => y - x);
    let open = pieces[0];
    const out: Subpath[] = [];
    for (const k of rest) {
      const [a, b] = splitAtNode(open, k);
      if (b) {
        out.unshift(b);
        open = a;
      }
    }
    return [open, ...out];
  }
  const out: Subpath[] = [];
  let open = cur;
  for (const k of [...uniq].sort((x, y) => y - x)) {
    const parts = splitAtNode(open, k);
    if (parts.length === 2) {
      out.unshift(parts[1]);
      open = parts[0];
    }
  }
  return [open, ...out];
}

function toPathDraft(d: Draft<CurvsDocument>, id: string, doc: CurvsDocument): Draft<PathShape> | null {
  const loc = locate(asDoc(d), id);
  if (!loc) return null;
  const n = loc.node as Draft<SceneNode>;
  if (n.type === 'path') return n as Draft<PathShape>;
  const src = locate(doc, id)!.node;
  const p = makePath(
    nodeSubpaths(src, doc).map((s) => clone(s)),
    clone(src.appearance),
    src.name,
  );
  p.id = src.id;
  p.transform = [...src.transform];
  const sib = loc.siblings as Draft<SceneNode>[];
  sib.splice(loc.index, 1, p as Draft<SceneNode>);
  return sib[loc.index] as Draft<PathShape>;
}

function clickCut(api: ToolApi, world: Vec) {
  const hit = hitTest(api.doc, world, api.px(5), { deep: true, isolation: api.od.isolation });
  if (!hit || !cuttable(hit.node)) return;
  const loc = locate(api.doc, hit.node.id)!;
  const local = apply(invert(worldMatrix(loc)), world);
  const subs = nodeSubpaths(loc.node, api.doc);
  let best: { sp: number; segment: number; t: number; d: number } | null = null;
  subs.forEach((sp, i) => {
    const h = nearestOnSubpath(sp, local);
    if (h && (!best || h.distance < best.d)) best = { sp: i, segment: h.segment, t: h.t, d: h.distance };
  });
  if (!best) return;
  const b = best as { sp: number; segment: number; t: number };
  const doc = api.doc;
  mutate('Cut path', (d) => {
    const p = toPathDraft(d, hit.node.id, doc);
    if (!p) return;
    const pieces = cutSubpath(p.subpaths[b.sp] as Subpath, [{ segment: b.segment, t: b.t }]);
    p.subpaths.splice(b.sp, 1, ...(pieces as never[]));
  });
}

async function knifeCut(api: ToolApi, a: Vec, b: Vec) {
  const doc = api.doc;
  const targets: string[] = [];
  const visit = (nodes: SceneNode[]) => {
    for (const n of nodes) {
      if (!n.visible || n.locked) continue;
      if (n.type === 'group') visit(n.children);
      else if (cuttable(n)) targets.push(n.id);
    }
  };
  for (const ab of doc.artboards) visit(ab.children);
  if (!pathKitReady()) await loadPathKit().catch(() => null);
  const newSel: string[] = [];
  mutate('Knife', (d) => {
    for (const id of targets) {
      const loc = locate(doc, id)!;
      const m = worldMatrix(loc);
      const inv = invert(m);
      const la = apply(inv, a);
      const lb = apply(inv, b);
      const subs = nodeSubpaths(loc.node, doc);
      const filled = loc.node.appearance.items.some((i) => i.kind === 'fill' && i.visible);
      const closed = subs.every((s) => s.closed);
      const crosses = subs.some((sp) =>
        segments(sp).some((seg) => intersectSegmentCubic(la, lb, seg).length),
      );
      if (!crosses) continue;
      if (closed && filled && pathKitReady()) {
        // Closed shapes: subtract a hairline along the knife so each side becomes its own closed piece.
        const dir: Vec = [lb[0] - la[0], lb[1] - la[1]];
        const l = Math.hypot(dir[0], dir[1]) || 1;
        const nrm: Vec = [(-dir[1] / l) * 0.01, (dir[0] / l) * 0.01];
        const sliver: Subpath = {
          closed: true,
          nodes: [
            [la[0] - nrm[0], la[1] - nrm[1]],
            [lb[0] - nrm[0], lb[1] - nrm[1]],
            [lb[0] + nrm[0], lb[1] + nrm[1]],
            [la[0] + nrm[0], la[1] + nrm[1]],
          ].map(([x, y]) => ({ x, y, in: null, out: null, kind: 'sharp' as const })),
        };
        const result = combine('subtract', [
          {
            subpaths: subs,
            transform: [1, 0, 0, 1, 0, 0],
            evenOdd: loc.node.type === 'path' && loc.node.fillRule === 'evenodd',
          },
          { subpaths: [sliver], transform: [1, 0, 0, 1, 0, 0], evenOdd: false },
        ]);
        if (!result || result.length < 2) continue;
        const dl = locate(asDoc(d), id);
        if (!dl) continue;
        const pw = parentWorldMatrix(dl);
        const pieces = result.map((sp, i) => {
          const p = makePath([sp], clone(loc.node.appearance), `${loc.node.name} ${i + 1}`);
          p.transform = multiply(invert(pw), m);
          newSel.push(p.id);
          return p;
        });
        (dl.siblings as Draft<SceneNode>[]).splice(dl.index, 1, ...(pieces as Draft<SceneNode>[]));
      } else {
        const p = toPathDraft(d, id, doc);
        if (!p) continue;
        p.subpaths = (p.subpaths as Subpath[]).flatMap((sp) => {
          const cuts: { segment: number; t: number }[] = [];
          segments(sp).forEach((seg, i) =>
            intersectSegmentCubic(la, lb, seg).forEach((t) => cuts.push({ segment: i, t })),
          );
          return cuts.length ? cutSubpath(sp, cuts) : [sp];
        }) as never;
        newSel.push(id);
      }
    }
  });
  if (newSel.length) select(newSel);
}

export const scissorsTool: Tool = {
  cursor: 'crosshair',
  down(e) {
    knife = { a: e.world, b: e.world };
  },
  move(e, api) {
    if (!e.dragging) {
      const hit = hitTest(api.doc, e.world, api.px(5), { deep: true, isolation: api.od.isolation });
      api.overlay.hoverId = hit && cuttable(hit.node) ? hit.node.id : null;
      api.render();
      return;
    }
    if (knife && e.moved) {
      knife.b = e.world;
      api.render();
    }
  },
  up(e, api) {
    const k = knife;
    knife = null;
    if (!k) return;
    if (!e.moved) clickCut(api, e.world);
    else void knifeCut(api, k.a, k.b);
    api.render();
  },
  overlay(ctx, api) {
    drawHover(ctx, api);
    if (!knife) return;
    const a = api.toScreen(knife.a);
    const b = api.toScreen(knife.b);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = OVERLAY.volt;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  },
  cancel() {
    knife = null;
  },
};

/* Boolean operations and stroke outlining through Skia PathOps (pathkit-wasm, BSD-3).
   PathKit loads lazily; until it is ready, compounds render their children unmerged. */
import type { BooleanOp, Matrix, StrokeItem, Subpath, Vec } from './types';
import { classifyNode } from './geometry/pathdata';
import { transformSubpath } from './geometry/bezier';

export type PathKitPath = {
  moveTo(x: number, y: number): PathKitPath;
  lineTo(x: number, y: number): PathKitPath;
  cubicTo(a: number, b: number, c: number, d: number, e: number, f: number): PathKitPath;
  close(): PathKitPath;
  op(other: PathKitPath, op: unknown): PathKitPath | null;
  simplify(): PathKitPath;
  stroke(opts: { width: number; join?: unknown; cap?: unknown; miter_limit?: number }): PathKitPath | null;
  setFillType(t: unknown): void;
  toCmds(): number[][];
  delete(): void;
  copy(): PathKitPath;
};

export type PathKit = {
  NewPath(): PathKitPath;
  PathOp: Record<'DIFFERENCE' | 'INTERSECT' | 'UNION' | 'XOR' | 'REVERSE_DIFFERENCE', unknown>;
  FillType: Record<'WINDING' | 'EVENODD', unknown>;
  StrokeJoin: Record<'MITER' | 'ROUND' | 'BEVEL', unknown>;
  StrokeCap: Record<'BUTT' | 'ROUND' | 'SQUARE', unknown>;
};

let pk: PathKit | null = null;
let loading: Promise<PathKit> | null = null;
const readyListeners = new Set<() => void>();

export const pathKitReady = () => pk !== null;
export const getPathKit = () => pk;
export function setPathKit(instance: PathKit) {
  pk = instance;
  readyListeners.forEach((l) => l());
}
export function onPathKitReady(fn: () => void) {
  readyListeners.add(fn);
  return () => readyListeners.delete(fn);
}

/** Browser loader. The wasm file is emitted by Vite as a hashed asset. */
export function loadPathKit(): Promise<PathKit> {
  if (pk) return Promise.resolve(pk);
  if (!loading) {
    loading = (async () => {
      const [{ default: init }, { default: wasmUrl }] = await Promise.all([
        import('pathkit-wasm/bin/pathkit.js'),
        import('pathkit-wasm/bin/pathkit.wasm?url'),
      ]);
      const instance = (await init({ locateFile: () => wasmUrl })) as PathKit;
      setPathKit(instance);
      return instance;
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

export function toPkPath(kit: PathKit, subpaths: Subpath[], evenOdd = false): PathKitPath {
  const p = kit.NewPath();
  for (const sp of subpaths) {
    if (!sp.nodes.length) continue;
    p.moveTo(sp.nodes[0].x, sp.nodes[0].y);
    const n = sp.nodes.length;
    const count = sp.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = sp.nodes[i];
      const b = sp.nodes[(i + 1) % n];
      if (!a.out && !b.in) p.lineTo(b.x, b.y);
      else {
        const c1 = a.out ?? [a.x, a.y];
        const c2 = b.in ?? [b.x, b.y];
        p.cubicTo(c1[0], c1[1], c2[0], c2[1], b.x, b.y);
      }
    }
    if (sp.closed) p.close();
  }
  p.setFillType(evenOdd ? kit.FillType.EVENODD : kit.FillType.WINDING);
  return p;
}

const VERB = { MOVE: 0, LINE: 1, QUAD: 2, CONIC: 3, CUBIC: 4, CLOSE: 5 };

export function fromPkCmds(cmds: number[][]): Subpath[] {
  const out: Subpath[] = [];
  let cur: Subpath | null = null;
  let last: Vec = [0, 0];
  const push = (x: number, y: number, inH: Vec | null) => {
    cur!.nodes.push({ x, y, in: inH, out: null, kind: 'sharp' });
    last = [x, y];
  };
  const curve = (c1: Vec, c2: Vec, x: number, y: number) => {
    cur!.nodes[cur!.nodes.length - 1].out = c1;
    push(x, y, c2);
  };
  for (const c of cmds) {
    switch (c[0]) {
      case VERB.MOVE:
        cur = { closed: false, nodes: [] };
        out.push(cur);
        push(c[1], c[2], null);
        break;
      case VERB.LINE:
        push(c[1], c[2], null);
        break;
      case VERB.QUAD: {
        const q: Vec = [c[1], c[2]];
        const e: Vec = [c[3], c[4]];
        curve(
          [last[0] + (2 / 3) * (q[0] - last[0]), last[1] + (2 / 3) * (q[1] - last[1])],
          [e[0] + (2 / 3) * (q[0] - e[0]), e[1] + (2 / 3) * (q[1] - e[1])],
          e[0],
          e[1],
        );
        break;
      }
      case VERB.CONIC: {
        const q: Vec = [c[1], c[2]];
        const e: Vec = [c[3], c[4]];
        const w = c[5];
        const k = (4 * w) / (3 * (1 + w));
        curve(
          [last[0] + k * (q[0] - last[0]), last[1] + k * (q[1] - last[1])],
          [e[0] + k * (q[0] - e[0]), e[1] + k * (q[1] - e[1])],
          e[0],
          e[1],
        );
        break;
      }
      case VERB.CUBIC:
        curve([c[1], c[2]], [c[3], c[4]], c[5], c[6]);
        break;
      case VERB.CLOSE:
        if (cur) {
          const f = cur.nodes[0];
          const l = cur.nodes[cur.nodes.length - 1];
          if (cur.nodes.length > 1 && Math.abs(f.x - l.x) < 1e-4 && Math.abs(f.y - l.y) < 1e-4) {
            f.in = l.in;
            cur.nodes.pop();
          }
          cur.closed = true;
          last = [f.x, f.y];
        }
        break;
    }
  }
  for (const sp of out) for (const n of sp.nodes) n.kind = classifyNode(n);
  return out.filter((sp) => sp.nodes.length > 1);
}

export type BooleanOperand = { subpaths: Subpath[]; transform: Matrix; evenOdd: boolean };

/** Combine operands (back to front). Returns null when PathKit is not loaded yet. */
export function combine(op: BooleanOp, operands: BooleanOperand[]): Subpath[] | null {
  const kit = pk;
  if (!kit) return null;
  if (!operands.length) return [];
  const paths = operands.map((o) =>
    toPkPath(
      kit,
      o.subpaths.map((sp) => transformSubpath(sp, o.transform)),
      o.evenOdd,
    ),
  );
  const pkOp = {
    union: kit.PathOp.UNION,
    subtract: kit.PathOp.DIFFERENCE,
    intersect: kit.PathOp.INTERSECT,
    exclude: kit.PathOp.XOR,
  }[op];
  // Folds back to front; for subtract that is the back-most shape minus everything in front of it.
  const acc = paths[0];
  for (let i = 1; i < paths.length; i++) acc.op(paths[i], pkOp);
  acc.simplify();
  const result = fromPkCmds(acc.toCmds());
  paths.forEach((p) => p.delete());
  return result;
}

/** Pieces for a destructive Divide: every overlap region and every remainder becomes its own path. */
export function divide(operands: BooleanOperand[]): Subpath[][] | null {
  const kit = pk;
  if (!kit) return null;
  let pieces: PathKitPath[] = [];
  for (const o of operands) {
    const shape = toPkPath(
      kit,
      o.subpaths.map((sp) => transformSubpath(sp, o.transform)),
      o.evenOdd,
    );
    const next: PathKitPath[] = [];
    const remainder = shape.copy();
    for (const piece of pieces) {
      const inter = piece.copy();
      inter.op(shape, kit.PathOp.INTERSECT);
      const diff = piece.copy();
      diff.op(shape, kit.PathOp.DIFFERENCE);
      next.push(diff, inter);
      remainder.op(piece, kit.PathOp.DIFFERENCE);
      piece.delete();
    }
    next.push(remainder);
    shape.delete();
    pieces = next;
  }
  const out = pieces.map((p) => {
    p.simplify();
    const sp = fromPkCmds(p.toCmds());
    p.delete();
    return sp;
  });
  return out.filter((sp) => sp.length > 0);
}

/** Outline a stroke into a filled shape. */
export function outlineStroke(
  subpaths: Subpath[],
  stroke: Pick<StrokeItem, 'width' | 'join' | 'cap' | 'miter'>,
): Subpath[] | null {
  const kit = pk;
  if (!kit) return null;
  const p = toPkPath(kit, subpaths);
  p.stroke({
    width: stroke.width,
    join: { miter: kit.StrokeJoin.MITER, round: kit.StrokeJoin.ROUND, bevel: kit.StrokeJoin.BEVEL }[
      stroke.join
    ],
    cap: { butt: kit.StrokeCap.BUTT, round: kit.StrokeCap.ROUND, square: kit.StrokeCap.SQUARE }[stroke.cap],
    miter_limit: stroke.miter,
  });
  p.simplify();
  const out = fromPkCmds(p.toCmds());
  p.delete();
  return out;
}

/** Offset a closed shape outward (positive) or inward (negative). */
export function offsetPath(
  subpaths: Subpath[],
  distance: number,
  join: StrokeItem['join'] = 'round',
): Subpath[] | null {
  const kit = pk;
  if (!kit) return null;
  const base = toPkPath(kit, subpaths);
  const ring = base.copy();
  ring.stroke({
    width: Math.abs(distance) * 2,
    join: { miter: kit.StrokeJoin.MITER, round: kit.StrokeJoin.ROUND, bevel: kit.StrokeJoin.BEVEL }[join],
    cap: kit.StrokeCap.BUTT,
    miter_limit: 4,
  });
  base.op(ring, distance >= 0 ? kit.PathOp.UNION : kit.PathOp.DIFFERENCE);
  base.simplify();
  const out = fromPkCmds(base.toCmds());
  base.delete();
  ring.delete();
  return out;
}

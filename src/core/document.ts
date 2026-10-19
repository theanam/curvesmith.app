import { current, isDraft } from 'immer';
import { rgb } from './color';
import { newId } from './id';
import { IDENTITY, multiply, translate } from './matrix';
import type {
  Appearance,
  Artboard,
  Color,
  ColorMode,
  ContainerNode,
  CurvsDocument,
  EllipseNode,
  FillItem,
  GroupNode,
  Matrix,
  PathShape,
  RectNode,
  SceneNode,
  StarNode,
  ShapeNode,
  StrokeItem,
  Subpath,
  TextNode,
  Unit,
} from './types';
import { uniformCorners } from './geometry/shapes';

export const INK = rgb(0x1a / 255, 0x18 / 255, 0x20 / 255);
export const WHITE = rgb(1, 1, 1);

export function makeFill(color: Color = rgb(0.85, 0.85, 0.85)): FillItem {
  return {
    kind: 'fill',
    id: newId('ap'),
    visible: true,
    paint: { type: 'solid', color },
    opacity: 1,
    blend: 'normal',
  };
}

export function makeStroke(color: Color = INK, width = 1): StrokeItem {
  return {
    kind: 'stroke',
    id: newId('ap'),
    visible: true,
    paint: { type: 'solid', color },
    opacity: 1,
    blend: 'normal',
    width,
    align: 'center',
    cap: 'butt',
    join: 'miter',
    miter: 4,
    dash: [],
    dashOffset: 0,
    profile: null,
    arrowStart: null,
    arrowEnd: null,
  };
}

export const defaultAppearance = (
  fill: Color | null = rgb(0.85, 0.85, 0.85),
  stroke: Color | null = INK,
): Appearance => ({
  items: [...(fill ? [makeFill(fill)] : []), ...(stroke ? [makeStroke(stroke)] : [])],
});

const base = (name: string, appearance: Appearance, transform: Matrix = [...IDENTITY]) => ({
  id: newId('nd'),
  name,
  visible: true,
  locked: false,
  opacity: 1,
  blend: 'normal' as const,
  transform,
  appearance,
});

export function makeRect(
  x: number,
  y: number,
  width: number,
  height: number,
  appearance = defaultAppearance(),
): RectNode {
  return {
    ...base('Rectangle', appearance, translate(x, y)),
    type: 'rect',
    width,
    height,
    corners: uniformCorners(0),
  };
}

export function makeEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  appearance = defaultAppearance(),
): EllipseNode {
  return { ...base('Ellipse', appearance, translate(cx, cy)), type: 'ellipse', rx, ry };
}

export function makeStar(
  cx: number,
  cy: number,
  r: number,
  points = 5,
  polygon = false,
  appearance = defaultAppearance(),
): StarNode {
  return {
    ...base(polygon ? 'Polygon' : 'Star', appearance, translate(cx, cy)),
    type: 'star',
    points,
    outerRadius: r,
    innerRatio: 0.5,
    rounding: 0,
    polygon,
  };
}

export function makeShape(
  kind: ShapeNode['kind'],
  x: number,
  y: number,
  width: number,
  height: number,
  params: ShapeNode['params'],
  appearance = defaultAppearance(),
  name = 'Shape',
): ShapeNode {
  return { ...base(name, appearance, translate(x, y)), type: 'shape', kind, width, height, params };
}

export function makePath(
  subpaths: Subpath[],
  appearance = defaultAppearance(null),
  name = 'Path',
): PathShape {
  return { ...base(name, appearance), type: 'path', subpaths, fillRule: 'nonzero' };
}

export function makeText(x: number, y: number, text: string, opts: Partial<TextNode> = {}): TextNode {
  return {
    ...base(text.slice(0, 24) || 'Text', defaultAppearance(INK, null), translate(x, y)),
    type: 'text',
    mode: 'point',
    runs: [
      {
        text,
        font: { family: 'Geist', weight: 400, style: 'normal' },
        size: 24,
        tracking: 0,
        leading: 1.2,
        features: {},
      },
    ],
    paragraph: { align: 'left', indent: 0 },
    ...opts,
  };
}

export function makeGroup(children: SceneNode[], name = 'Group'): GroupNode {
  return { ...base(name, { items: [] }), type: 'group', children };
}

export function makeArtboard(name: string, width: number, height: number, x = 0, y = 0): Artboard {
  return { id: newId('ab'), name, x, y, width, height, background: WHITE, guides: [], children: [] };
}

export function createDocument(opts: {
  name?: string;
  width: number;
  height: number;
  units: Unit;
  colorMode?: ColorMode;
}): CurvsDocument {
  const ab = makeArtboard(opts.name ?? 'Artboard 1', opts.width, opts.height);
  return {
    id: newId('doc'),
    units: opts.units,
    colorProfile: opts.colorMode ?? 'srgb',
    swatches: [],
    styles: [],
    symbols: [],
    fonts: [],
    artboards: [ab],
    view: { artboard: ab.id, zoom: 1, cx: opts.width / 2, cy: opts.height / 2 },
    assets: {},
    extra: {},
  };
}

// ---------------------------------------------------------------------------------------------
// Traversal

export const isContainer = (n: SceneNode): n is ContainerNode =>
  n.type === 'group' || n.type === 'boolean' || n.type === 'clipGroup';

export function childrenOf(n: SceneNode): SceneNode[] {
  if (n.type === 'clipGroup') return [n.clip, ...n.children];
  if (n.type === 'group' || n.type === 'boolean') return n.children;
  return [];
}

export type NodeLocation = {
  artboard: Artboard;
  node: SceneNode;
  /** Ancestors from the artboard down to (excluding) the node. */
  ancestors: SceneNode[];
  /** Parent's child list and index in it. */
  siblings: SceneNode[];
  index: number;
};

export function walk(
  doc: CurvsDocument,
  fn: (node: SceneNode, ancestors: SceneNode[], artboard: Artboard) => void | 'skip',
): void {
  const visit = (nodes: SceneNode[], ancestors: SceneNode[], ab: Artboard) => {
    for (const n of nodes) {
      if (fn(n, ancestors, ab) === 'skip') continue;
      const kids = childrenOf(n);
      if (kids.length) visit(kids, [...ancestors, n], ab);
    }
  };
  for (const ab of doc.artboards) visit(ab.children, [], ab);
}

export function locate(doc: CurvsDocument, id: string): NodeLocation | null {
  for (const ab of doc.artboards) {
    const r = locateIn(ab.children, id, []);
    if (r) return { artboard: ab, ...r };
  }
  return null;
}

function locateIn(
  nodes: SceneNode[],
  id: string,
  ancestors: SceneNode[],
): Omit<NodeLocation, 'artboard'> | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.id === id) return { node: n, ancestors, siblings: nodes, index: i };
    if (n.type === 'clipGroup' && n.clip.id === id)
      return { node: n.clip, ancestors: [...ancestors, n], siblings: [n.clip], index: 0 };
    const kids = n.type === 'clipGroup' ? n.children : childrenOf(n);
    if (kids.length) {
      const r = locateIn(kids, id, [...ancestors, n]);
      if (r) return r;
    }
  }
  return null;
}

export const findNode = (doc: CurvsDocument, id: string) => locate(doc, id)?.node ?? null;
export const findArtboard = (doc: CurvsDocument, id: string) =>
  doc.artboards.find((a) => a.id === id) ?? null;

/** Matrix from a node's local space into world space (artboard offset · ancestors · node). */
export function worldMatrix(loc: Pick<NodeLocation, 'artboard' | 'ancestors' | 'node'>): Matrix {
  let m = translate(loc.artboard.x, loc.artboard.y);
  for (const a of loc.ancestors) m = multiply(m, a.transform);
  return multiply(m, loc.node.transform);
}

/** Matrix from the node's parent space into world space. */
export function parentWorldMatrix(loc: Pick<NodeLocation, 'artboard' | 'ancestors'>): Matrix {
  let m = translate(loc.artboard.x, loc.artboard.y);
  for (const a of loc.ancestors) m = multiply(m, a.transform);
  return m;
}

export function allNodes(doc: CurvsDocument): SceneNode[] {
  const out: SceneNode[] = [];
  walk(doc, (n) => {
    out.push(n);
  });
  return out;
}

/** Deep copy that also works on immer drafts (structuredClone rejects proxies). */
export const clone = <T>(x: T): T => structuredClone(isDraft(x) ? (current(x as never) as T) : x);

/** Deep copy with fresh ids (used for duplicate and paste). */
export function reId<T extends SceneNode>(node: T): T {
  const copy = clone(node) as T;
  const visit = (n: SceneNode) => {
    n.id = newId('nd');
    for (const a of n.appearance.items) a.id = newId('ap');
    if (n.type === 'clipGroup') visit(n.clip);
    for (const c of n.type === 'group' || n.type === 'boolean' || n.type === 'clipGroup' ? n.children : [])
      visit(c);
  };
  visit(copy);
  return copy;
}

export const typeLabel: Record<SceneNode['type'], string> = {
  group: 'Group',
  path: 'Path',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  star: 'Star',
  shape: 'Shape',
  text: 'Text',
  image: 'Image',
  boolean: 'Compound',
  instance: 'Symbol',
  clipGroup: 'Clip group',
};

/** Ids of the given nodes plus all their descendants. */
export function withDescendants(nodes: SceneNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (n: SceneNode) => {
    ids.add(n.id);
    childrenOf(n).forEach(visit);
  };
  nodes.forEach(visit);
  return ids;
}

/** Remove the given ids from the scene; returns removed nodes in document order. */
export function removeNodes(doc: CurvsDocument, ids: Set<string>): SceneNode[] {
  const removed: SceneNode[] = [];
  const strip = (nodes: SceneNode[]) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (ids.has(n.id)) {
        removed.unshift(n);
        nodes.splice(i, 1);
      } else if (n.type === 'group' || n.type === 'boolean' || n.type === 'clipGroup') strip(n.children);
    }
  };
  for (const ab of doc.artboards) strip(ab.children);
  return removed;
}

/** Remove empty groups and booleans left behind after edits. */
export function pruneEmpty(doc: CurvsDocument) {
  const prune = (nodes: SceneNode[]) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.type === 'group' || n.type === 'boolean') {
        prune(n.children);
        if (n.children.length === 0) nodes.splice(i, 1);
      }
    }
  };
  for (const ab of doc.artboards) prune(ab.children);
}

/** Paths can choose; parametric shapes with holes (donut, frame, cog) always use even-odd. */
export const isEvenOdd = (n: SceneNode): boolean =>
  (n.type === 'path' && n.fillRule === 'evenodd') || n.type === 'shape';

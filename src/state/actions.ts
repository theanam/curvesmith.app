/* Document operations used by menus, the command palette, shortcuts and the inspector. */
import type { Draft } from 'immer';
import type {
  Appearance,
  BooleanNode,
  BooleanOp,
  ClipGroupNode,
  ColorMode,
  CurvsDocument,
  Matrix,
  PathShape,
  SceneNode,
  Subpath,
} from '../core/types';
import {
  childrenOf,
  locate,
  makeGroup,
  makePath,
  parentWorldMatrix,
  pruneEmpty,
  reId,
  removeNodes,
  worldMatrix,
  clone,
  isEvenOdd,
} from '../core/document';
import { multiply, invert, translate, IDENTITY } from '../core/matrix';
import { nodeSubpaths } from '../core/geometry/node';
import { insertNodeAt, transformSubpath } from '../core/geometry/bezier';
import { divide, loadPathKit, outlineStroke as outlineStrokeGeom, pathKitReady } from '../core/booleans';
import { applyWorldDelta, flipMatrix, selectionBounds } from '../core/transform';
import { newId } from '../core/id';
import { convertDocumentColors } from '../core/color';
import { activeDoc, getState, mutate, select, setIsolation, updateDoc } from './store';
import { toast } from '../ui/toast';
import { simplifySubpath } from '../core/geometry/fit';
import { applyAutoHandles } from '../core/geometry/shapes';

type D = Draft<CurvsDocument>;
const asDoc = (d: D) => d as unknown as CurvsDocument;

export const selection = () => activeDoc()?.selection ?? [];
export const hasSelection = () => selection().length > 0;

/** Sort ids by document order (back to front). */
export function inDocOrder(doc: CurvsDocument, ids: string[]): string[] {
  const order = new Map<string, number>();
  let i = 0;
  const visit = (nodes: SceneNode[]) => {
    for (const n of nodes) {
      order.set(n.id, i++);
      visit(childrenOf(n));
    }
  };
  for (const ab of doc.artboards) visit(ab.children);
  return [...ids].filter((id) => order.has(id)).sort((a, b) => order.get(a)! - order.get(b)!);
}

/** Bake a node's parent-to-world transform change when moving it to a new parent. */
function reparent(_d: D, node: Draft<SceneNode>, fromWorld: Matrix, toWorld: Matrix) {
  node.transform = multiply(invert(toWorld), multiply(fromWorld, node.transform as Matrix)) as never;
}

/** Container (child list + its world matrix) where new objects go: the isolated group or the active artboard. */
export function targetContainer(
  d: D,
  artboardId: string,
  isolation: string | null,
): { list: Draft<SceneNode>[]; world: Matrix; artboardId: string } {
  if (isolation) {
    const loc = locate(asDoc(d), isolation);
    if (loc && (loc.node.type === 'group' || loc.node.type === 'boolean' || loc.node.type === 'clipGroup')) {
      return {
        list: loc.node.children as Draft<SceneNode>[],
        world: worldMatrix(loc),
        artboardId: loc.artboard.id,
      };
    }
  }
  const ab = d.artboards.find((a) => a.id === artboardId) ?? d.artboards[0];
  return { list: ab.children as Draft<SceneNode>[], world: translate(ab.x, ab.y), artboardId: ab.id };
}

/** Add a node defined in world coordinates to the current container. */
export function addNode(node: SceneNode, label = 'Add object') {
  const od = activeDoc();
  if (!od) return;
  mutate(
    label,
    (d) => {
      const t = targetContainer(d, od.activeArtboard, od.isolation);
      node.transform = multiply(invert(t.world), node.transform);
      t.list.push(node as Draft<SceneNode>);
    },
    [node.id],
  );
}

export function deleteSelection() {
  const ids = selection();
  if (!ids.length) return;
  mutate(
    'Delete',
    (d) => {
      removeNodes(asDoc(d), new Set(ids));
      pruneEmpty(asDoc(d));
    },
    [],
  );
}

export function selectAll() {
  const od = activeDoc();
  if (!od) return;
  let ids: string[];
  if (od.isolation) {
    const loc = locate(od.doc, od.isolation);
    ids = loc
      ? childrenOf(loc.node)
          .filter((n) => !n.locked && n.visible)
          .map((n) => n.id)
      : [];
  } else {
    const ab = od.doc.artboards.find((a) => a.id === od.activeArtboard) ?? od.doc.artboards[0];
    ids = ab.children.filter((n) => !n.locked && n.visible).map((n) => n.id);
  }
  select(ids);
}

export function deselect() {
  const od = activeDoc();
  if (!od) return;
  if (od.selection.length) select([]);
  else if (od.isolation) setIsolation(null);
}

export function duplicateSelection(offset = 10) {
  const od = activeDoc();
  if (!od) return;
  const ids = inDocOrder(od.doc, od.selection);
  if (!ids.length) return;
  const newIds: string[] = [];
  mutate(
    'Duplicate',
    (d) => {
      for (const id of ids) {
        const loc = locate(asDoc(d), id);
        if (!loc) continue;
        const copy = reId(loc.node as SceneNode);
        copy.transform = multiply(translate(offset, offset), copy.transform);
        (loc.siblings as Draft<SceneNode>[]).splice(
          loc.siblings.indexOf(loc.node) + 1,
          0,
          copy as Draft<SceneNode>,
        );
        newIds.push(copy.id);
      }
    },
    newIds,
  );
  select(newIds);
}

export function groupSelection() {
  const od = activeDoc();
  if (!od) return;
  const ids = inDocOrder(od.doc, od.selection);
  if (!ids.length) return;
  const group = makeGroup([]);
  mutate(
    'Group',
    (d) => {
      const first = locate(asDoc(d), ids[ids.length - 1])!;
      const parentWorld = parentWorldMatrix(first);
      const target = first.siblings as Draft<SceneNode>[];
      const insertAt = target.indexOf(first.node);
      const moved: SceneNode[] = [];
      for (const id of ids) {
        const loc = locate(asDoc(d), id);
        if (!loc) continue;
        const pw = parentWorldMatrix(loc);
        const node = loc.node as Draft<SceneNode>;
        reparent(d, node, pw, parentWorld);
        moved.push(node as SceneNode);
      }
      removeNodes(asDoc(d), new Set(ids));
      group.children = moved;
      target.splice(Math.min(insertAt, target.length), 0, group as Draft<SceneNode>);
      pruneEmpty(asDoc(d));
    },
    [group.id],
  );
}

export function ungroupSelection() {
  const od = activeDoc();
  if (!od) return;
  const newSel: string[] = [];
  mutate(
    'Ungroup',
    (d) => {
      for (const id of od.selection) {
        const loc = locate(asDoc(d), id);
        if (!loc) continue;
        const n = loc.node as Draft<SceneNode>;
        if (n.type !== 'group' && n.type !== 'boolean' && n.type !== 'clipGroup') {
          newSel.push(id);
          continue;
        }
        const kids = (n.type === 'clipGroup' ? [n.clip, ...n.children] : n.children) as Draft<SceneNode>[];
        for (const k of kids) {
          k.transform = multiply(n.transform as Matrix, k.transform as Matrix) as never;
          if (n.opacity < 1) k.opacity *= n.opacity;
          newSel.push(k.id);
        }
        const siblings = loc.siblings as Draft<SceneNode>[];
        siblings.splice(siblings.indexOf(n), 1, ...kids);
      }
    },
    newSel,
  );
}

export function arrange(dir: 'front' | 'forward' | 'backward' | 'back') {
  const od = activeDoc();
  if (!od) return;
  const ids = inDocOrder(od.doc, od.selection);
  if (!ids.length) return;
  mutate(
    { front: 'Bring to front', forward: 'Bring forward', backward: 'Send backward', back: 'Send to back' }[
      dir
    ],
    (d) => {
      // Process in an order that keeps the selection's relative stacking: back-to-front for front/backward.
      const order = dir === 'front' || dir === 'backward' ? ids : [...ids].reverse();
      for (const id of order) {
        const loc = locate(asDoc(d), id);
        if (!loc) continue;
        const sib = loc.siblings as Draft<SceneNode>[];
        const i = sib.indexOf(loc.node);
        const [n] = sib.splice(i, 1);
        let j: number;
        if (dir === 'front') j = sib.length;
        else if (dir === 'back') j = 0;
        else if (dir === 'forward') j = Math.min(sib.length, i + 1);
        else j = Math.max(0, i - 1);
        sib.splice(j, 0, n);
      }
    },
  );
}

/** Move a node to a new place in the tree (layers panel drag and drop). */
export function moveNodeTo(
  id: string,
  target: { parentId: string | null; artboardId: string; index: number },
) {
  mutate('Reorder', (d) => {
    const loc = locate(asDoc(d), id);
    if (!loc) return;
    if (target.parentId === id) return;
    const fromWorld = parentWorldMatrix(loc);
    let list: Draft<SceneNode>[];
    let toWorld: Matrix;
    if (target.parentId) {
      const p = locate(asDoc(d), target.parentId);
      if (!p || !(p.node.type === 'group' || p.node.type === 'boolean' || p.node.type === 'clipGroup'))
        return;
      if (p.ancestors.some((a) => a.id === id)) return;
      list = p.node.children as Draft<SceneNode>[];
      toWorld = worldMatrix(p);
    } else {
      const ab = d.artboards.find((a) => a.id === target.artboardId);
      if (!ab) return;
      list = ab.children as Draft<SceneNode>[];
      toWorld = translate(ab.x, ab.y);
    }
    const sib = loc.siblings as Draft<SceneNode>[];
    const i = sib.indexOf(loc.node);
    const [n] = sib.splice(i, 1);
    let index = target.index;
    if (sib === list && i < index) index--;
    reparent(d, n, fromWorld, toWorld);
    list.splice(Math.max(0, Math.min(list.length, index)), 0, n);
    pruneEmpty(asDoc(d));
  });
}

export function setVisibility(id: string, visible: boolean) {
  mutate(visible ? 'Show' : 'Hide', (d) => {
    const loc = locate(asDoc(d), id);
    if (loc) (loc.node as Draft<SceneNode>).visible = visible;
  });
}

export function setLocked(id: string, locked: boolean) {
  const od = activeDoc();
  mutate(
    locked ? 'Lock' : 'Unlock',
    (d) => {
      const loc = locate(asDoc(d), id);
      if (loc) (loc.node as Draft<SceneNode>).locked = locked;
    },
    locked ? (od?.selection ?? []).filter((x) => x !== id) : undefined,
  );
}

export function renameNode(id: string, name: string) {
  const n = name.trim();
  if (!n) return;
  mutate('Rename', (d) => {
    const loc = locate(asDoc(d), id);
    if (loc) (loc.node as Draft<SceneNode>).name = n;
    const ab = d.artboards.find((a) => a.id === id);
    if (ab) ab.name = n;
  });
}

/** Alt-click on an eye: show only this node among its siblings, or restore all. */
export function soloVisibility(id: string) {
  mutate('Solo', (d) => {
    const loc = locate(asDoc(d), id);
    if (!loc) return;
    const sib = loc.siblings as Draft<SceneNode>[];
    const othersHidden = sib.every((s) => s.id === id || !s.visible);
    for (const s of sib) s.visible = othersHidden ? true : s.id === id;
  });
}

// ---------------------------------------------------------------------------------------------
// Transforms

export function transformSelection(label: string, delta: Matrix, coalesce = 0) {
  const od = activeDoc();
  if (!od || !od.selection.length) return;
  mutate(label, (d) => applyWorldDelta(asDoc(d), od.selection, delta), undefined, { coalesce });
  updateDoc(od.key, { lastTransform: delta });
}

export function nudge(dx: number, dy: number) {
  transformSelection('Nudge', translate(dx, dy), 800);
}

export function flip(axis: 'h' | 'v') {
  const od = activeDoc();
  if (!od) return;
  const r = selectionBounds(od.doc, od.selection);
  if (r) transformSelection(axis === 'h' ? 'Flip horizontal' : 'Flip vertical', flipMatrix(r, axis));
}

export function transformAgain() {
  const od = activeDoc();
  if (!od?.lastTransform) return;
  transformSelection('Transform again', od.lastTransform);
}

export type AlignTo = 'selection' | 'artboard' | 'key';
export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function align(kind: AlignKind, to: AlignTo = 'selection') {
  const od = activeDoc();
  if (!od || !od.selection.length) return;
  const doc = od.doc;
  let ref = selectionBounds(doc, od.selection);
  if (to === 'artboard' || od.selection.length === 1) {
    const ab = doc.artboards.find((a) => a.id === od.activeArtboard) ?? doc.artboards[0];
    ref = { x: ab.x, y: ab.y, width: ab.width, height: ab.height };
  } else if (to === 'key') ref = selectionBounds(doc, [od.selection[0]]);
  if (!ref) return;
  const target = ref;
  mutate(`Align ${kind}`, (d) => {
    for (const id of od.selection) {
      const loc = locate(asDoc(d), id);
      if (!loc) continue;
      const b = selectionBounds(asDoc(d), [id]);
      if (!b) continue;
      let dx = 0;
      let dy = 0;
      if (kind === 'left') dx = target.x - b.x;
      if (kind === 'hcenter') dx = target.x + target.width / 2 - (b.x + b.width / 2);
      if (kind === 'right') dx = target.x + target.width - (b.x + b.width);
      if (kind === 'top') dy = target.y - b.y;
      if (kind === 'vcenter') dy = target.y + target.height / 2 - (b.y + b.height / 2);
      if (kind === 'bottom') dy = target.y + target.height - (b.y + b.height);
      applyWorldDelta(asDoc(d), [id], translate(dx, dy));
    }
  });
}

export function distribute(axis: 'h' | 'v') {
  const od = activeDoc();
  if (!od || od.selection.length < 3) return;
  const items = od.selection
    .map((id) => ({ id, b: selectionBounds(od.doc, [id])! }))
    .filter((x) => x.b)
    .sort((a, b) => (axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y));
  const first = items[0].b;
  const last = items[items.length - 1].b;
  const total = items.reduce((s, x) => s + (axis === 'h' ? x.b.width : x.b.height), 0);
  const span = axis === 'h' ? last.x + last.width - first.x : last.y + last.height - first.y;
  const gap = (span - total) / (items.length - 1);
  mutate(axis === 'h' ? 'Distribute horizontally' : 'Distribute vertically', (d) => {
    let pos = axis === 'h' ? first.x : first.y;
    for (const it of items) {
      const cur = axis === 'h' ? it.b.x : it.b.y;
      applyWorldDelta(asDoc(d), [it.id], axis === 'h' ? translate(pos - cur, 0) : translate(0, pos - cur));
      pos += (axis === 'h' ? it.b.width : it.b.height) + gap;
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Booleans and paths

async function ensurePathKit(): Promise<boolean> {
  if (pathKitReady()) return true;
  try {
    await loadPathKit();
    return true;
  } catch {
    toast.error('Path operations could not load. Check your connection and try again.');
    return false;
  }
}

/** Live compound: wraps the selection into a boolean node using the bottom object's appearance. */
export async function makeBoolean(op: BooleanOp) {
  const od = activeDoc();
  if (!od) return;
  const ids = inDocOrder(od.doc, od.selection);
  if (ids.length < 2) {
    toast('Select two or more shapes to combine.');
    return;
  }
  await ensurePathKit();
  const bottom = locate(od.doc, ids[0])!.node;
  const node: BooleanNode = {
    id: newId('nd'),
    name: op[0].toUpperCase() + op.slice(1),
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    transform: [...IDENTITY],
    appearance: clone(bottom.appearance) as Appearance,
    type: 'boolean',
    op,
    children: [],
  };
  node.appearance.items.forEach((i) => (i.id = newId('ap')));
  mutate(
    op[0].toUpperCase() + op.slice(1),
    (d) => {
      const top = locate(asDoc(d), ids[ids.length - 1])!;
      const parentWorld = parentWorldMatrix(top);
      const list = top.siblings as Draft<SceneNode>[];
      const at = list.indexOf(top.node);
      const kids: SceneNode[] = [];
      for (const id of ids) {
        const loc = locate(asDoc(d), id)!;
        const n = loc.node as Draft<SceneNode>;
        reparent(d, n, parentWorldMatrix(loc), parentWorld);
        kids.push(n as SceneNode);
      }
      removeNodes(asDoc(d), new Set(ids));
      node.children = kids;
      list.splice(Math.min(at, list.length), 0, node as Draft<SceneNode>);
      pruneEmpty(asDoc(d));
    },
    [node.id],
  );
}

/** Divide is destructive: every region becomes its own path, keeping the appearance of the shape it came from. */
export async function divideSelection() {
  const od = activeDoc();
  if (!od) return;
  const ids = inDocOrder(od.doc, od.selection);
  if (ids.length < 2) {
    toast('Select two or more shapes to divide.');
    return;
  }
  if (!(await ensurePathKit())) return;
  const top = locate(od.doc, ids[ids.length - 1])!;
  const pw = parentWorldMatrix(top);
  const inv = invert(pw);
  const operands = ids.map((id) => {
    const loc = locate(od.doc, id)!;
    return {
      subpaths: nodeSubpaths(loc.node, od.doc),
      transform: multiply(inv, worldMatrix(loc)),
      evenOdd: isEvenOdd(loc.node),
      appearance: loc.node.appearance,
    };
  });
  const pieces = divide(operands);
  if (!pieces) return;
  const group = makeGroup(
    pieces.map((sp, i) =>
      makePath(
        sp,
        clone(
          operands[Math.min(operands.length - 1, Math.floor(((i + 1) / pieces.length) * operands.length))]
            .appearance,
        ),
        `Piece ${i + 1}`,
      ),
    ),
    'Divided',
  );
  mutate(
    'Divide',
    (d) => {
      const t = locate(asDoc(d), ids[ids.length - 1])!;
      const list = t.siblings as Draft<SceneNode>[];
      const at = list.indexOf(t.node);
      removeNodes(asDoc(d), new Set(ids));
      list.splice(Math.min(at, list.length), 0, group as Draft<SceneNode>);
      pruneEmpty(asDoc(d));
    },
    [group.id],
  );
}

/** Subpaths of a node in its parent's space, ready to become a plain path. */
function flattenToParentSpace(n: SceneNode, doc: CurvsDocument): Subpath[] {
  return nodeSubpaths(n, doc).map((sp) => transformSubpath(sp, n.transform));
}

/** Expand compounds and convert shapes into editable paths. */
export async function convertToPath() {
  const od = activeDoc();
  if (!od || !od.selection.length) return;
  await ensurePathKit();
  const doc = od.doc;
  const newSel: string[] = [];
  mutate(
    'Convert to path',
    (d) => {
      for (const id of od.selection) {
        const loc = locate(asDoc(d), id);
        if (!loc) continue;
        const n = loc.node as SceneNode;
        if (n.type === 'path' || n.type === 'group' || n.type === 'image' || n.type === 'text') {
          newSel.push(id);
          continue;
        }
        const src = locate(doc, id)!.node;
        const p = makePath(flattenToParentSpace(src, doc), clone(n.appearance), n.name);
        if (isEvenOdd(src)) p.fillRule = 'evenodd';
        p.opacity = n.opacity;
        p.blend = n.blend;
        const sib = loc.siblings as Draft<SceneNode>[];
        sib.splice(sib.indexOf(loc.node), 1, p as Draft<SceneNode>);
        newSel.push(p.id);
      }
    },
    newSel,
  );
}

export const expandBoolean = convertToPath;

/** Release a compound back into its parts. */
export function releaseCompound() {
  ungroupSelection();
}

export async function outlineStroke() {
  const od = activeDoc();
  if (!od || !od.selection.length) return;
  if (!(await ensurePathKit())) return;
  const doc = od.doc;
  const newSel: string[] = [];
  mutate(
    'Outline stroke',
    (d) => {
      for (const id of od.selection) {
        const loc = locate(asDoc(d), id);
        if (!loc) continue;
        const src = locate(doc, id)!.node;
        const stroke = src.appearance.items.find((i) => i.kind === 'stroke' && i.visible);
        if (
          !stroke ||
          stroke.kind !== 'stroke' ||
          src.type === 'group' ||
          src.type === 'text' ||
          src.type === 'image'
        ) {
          newSel.push(id);
          continue;
        }
        const geom = outlineStrokeGeom(nodeSubpaths(src, doc), stroke);
        if (!geom) continue;
        const outline = makePath(
          geom.map((sp) => transformSubpath(sp, src.transform)),
          {
            items: [
              {
                kind: 'fill',
                id: newId('ap'),
                visible: true,
                paint: clone(stroke.paint),
                opacity: stroke.opacity,
                blend: 'normal',
              },
            ],
          },
          `${src.name} outline`,
        );
        const sib = loc.siblings as Draft<SceneNode>[];
        const at = sib.indexOf(loc.node);
        const hasFill = src.appearance.items.some((i) => i.kind === 'fill' && i.visible);
        if (hasFill) {
          const node = loc.node as Draft<SceneNode>;
          node.appearance.items = node.appearance.items.filter((i) => i.kind !== 'stroke');
          sib.splice(at + 1, 0, outline as Draft<SceneNode>);
        } else sib.splice(at, 1, outline as Draft<SceneNode>);
        newSel.push(outline.id);
      }
    },
    newSel,
  );
}

/** Combine selected paths into one compound path (⌘8). */
export async function makeCompoundPath() {
  const od = activeDoc();
  if (!od) return;
  const ids = inDocOrder(od.doc, od.selection);
  if (ids.length < 2) return;
  const doc = od.doc;
  const top = locate(doc, ids[ids.length - 1])!;
  const inv = invert(parentWorldMatrix(top));
  const subpaths: Subpath[] = [];
  for (const id of ids) {
    const loc = locate(doc, id)!;
    const m = multiply(inv, worldMatrix(loc));
    for (const sp of nodeSubpaths(loc.node, doc)) subpaths.push(transformSubpath(sp, m));
  }
  const p = makePath(subpaths, clone(locate(doc, ids[0])!.node.appearance), 'Compound path');
  p.fillRule = 'evenodd';
  mutate(
    'Make compound path',
    (d) => {
      const t = locate(asDoc(d), ids[ids.length - 1])!;
      const list = t.siblings as Draft<SceneNode>[];
      const at = list.indexOf(t.node);
      removeNodes(asDoc(d), new Set(ids));
      list.splice(Math.min(at, list.length), 0, p as Draft<SceneNode>);
      pruneEmpty(asDoc(d));
    },
    [p.id],
  );
}

/** Split a compound path into one path per subpath. */
export function releaseCompoundPath() {
  const od = activeDoc();
  if (!od) return;
  const newSel: string[] = [];
  mutate(
    'Release compound path',
    (d) => {
      for (const id of od.selection) {
        const loc = locate(asDoc(d), id);
        if (!loc || loc.node.type !== 'path' || loc.node.subpaths.length < 2) continue;
        const n = loc.node as PathShape;
        const parts = n.subpaths.map((sp, i) => {
          const p = makePath([sp], clone(n.appearance), `${n.name} ${i + 1}`);
          p.transform = [...n.transform];
          newSel.push(p.id);
          return p;
        });
        const sib = loc.siblings as Draft<SceneNode>[];
        sib.splice(sib.indexOf(loc.node), 1, ...(parts as Draft<SceneNode>[]));
      }
    },
    newSel,
  );
}

/** Mask: the top object clips everything below it in the selection. */
export function makeClipGroup() {
  const od = activeDoc();
  if (!od) return;
  const ids = inDocOrder(od.doc, od.selection);
  if (ids.length < 2) {
    toast('Select a shape on top and the objects to clip.');
    return;
  }
  const node: ClipGroupNode = {
    id: newId('nd'),
    name: 'Clip group',
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    transform: [...IDENTITY],
    appearance: { items: [] },
    type: 'clipGroup',
    clip: null as unknown as SceneNode,
    children: [],
  };
  mutate(
    'Make clip group',
    (d) => {
      const top = locate(asDoc(d), ids[ids.length - 1])!;
      const pw = parentWorldMatrix(top);
      const list = top.siblings as Draft<SceneNode>[];
      const at = list.indexOf(top.node);
      const nodes = ids.map((id) => {
        const loc = locate(asDoc(d), id)!;
        reparent(d, loc.node as Draft<SceneNode>, parentWorldMatrix(loc), pw);
        return loc.node as SceneNode;
      });
      removeNodes(asDoc(d), new Set(ids));
      node.clip = nodes[nodes.length - 1];
      node.children = nodes.slice(0, -1);
      list.splice(Math.min(at, list.length), 0, node as Draft<SceneNode>);
    },
    [node.id],
  );
}

// ---------------------------------------------------------------------------------------------
// Node-level path edits (Node tool context bar)

export function convertNodes(kind: 'sharp' | 'smooth' | 'symmetric' | 'auto') {
  const od = activeDoc();
  if (!od) return;
  const targets = od.nodeSelection.length ? od.nodeSelection : null;
  mutate(`Convert to ${kind}`, (d) => {
    const apply = (n: Draft<PathShape>, sp: number, i: number) => {
      const s = n.subpaths[sp];
      const node = s.nodes[i];
      const count = s.nodes.length;
      const prev = s.nodes[(i - 1 + count) % count];
      const next = s.nodes[(i + 1) % count];
      node.kind = kind;
      if (kind === 'sharp') {
        node.in = null;
        node.out = null;
      } else if (kind === 'smooth' || kind === 'symmetric') {
        if (!node.in || !node.out) {
          const tx = next.x - prev.x;
          const ty = next.y - prev.y;
          const tl = Math.hypot(tx, ty) || 1;
          const l =
            Math.min(
              Math.hypot(next.x - node.x, next.y - node.y),
              Math.hypot(prev.x - node.x, prev.y - node.y),
            ) / 3;
          node.in = [node.x - (tx / tl) * l, node.y - (ty / tl) * l];
          node.out = [node.x + (tx / tl) * l, node.y + (ty / tl) * l];
        } else if (kind === 'symmetric') {
          const l =
            (Math.hypot(node.in[0] - node.x, node.in[1] - node.y) +
              Math.hypot(node.out[0] - node.x, node.out[1] - node.y)) /
            2;
          const dx = node.out[0] - node.in[0];
          const dy = node.out[1] - node.in[1];
          const dl = Math.hypot(dx, dy) || 1;
          node.in = [node.x - (dx / dl) * l, node.y - (dy / dl) * l];
          node.out = [node.x + (dx / dl) * l, node.y + (dy / dl) * l];
        }
      }
      n.subpaths[sp] = applyAutoHandles(n.subpaths[sp] as Subpath) as never;
    };
    if (targets) {
      for (const t of targets) {
        const loc = locate(asDoc(d), t.id);
        if (loc?.node.type === 'path' && loc.node.subpaths[t.sp]?.nodes[t.i])
          apply(loc.node as Draft<PathShape>, t.sp, t.i);
      }
    } else {
      for (const id of od.selection) {
        const loc = locate(asDoc(d), id);
        if (loc?.node.type !== 'path') continue;
        const n = loc.node as Draft<PathShape>;
        n.subpaths.forEach((s, sp) => s.nodes.forEach((_, i) => apply(n, sp, i)));
      }
    }
  });
}

/** Break the path at the selected nodes (opens closed paths, splits open ones). */
export function breakAtNodes() {
  const od = activeDoc();
  if (!od || !od.nodeSelection.length) return;
  const sel = od.nodeSelection;
  mutate('Break', (d) => {
    const byPath = new Map<string, typeof sel>();
    for (const s of sel) byPath.set(s.id, [...(byPath.get(s.id) ?? []), s]);
    for (const [id, items] of byPath) {
      const loc = locate(asDoc(d), id);
      if (loc?.node.type !== 'path') continue;
      const n = loc.node as Draft<PathShape>;
      const out: Subpath[] = [];
      n.subpaths.forEach((sp0, spi) => {
        const sp = sp0 as Subpath;
        const cuts = items
          .filter((x) => x.sp === spi)
          .map((x) => x.i)
          .sort((a, b) => a - b);
        if (!cuts.length) {
          out.push(sp);
          return;
        }
        let nodes = sp.nodes.map((x) => ({ ...x }));
        let closed = sp.closed;
        if (closed) {
          // Rotate so the first cut is at the start and open the path there.
          const c = cuts[0];
          nodes = [...nodes.slice(c), ...nodes.slice(0, c), { ...nodes[c] }];
          nodes[0].in = null;
          nodes[nodes.length - 1].out = null;
          closed = false;
          const shifted = cuts.slice(1).map((k) => (k - c + sp.nodes.length) % sp.nodes.length);
          cuts.length = 0;
          cuts.push(...shifted);
        }
        let start = 0;
        for (const c of cuts) {
          if (c <= start || c >= nodes.length - 1) continue;
          const part = nodes.slice(start, c + 1).map((x) => ({ ...x }));
          part[part.length - 1].out = null;
          out.push({ closed: false, nodes: part });
          start = c;
          nodes[c] = { ...nodes[c], in: null };
        }
        out.push({ closed, nodes: nodes.slice(start) });
      });
      n.subpaths = out as never;
    }
  });
}

/** Join two selected open endpoints (or close a single open subpath). */
export function joinNodes() {
  const od = activeDoc();
  if (!od) return;
  const sel = od.nodeSelection;
  mutate('Join', (d) => {
    if (sel.length === 2 && sel[0].id === sel[1].id) {
      const loc = locate(asDoc(d), sel[0].id);
      if (loc?.node.type !== 'path') return;
      const n = loc.node as Draft<PathShape>;
      const [a, b] = sel;
      if (a.sp === b.sp) {
        const sp = n.subpaths[a.sp];
        if (!sp.closed) sp.closed = true;
        return;
      }
      const sa = n.subpaths[a.sp] as Subpath;
      const sb = n.subpaths[b.sp] as Subpath;
      const aNodes = a.i === 0 ? reverseNodes(sa.nodes) : sa.nodes.map((x) => ({ ...x }));
      const bNodes = b.i === sb.nodes.length - 1 ? reverseNodes(sb.nodes) : sb.nodes.map((x) => ({ ...x }));
      const joined: Subpath = { closed: false, nodes: [...aNodes, ...bNodes] };
      const keep = n.subpaths.filter((_, i) => i !== a.sp && i !== b.sp) as Subpath[];
      n.subpaths = [...keep, joined] as never;
    } else {
      for (const id of od.selection) {
        const loc = locate(asDoc(d), id);
        if (loc?.node.type !== 'path') continue;
        for (const sp of (loc.node as Draft<PathShape>).subpaths) sp.closed = true;
      }
    }
  });
}

function reverseNodes(nodes: Subpath['nodes']): Subpath['nodes'] {
  return [...nodes].reverse().map((n) => ({ ...n, in: n.out, out: n.in }));
}

export function deleteSelectedNodes() {
  const od = activeDoc();
  if (!od || !od.nodeSelection.length) return false;
  const sel = od.nodeSelection;
  mutate('Delete nodes', (d) => {
    for (const id of new Set(sel.map((s) => s.id))) {
      const loc = locate(asDoc(d), id);
      if (loc?.node.type !== 'path') continue;
      const n = loc.node as Draft<PathShape>;
      n.subpaths = n.subpaths
        .map((sp, spi) => ({
          closed: sp.closed,
          nodes: sp.nodes.filter((_, i) => !sel.some((s) => s.id === id && s.sp === spi && s.i === i)),
        }))
        .filter((sp) => sp.nodes.length > 1) as never;
      if (!n.subpaths.length) removeNodes(asDoc(d), new Set([id]));
    }
  });
  return true;
}

export function simplifySelection() {
  const od = activeDoc();
  if (!od) return;
  mutate('Simplify', (d) => {
    for (const id of od.selection) {
      const loc = locate(asDoc(d), id);
      if (loc?.node.type !== 'path') continue;
      const n = loc.node as Draft<PathShape>;
      n.subpaths = n.subpaths.map((sp) => simplifySubpath(sp as Subpath, 1.5)) as never;
    }
  });
}

/** Reverse path direction (affects arrowheads and text on path). */
export function reversePath() {
  const od = activeDoc();
  if (!od) return;
  mutate('Reverse path', (d) => {
    for (const id of od.selection) {
      const loc = locate(asDoc(d), id);
      if (loc?.node.type !== 'path') continue;
      const n = loc.node as Draft<PathShape>;
      n.subpaths = n.subpaths.map((sp) => ({
        closed: sp.closed,
        nodes: reverseNodes(sp.nodes as Subpath['nodes']),
      })) as never;
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Clipboard (in-app, plus SVG on the system clipboard when allowed)

let clipboard: { nodes: SceneNode[]; doc: CurvsDocument } | null = null;

export function copySelection(cut = false) {
  const od = activeDoc();
  if (!od || !od.selection.length) return;
  const ids = inDocOrder(od.doc, od.selection);
  const nodes = ids.map((id) => {
    const loc = locate(od.doc, id)!;
    const copy = clone(loc.node) as SceneNode;
    copy.transform = worldMatrix(loc);
    return copy;
  });
  clipboard = { nodes, doc: od.doc };
  if (cut) deleteSelection();
  void writeSystemClipboard(nodes, od.doc);
}

async function writeSystemClipboard(nodes: SceneNode[], doc: CurvsDocument) {
  try {
    const { nodesToSvg } = await import('../formats/clipboard');
    const svg = nodesToSvg(nodes, doc);
    if (svg && navigator.clipboard?.writeText) await navigator.clipboard.writeText(svg);
  } catch {
    // The system clipboard is optional; in-app paste still works.
  }
}

export function hasClipboard() {
  return !!clipboard;
}

export function paste(inPlace = false) {
  const od = activeDoc();
  if (!od || !clipboard) return;
  const nodes = clipboard.nodes.map((n) => reId(n));
  const sourceDoc = clipboard.doc;
  if (!inPlace && sourceDoc === od.doc)
    for (const n of nodes) n.transform = multiply(translate(10, 10), n.transform);
  mutate(
    'Paste',
    (d) => {
      const t = targetContainer(d, od.activeArtboard, od.isolation);
      for (const n of nodes) {
        n.transform = multiply(invert(t.world), n.transform);
        t.list.push(n as Draft<SceneNode>);
      }
      // Bring along swatches, symbols and assets referenced from another document.
      if (sourceDoc !== od.doc) {
        for (const s of sourceDoc.swatches)
          if (!d.swatches.some((x) => x.id === s.id)) d.swatches.push(clone(s) as never);
        for (const s of sourceDoc.symbols)
          if (!d.symbols.some((x) => x.id === s.id)) d.symbols.push(clone(s) as never);
        for (const [k, v] of Object.entries(sourceDoc.assets)) if (!d.assets[k]) d.assets[k] = v;
      }
    },
    nodes.map((n) => n.id),
  );
}

export function enterGroup(id: string) {
  const od = activeDoc();
  if (!od) return;
  const loc = locate(od.doc, id);
  if (loc && (loc.node.type === 'group' || loc.node.type === 'boolean' || loc.node.type === 'clipGroup'))
    setIsolation(id);
}

export const currentTool = () => getState().tool;

/** Node tool "Add node": insert a node halfway along each segment that follows a selected node. */
export function addNodeAfterSelected() {
  const od = activeDoc();
  if (!od || !od.nodeSelection.length) return;
  const sel = [...od.nodeSelection].sort((a, b) => b.i - a.i);
  mutate('Add node', (d) => {
    for (const s of sel) {
      const loc = locate(asDoc(d), s.id);
      if (loc?.node.type !== 'path') continue;
      const n = loc.node as Draft<PathShape>;
      const sp = n.subpaths[s.sp] as Subpath;
      if (!sp || (!sp.closed && s.i >= sp.nodes.length - 1)) continue;
      n.subpaths[s.sp] = insertNodeAt(sp, s.i, 0.5) as never;
    }
  });
}

/** Switch the document between RGB and CMYK, converting every color (one undo step). */
export function setColorMode(mode: ColorMode) {
  const od = activeDoc();
  if (!od || od.doc.colorProfile === mode) return;
  mutate(mode === 'cmyk' ? 'Convert to CMYK' : 'Convert to RGB', (d) => convertDocumentColors(d, mode));
}

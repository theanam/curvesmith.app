/* Text outlines and symbols. */
import type { Draft } from 'immer';
import type { CurvsDocument, InstanceNode, SceneNode, SymbolDef, TextNode } from '../core/types';
import { activeDoc, mutate } from './store';
import {
  locate,
  makeGroup,
  makePath,
  parentWorldMatrix,
  removeNodes,
  worldMatrix,
  clone,
} from '../core/document';
import { inDocOrder, addNode } from './actions';
import { invert, multiply, translate } from '../core/matrix';
import { selectionBounds } from '../core/transform';
import { newId } from '../core/id';
import { toast } from '../ui/toast';

export async function createOutlines() {
  const od = activeDoc();
  if (!od) return;
  const texts = od.selection
    .map((id) => locate(od.doc, id)?.node)
    .filter((n): n is TextNode => n?.type === 'text');
  if (!texts.length) {
    toast('Select text to outline.');
    return;
  }
  const { outlineText } = await import('../fonts/outline');
  const results = new Map<string, Awaited<ReturnType<typeof outlineText>>>();
  for (const t of texts) results.set(t.id, await outlineText(t));
  if ([...results.values()].some((r) => !r))
    toast('Some fonts could not be downloaded, so that text was left as text.');
  const newSel: string[] = [];
  mutate(
    'Create outlines',
    (d) => {
      for (const t of texts) {
        const sp = results.get(t.id);
        const loc = locate(d as unknown as CurvsDocument, t.id);
        if (!sp || !loc) {
          newSel.push(t.id);
          continue;
        }
        const p = makePath(sp, clone(t.appearance), t.name);
        p.fillRule = 'nonzero';
        p.transform = [...t.transform];
        p.opacity = t.opacity;
        const sib = loc.siblings as Draft<SceneNode>[];
        sib.splice(loc.index, 1, p as Draft<SceneNode>);
        newSel.push(p.id);
      }
    },
    newSel,
  );
}

/** Turn the selection into a symbol master; the selection is replaced by one instance. */
export function makeSymbol() {
  const od = activeDoc();
  if (!od || !od.selection.length) return;
  const ids = inDocOrder(od.doc, od.selection);
  const b = selectionBounds(od.doc, ids)!;
  const top = locate(od.doc, ids[ids.length - 1])!;
  const pw = parentWorldMatrix(top);
  // Master geometry is stored relative to the selection's top-left corner.
  const toMaster = translate(-b.x, -b.y);
  const children = ids.map((id) => {
    const loc = locate(od.doc, id)!;
    const c = clone(loc.node) as SceneNode;
    c.transform = multiply(toMaster, worldMatrix(loc));
    return c;
  });
  const root = makeGroup(children, 'Symbol');
  const sym: SymbolDef = { id: newId('sy'), name: `Symbol ${od.doc.symbols.length + 1}`, root };
  const inst: InstanceNode = {
    id: newId('nd'),
    name: sym.name,
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    transform: multiply(invert(pw), translate(b.x, b.y)),
    appearance: { items: [] },
    type: 'instance',
    symbol: sym.id,
    overrides: {},
  };
  mutate(
    'Make symbol',
    (d) => {
      d.symbols.push(sym as never);
      const t = locate(d as unknown as CurvsDocument, ids[ids.length - 1])!;
      const list = t.siblings as Draft<SceneNode>[];
      const at = t.index;
      removeNodes(d as unknown as CurvsDocument, new Set(ids));
      list.splice(Math.min(at, list.length), 0, inst as Draft<SceneNode>);
    },
    [inst.id],
  );
}

export function placeSymbol(symbolId: string) {
  const od = activeDoc();
  if (!od) return;
  const sym = od.doc.symbols.find((s) => s.id === symbolId);
  const ab = od.doc.artboards.find((a) => a.id === od.activeArtboard) ?? od.doc.artboards[0];
  if (!sym || !ab) return;
  const inst: InstanceNode = {
    id: newId('nd'),
    name: sym.name,
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    transform: translate(ab.x + ab.width / 2 - 40, ab.y + ab.height / 2 - 40),
    appearance: { items: [] },
    type: 'instance',
    symbol: sym.id,
    overrides: {},
  };
  addNode(inst, 'Place symbol');
}

/** Detach an instance into editable copies of the master. */
export function detachInstance(id: string) {
  const od = activeDoc();
  if (!od) return;
  const loc = locate(od.doc, id);
  if (!loc || loc.node.type !== 'instance') return;
  const sym = od.doc.symbols.find((s) => s.id === (loc.node as InstanceNode).symbol);
  if (!sym) return;
  const g = clone(sym.root) as SceneNode;
  g.id = newId('nd');
  g.transform = multiply(loc.node.transform, sym.root.transform);
  mutate(
    'Detach symbol',
    (d) => {
      const l = locate(d as unknown as CurvsDocument, id);
      if (l) (l.siblings as Draft<SceneNode>[]).splice(l.index, 1, g as Draft<SceneNode>);
    },
    [g.id],
  );
}

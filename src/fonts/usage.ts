/* Which faces a document's text uses. Pure: no loading. */
import type { CurvsDocument, FontRef, SceneNode } from '../core/types';

const refKey = (f: FontRef) => `${f.family}|${f.weight}|${f.style}`;

function collect(node: SceneNode, out: Map<string, FontRef>) {
  switch (node.type) {
    case 'text':
      for (const r of node.runs)
        out.set(refKey(r.font), { family: r.font.family, weight: r.font.weight, style: r.font.style });
      break;
    case 'group':
    case 'boolean':
      node.children.forEach((c) => collect(c, out));
      break;
    case 'clipGroup':
      collect(node.clip, out);
      node.children.forEach((c) => collect(c, out));
      break;
    default:
      break;
  }
}

/** Every distinct FontRef used by text in the document (artboards and symbols). */
export function fontsInUse(doc: Pick<CurvsDocument, 'artboards' | 'symbols'>): FontRef[] {
  const out = new Map<string, FontRef>();
  for (const ab of doc.artboards) ab.children.forEach((c) => collect(c, out));
  for (const s of doc.symbols ?? []) collect(s.root, out);
  return [...out.values()];
}

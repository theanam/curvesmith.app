/* SVG for the system clipboard, so copied art pastes into other apps. */
import type { CurvsDocument, SceneNode } from '../core/types';
import { makeArtboard } from '../core/document';
import { buildSvg } from './svg/export';
import { selectionBounds } from '../core/transform';

/** Nodes carry world transforms (as copied). Returns a standalone SVG cropped to their bounds. */
export function nodesToSvg(nodes: SceneNode[], doc: CurvsDocument): string | null {
  if (!nodes.length) return null;
  const ab = makeArtboard('Clipboard', 1, 1);
  ab.background = null;
  const tmp: CurvsDocument = { ...doc, artboards: [ab] };
  ab.children = nodes;
  const ids = nodes.map((n) => n.id);
  if (!selectionBounds(tmp, ids)) return null;
  return buildSvg(
    tmp,
    { kind: 'selection', ids },
    { activeArtboard: ab.id, name: 'Clipboard' },
    { minify: true, layerIds: false },
  );
}

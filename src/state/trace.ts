/* Image Trace actions: which image to trace, and placing the result in the document. */
import type { Draft } from 'immer';
import { locate } from '../core/document';
import type { GroupNode, ImageNode, SceneNode } from '../core/types';
import { activeDoc, mutate, openDialog } from './store';

/** The selected image when the selection is exactly one image. */
export function selectedImage(): ImageNode | null {
  const od = activeDoc();
  if (!od || od.selection.length !== 1) return null;
  const n = locate(od.doc, od.selection[0])?.node;
  return n?.type === 'image' ? n : null;
}

export function openTrace(id = selectedImage()?.id) {
  if (id) openDialog('trace', id);
}

/**
 * Put a traced group right above its image (same parent, same transform). The image is removed, or kept
 * hidden underneath when `keepImage` is set.
 */
export function placeTrace(imageId: string, group: GroupNode, keepImage: boolean): boolean {
  return mutate(
    'Trace image',
    (d) => {
      const at = locate(d, imageId);
      if (!at) return;
      const list = at.siblings as Draft<SceneNode>[];
      if (keepImage) {
        at.node.visible = false;
        list.splice(at.index + 1, 0, group as Draft<SceneNode>);
      } else list.splice(at.index, 1, group as Draft<SceneNode>);
    },
    [group.id],
  );
}

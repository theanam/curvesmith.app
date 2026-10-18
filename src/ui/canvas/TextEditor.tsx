import { useEffect, useRef } from 'react';
import type { Draft } from 'immer';
import type { CurvsDocument, TextNode } from '../../core/types';
import { getState, mutate, setState, type OpenDoc, type ViewState } from '../../state/store';
import { locate, removeNodes, worldMatrix } from '../../core/document';
import { layoutText, textContent } from '../../core/text';
import { cssColor } from '../../core/color';
import { multiply } from '../../core/matrix';

/** A transparent textarea laid exactly over the text node while typing. */
export function TextEditor({ od, id, view }: { od: OpenDoc; id: string; view: ViewState }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const loc = locate(od.doc, id);
  const node = loc?.node.type === 'text' ? (loc.node as TextNode) : null;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [id]);

  useEffect(() => {
    // Finish editing when the node disappears (undo) or the tool changes.
    if (!node) setState({ editingText: null });
  }, [node]);

  if (!node || !loc) return null;
  const run = node.runs[0];
  const layout = layoutText(node);
  const m = multiply([view.zoom, 0, 0, view.zoom, view.panX, view.panY], worldMatrix(loc));
  const fill = node.appearance.items.find((i) => i.kind === 'fill' && i.visible);
  const color =
    fill && fill.kind === 'fill' && fill.paint.type === 'solid'
      ? cssColor(fill.paint.color, od.doc.swatches)
      : '#1A1820';
  const value = textContent(node);

  const finish = () => {
    const s = getState();
    const d = s.docs.find((x) => x.key === s.activeKey);
    const n = d ? locate(d.doc, id)?.node : null;
    if (n?.type === 'text' && !textContent(n as TextNode).trim()) {
      mutate(
        'Remove empty text',
        (dd) => void removeNodes(dd as unknown as CurvsDocument, new Set([id])),
        [],
      );
    }
    setState({ editingText: null });
  };

  return (
    <textarea
      ref={ref}
      className="text-editor"
      aria-label="Edit text"
      spellCheck={false}
      value={value}
      style={{
        left: 0,
        top: 0,
        transform: `matrix(${m.join(',')})`,
        width: Math.max(layout.width + run.size, node.mode === 'area' && node.box ? node.box.width : 40),
        height: Math.max(layout.height, run.size * run.leading),
        font: `${run.font.style === 'italic' ? 'italic ' : ''}${run.font.weight} ${run.size}px/${run.leading} "${run.font.family}"`,
        letterSpacing: `${(run.tracking / 1000) * run.size}px`,
        textAlign: node.paragraph.align === 'justify' ? 'left' : node.paragraph.align,
        color,
        whiteSpace: node.mode === 'area' ? 'pre-wrap' : 'pre',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const text = e.target.value;
        mutate(
          'Type',
          (d) => {
            const l = locate(d as unknown as CurvsDocument, id);
            if (!l || l.node.type !== 'text') return;
            const t = l.node as Draft<TextNode>;
            t.runs = [{ ...t.runs[0], text }];
            if (!t.name || t.name === 'Text' || t.name === value.slice(0, 24))
              t.name = text.slice(0, 24) || 'Text';
          },
          undefined,
          { coalesce: 1500 },
        );
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          finish();
        }
      }}
      onBlur={finish}
    />
  );
}

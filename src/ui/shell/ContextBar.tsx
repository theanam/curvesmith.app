import type { Draft } from 'immer';
import { toolDef } from '../../tools/ids';
import { getState, mutate, setState, setUi, useActiveDoc, useEditor, type Snapping } from '../../state/store';
import * as A from '../../state/actions';
import { locate } from '../../core/document';
import type { CurvsDocument, FillItem, RectNode, SceneNode, StarNode, TextNode } from '../../core/types';
import { NumberField } from '../controls/NumberField';
import { useState } from 'react';
import { ShapeGlyph, ShapePopover } from '../shapes/ShapePicker';
import { shapeDef } from '../../core/shapeCatalog';
import { STAR_POINTS } from '../inspector/Design';
import { fromPt, toPt } from '../../core/units';
import { Segmented } from '../controls/Segmented';
import { FontFamilyPicker, FontStylePicker } from '../fonts/FontPicker';
import { fontsInUse } from '../../fonts/loader';
import { Icon } from '../icons';
import { Tip } from '../controls/Tooltip';
import { endCrop, resetCrop } from '../../state/crop';

const SNAPS: { key: keyof Snapping; label: string }[] = [
  { key: 'nodes', label: 'Nodes' },
  { key: 'guides', label: 'Guides' },
  { key: 'objects', label: 'Objects' },
  { key: 'grid', label: 'Grid' },
  { key: 'pixel', label: 'Pixel grid' },
  { key: 'angles', label: 'Angles' },
];

function editSelected(label: string, fn: (n: Draft<SceneNode>) => void, coalesce = 0) {
  const od = getState().docs.find((d) => d.key === getState().activeKey);
  if (!od) return;
  mutate(
    label,
    (d) => {
      for (const id of od.selection) {
        const loc = locate(d as unknown as CurvsDocument, id);
        if (loc) fn(loc.node as Draft<SceneNode>);
      }
    },
    undefined,
    { coalesce },
  );
}

function NodeOptions() {
  const od = useActiveDoc();
  const showAll = useEditor((s) => s.ui.showAllHandles);
  const sel = od?.nodeSelection ?? [];
  let kind: string | null = null;
  if (od && sel.length) {
    const kinds = new Set(
      sel.map((s) => {
        const n = locate(od.doc, s.id)?.node;
        return n?.type === 'path' ? n.subpaths[s.sp]?.nodes[s.i]?.kind : undefined;
      }),
    );
    if (kinds.size === 1) kind = [...kinds][0] ?? null;
  }
  const none = !sel.length;
  return (
    <div className="group">
      <span className="muted">Convert</span>
      <div className="segmented" role="group" aria-label="Node type">
        {(['sharp', 'smooth', 'symmetric', 'auto'] as const).map((k) => (
          <button
            key={k}
            aria-pressed={kind === k}
            onClick={() => A.convertNodes(k)}
            disabled={!od?.selection.length}
          >
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      <div className="sep-v" />
      <button className="ctx-btn" disabled={none} onClick={A.breakAtNodes}>
        Break
      </button>
      <button className="ctx-btn" disabled={!od?.selection.length} onClick={A.joinNodes}>
        Join
      </button>
      <button className="ctx-btn" disabled={none} onClick={A.addNodeAfterSelected}>
        Add node
      </button>
      <button className="ctx-btn" disabled={!od?.selection.length} onClick={A.simplifySelection}>
        Simplify
      </button>
      <div className="sep-v" />
      <label className="check muted">
        <input
          type="checkbox"
          checked={showAll}
          onChange={(e) => setUi({ showAllHandles: e.target.checked })}
        />
        Show all handles
      </label>
    </div>
  );
}

function Hint({ text }: { text: string | null }) {
  return text ? <span className="hint">{text}</span> : null;
}

function selectedOfType<T extends SceneNode['type']>(type: T): Extract<SceneNode, { type: T }> | null {
  const s = getState();
  const od = s.docs.find((d) => d.key === s.activeKey);
  if (!od || od.selection.length !== 1) return null;
  const n = locate(od.doc, od.selection[0])?.node;
  return n?.type === type ? (n as Extract<SceneNode, { type: T }>) : null;
}

/** Shape picker in the tool options bar: the current shape, opening the full list. */
function ShapeKindButton() {
  const kind = useEditor((s) => s.ui.shapeKind);
  const [open, setOpen] = useState(false);
  return (
    <ShapePopover open={open} onOpenChange={setOpen} side="bottom">
      <button
        className="ctx-shape"
        aria-label={`Shape: ${shapeDef(kind).label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ShapeGlyph kind={kind} size={18} />
        {shapeDef(kind).label}
        <Icon name="chevronDown" size={14} />
      </button>
    </ShapePopover>
  );
}

function ToolOptions({ tool }: { tool: ReturnType<typeof getState>['tool'] }) {
  const ui = useEditor((s) => s.ui);
  const od = useActiveDoc();
  const unit = od?.doc.units ?? 'pt';
  const def = toolDef(tool);
  if (tool === 'node') return <NodeOptions />;
  if (tool === 'pen')
    return (
      <div className="group">
        <Segmented
          label="Pen mode"
          value={ui.penMode}
          onChange={(v) => setUi({ penMode: v })}
          options={[
            { value: 'pen', label: 'Pen' },
            { value: 'smart', label: 'Smart' },
            { value: 'polygon', label: 'Polygon' },
            { value: 'line', label: 'Line' },
          ]}
        />
        <div className="sep-v" />
        <Hint text={def.hint} />
      </div>
    );
  if (tool === 'pencil')
    return (
      <div className="group">
        <label className="row muted">
          Smoothing
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(ui.pencilSmoothing * 100)}
            onChange={(e) => setUi({ pencilSmoothing: Number(e.target.value) / 100 })}
            style={{ accentColor: 'var(--cs-volt)', width: 120 }}
            aria-label="Smoothing"
          />
          <span className="mono" style={{ width: 34 }}>
            {Math.round(ui.pencilSmoothing * 100)}%
          </span>
        </label>
        <div className="sep-v" />
        <Hint text="Draw freehand: strokes are fitted to clean Béziers as you go · start on an endpoint to continue it" />
      </div>
    );
  if (tool === 'star') {
    const star = od ? selectedOfType('star') : null;
    const isStarKind = ui.shapeKind === 'star' || ui.shapeKind === 'polygon';
    return (
      <div className="group">
        <ShapeKindButton />
        {isStarKind && (
          <NumberField
            className="ctx-field"
            label="Pts"
            ariaLabel="Points"
            options={STAR_POINTS}
            value={star ? star.points : ui.starPoints}
            decimals={0}
            min={3}
            max={64}
            onChange={(v) => {
              const p = Math.round(v);
              setUi({ starPoints: p });
              if (star) editSelected('Star points', (n) => void ((n as Draft<StarNode>).points = p), 600);
            }}
          />
        )}
        <div className="sep-v" />
        <Hint text={def.hint} />
      </div>
    );
  }
  if (tool === 'rect') {
    const rect = od ? selectedOfType('rect') : null;
    return (
      <div className="group">
        {rect && (
          <NumberField
            className="ctx-field"
            label="R"
            ariaLabel="Corner radius"
            value={fromPt(rect.corners[0].radius, unit)}
            unit={unit}
            mathUnit={unit}
            min={0}
            onChange={(v) =>
              editSelected(
                'Corner radius',
                (n) => (n as Draft<RectNode>).corners.forEach((c) => (c.radius = toPt(v, unit))),
                600,
              )
            }
          />
        )}
        {rect && <div className="sep-v" />}
        <Hint text={def.hint} />
      </div>
    );
  }
  if (tool === 'text') {
    const text = od ? selectedOfType('text') : null;
    if (!text) return <Hint text={def.hint} />;
    const run = text.runs[0];
    return (
      <div className="group">
        <div className="ctx-font">
          <FontFamilyPicker
            value={run.font}
            documentFonts={od ? fontsInUse(od.doc).map((f) => f.family) : []}
            onChange={(font) =>
              editSelected('Font', (n) => (n as Draft<TextNode>).runs.forEach((r) => (r.font = font)))
            }
          />
        </div>
        <div className="ctx-font-style">
          <FontStylePicker
            value={run.font}
            onChange={(font) =>
              editSelected('Font style', (n) => (n as Draft<TextNode>).runs.forEach((r) => (r.font = font)))
            }
          />
        </div>
        <NumberField
          className="ctx-field"
          label="Size"
          ariaLabel="Font size"
          value={run.size}
          unit="pt"
          min={1}
          onChange={(v) =>
            editSelected('Font size', (n) => (n as Draft<TextNode>).runs.forEach((r) => (r.size = v)), 600)
          }
        />
        <div className="segmented" role="group" aria-label="Alignment">
          {(['left', 'center', 'right'] as const).map((a) => (
            <Tip key={a} label={`Align ${a}`}>
              <button
                aria-pressed={text.paragraph.align === a}
                aria-label={`Align ${a}`}
                onClick={() =>
                  editSelected('Align text', (n) => void ((n as Draft<TextNode>).paragraph.align = a))
                }
              >
                <Icon
                  name={a === 'left' ? 'alignLeft' : a === 'center' ? 'alignHCenter' : 'alignRight'}
                  size={14}
                />
              </button>
            </Tip>
          ))}
        </div>
      </div>
    );
  }
  if (tool === 'gradient') {
    const s = getState();
    const d = s.docs.find((x) => x.key === s.activeKey);
    const n = d && d.selection.length === 1 ? locate(d.doc, d.selection[0])?.node : null;
    const fill = n?.appearance.items.find((i) => i.kind === 'fill') as FillItem | undefined;
    if (!fill || fill.paint.type === 'solid') return <Hint text={def.hint} />;
    return (
      <div className="group">
        <Segmented
          label="Gradient type"
          value={fill.paint.type}
          onChange={(v) =>
            editSelected('Gradient type', (node) => {
              const f = node.appearance.items.find((i) => i.kind === 'fill') as Draft<FillItem> | undefined;
              if (f && f.paint.type !== 'solid') f.paint.type = v;
            })
          }
          options={[
            { value: 'linear', label: 'Linear' },
            { value: 'radial', label: 'Radial' },
            { value: 'conic', label: 'Conic' },
          ]}
        />
        <div className="sep-v" />
        <Hint text={def.hint} />
      </div>
    );
  }
  return <Hint text={def.hint} />;
}

function CropOptions({ id }: { id: string }) {
  const od = useActiveDoc();
  const n = od ? locate(od.doc, id)?.node : null;
  const cropped = n?.type === 'image' && !!n.crop;
  return (
    <div className="group">
      <strong style={{ fontWeight: 600 }}>Crop image</strong>
      <div className="sep-v" />
      <button className="ctx-btn" onClick={endCrop}>
        <Icon name="check" size={14} /> Done
      </button>
      <button className="ctx-btn" disabled={!cropped} onClick={() => resetCrop(id)}>
        Reset
      </button>
      <div className="sep-v" />
      <Hint text="Drag the edges to crop · drag the photo to reposition · ⇧ keeps proportions · ↵ finishes" />
    </div>
  );
}

export function ContextBar() {
  const tool = useEditor((s) => s.springTool ?? s.tool);
  useEditor((s) => s.docs.find((d) => d.key === s.activeKey)?.doc);
  useEditor((s) => s.docs.find((d) => d.key === s.activeKey)?.selection);
  const snapping = useEditor((s) => s.snapping);
  const cropping = useEditor((s) => (s.springTool ? null : s.croppingImage));
  const def = toolDef(tool);
  return (
    <div className="contextbar" role="toolbar" aria-label="Tool options">
      {cropping ? (
        <CropOptions id={cropping} />
      ) : (
        <>
          <strong style={{ fontWeight: 600 }}>{def.label} tool</strong>
          <span className="kbd">{def.shortcut}</span>
          <div className="sep-v" />
          <ToolOptions tool={tool} />
        </>
      )}
      <div style={{ flex: 1 }} />
      <span className="muted">Snap</span>
      <div className="row" style={{ gap: 4 }}>
        {SNAPS.map((s) => (
          <button
            key={s.key}
            className="chip"
            aria-pressed={snapping[s.key]}
            onClick={() => setState({ snapping: { ...snapping, [s.key]: !snapping[s.key] } })}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

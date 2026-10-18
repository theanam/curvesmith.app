import * as M from '@radix-ui/react-dropdown-menu';
import * as P from '@radix-ui/react-popover';
import { useState } from 'react';
import type { Draft } from 'immer';
import type {
  BooleanOp,
  CurvsDocument,
  EllipseNode,
  ImageNode,
  Matrix,
  RectNode,
  SceneNode,
  StarNode,
  TextNode,
  Unit,
} from '../../core/types';
import { mutate, useActiveDoc, type OpenDoc } from '../../state/store';
import { childrenOf, locate, typeLabel, clone } from '../../core/document';
import { applyWorldDelta, rotateAbout, selectionBounds, selectionRotation } from '../../core/transform';
import { multiply, translate } from '../../core/matrix';
import { fromPt, toPt, UNITS } from '../../core/units';
import { NumberField } from '../controls/NumberField';
import { Icon, type IconName } from '../icons';
import { Tip } from '../controls/Tooltip';
import * as A from '../../state/actions';
import { AppearanceSection } from './Appearance';
import { FontPicker } from '../fonts/FontPicker';
import { fontsInUse } from '../../fonts/loader';
import { ColorPopover } from './ColorPicker';
import { cssColor } from '../../core/color';
import { detachInstance } from '../../state/extra';
import { Segmented } from '../controls/Segmented';

const ICON_FOR: Record<SceneNode['type'], IconName> = {
  group: 'group',
  path: 'path',
  rect: 'rect',
  ellipse: 'ellipse',
  star: 'star',
  text: 'text',
  image: 'image',
  boolean: 'boolean',
  instance: 'symbol',
  clipGroup: 'clip',
};

export const nodeIcon = (n: SceneNode): IconName => ICON_FOR[n.type];

function describe(n: SceneNode): string {
  if (n.type === 'path') {
    const count = n.subpaths.reduce((s, sp) => s + sp.nodes.length, 0);
    return `Path · ${count} node${count === 1 ? '' : 's'}`;
  }
  if (n.type === 'group' || n.type === 'boolean') return `${typeLabel[n.type]} · ${childrenOf(n).length}`;
  return typeLabel[n.type];
}

function SelectionHeader({ od }: { od: OpenDoc }) {
  const [editing, setEditing] = useState(false);
  const nodes = od.selection.map((id) => locate(od.doc, id)?.node).filter(Boolean) as SceneNode[];
  if (!nodes.length) return null;
  const one = nodes.length === 1 ? nodes[0] : null;
  return (
    <section className="sel-header">
      <Icon name={one ? nodeIcon(one) : 'layers'} size={16} stroke={1.7} />
      {one && editing ? (
        <input
          autoFocus
          defaultValue={one.name}
          aria-label="Name"
          onBlur={(e) => {
            A.renameNode(one.id, e.target.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <strong
          onDoubleClick={() => one && setEditing(true)}
          title={one ? 'Double-click to rename' : undefined}
        >
          {one ? one.name : `${nodes.length} objects`}
        </strong>
      )}
      <span className="meta">{one ? describe(one) : `${nodes.length} objects`}</span>
    </section>
  );
}

const REF_POINTS: [number, number][] = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [0, 0.5],
  [0.5, 0.5],
  [1, 0.5],
  [0, 1],
  [0.5, 1],
  [1, 1],
];

let refPoint: [number, number] = [0, 0];
export const STAR_POINTS = [3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 20, 24, 32];

/** 9-point reference picker (which point W, H and rotation edits keep fixed), in a small popover. */
function RefPointPicker({
  value,
  onChange,
}: {
  value: [number, number];
  onChange(p: [number, number]): void;
}) {
  const dot = (p: [number, number], size: number) => (
    <span
      key={p.join()}
      style={{
        width: size,
        height: size,
        borderRadius: 1.5,
        background: p[0] === value[0] && p[1] === value[1] ? 'var(--accent)' : 'var(--rule)',
      }}
    />
  );
  return (
    <P.Root>
      <Tip label="Reference point">
        <P.Trigger asChild>
          <button className="icon-btn sm" aria-label="Reference point">
            <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 3px)', gap: 2 }}>
              {REF_POINTS.map((p) => dot(p, 3))}
            </span>
          </button>
        </P.Trigger>
      </Tip>
      <P.Portal>
        <P.Content className="popover" side="bottom" align="end" sideOffset={6}>
          <div
            role="radiogroup"
            aria-label="Reference point"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 18px)', gap: 6 }}
          >
            {REF_POINTS.map((p) => {
              const on = p[0] === value[0] && p[1] === value[1];
              return (
                <button
                  key={p.join()}
                  role="radio"
                  aria-checked={on}
                  aria-label={`Reference ${p.join(',')}`}
                  onClick={() => onChange(p)}
                  style={{
                    width: 18,
                    height: 18,
                    padding: 0,
                    borderRadius: 4,
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--rule)'}`,
                    background: on ? 'var(--accent)' : 'transparent',
                  }}
                />
              );
            })}
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
let lockRatio = false;

function TransformSection({ od }: { od: OpenDoc }) {
  const [ref, setRef] = useState(refPoint);
  const [lock, setLock] = useState(lockRatio);
  const unit = od.doc.units;
  const b = selectionBounds(od.doc, od.selection);
  if (!b) return null;
  const ab = locate(od.doc, od.selection[0])?.artboard ?? od.doc.artboards[0];
  const rx = b.x + b.width * ref[0] - ab.x;
  const ry = b.y + b.height * ref[1] - ab.y;
  const rot = selectionRotation(od.doc, od.selection);
  const ids = od.selection;
  const apply = (label: string, delta: Matrix) =>
    mutate(label, (d) => applyWorldDelta(d as unknown as CurvsDocument, ids, delta), undefined, {
      coalesce: 700,
    });

  const setSize = (w: number | null, h: number | null) => {
    let sx = w !== null && b.width > 1e-9 ? w / b.width : 1;
    let sy = h !== null && b.height > 1e-9 ? h / b.height : 1;
    if (lock) {
      if (w !== null) sy = sx;
      else sx = sy;
    }
    const px = b.x + b.width * ref[0];
    const py = b.y + b.height * ref[1];
    apply('Resize', multiply(translate(px, py), multiply([sx, 0, 0, sy, 0, 0], translate(-px, -py))));
  };

  const L = (u: Unit) => u;
  return (
    <section className="insp-section">
      <div className="insp-head">
        <h3>Transform</h3>
        <div className="actions">
          <RefPointPicker value={ref} onChange={(p) => ((refPoint = p), setRef(p))} />
          <Tip label={lock ? 'Proportions locked' : 'Lock proportions'}>
            <button
              className="icon-btn sm"
              aria-pressed={lock}
              aria-label="Lock proportions"
              onClick={() => {
                lockRatio = !lock;
                setLock(!lock);
              }}
            >
              <Icon name={lock ? 'link' : 'unlink'} size={14} />
            </button>
          </Tip>
          <AlignButtons count={ids.length} />
        </div>
      </div>
      <div className="grid2">
        <NumberField
          label="X"
          ariaLabel="X position"
          value={fromPt(rx, unit)}
          unit={L(unit)}
          mathUnit={unit}
          onChange={(v) => apply('Move', translate(toPt(v, unit) - rx, 0))}
        />
        <NumberField
          label="Y"
          ariaLabel="Y position"
          value={fromPt(ry, unit)}
          unit={unit}
          mathUnit={unit}
          onChange={(v) => apply('Move', translate(0, toPt(v, unit) - ry))}
        />
        <NumberField
          label="W"
          ariaLabel="Width"
          value={fromPt(b.width, unit)}
          unit={unit}
          mathUnit={unit}
          min={0}
          percentOf={fromPt(b.width, unit)}
          onChange={(v) => setSize(toPt(v, unit), null)}
        />
        <NumberField
          label="H"
          ariaLabel="Height"
          value={fromPt(b.height, unit)}
          unit={unit}
          mathUnit={unit}
          min={0}
          percentOf={fromPt(b.height, unit)}
          onChange={(v) => setSize(null, toPt(v, unit))}
        />
        <NumberField
          label="∠"
          ariaLabel="Rotation"
          value={Math.round(rot * 100) / 100}
          unit="°"
          decimals={1}
          onChange={(v) =>
            apply('Rotate', rotateAbout(((v - rot) * Math.PI) / 180, b.x + b.width / 2, b.y + b.height / 2))
          }
        />
        <div className="row" style={{ gap: 4 }}>
          <Tip label="Flip horizontal" shortcut="Shift+H">
            <button
              className="small-btn"
              style={{ flex: 1 }}
              aria-label="Flip horizontal"
              onClick={() => A.flip('h')}
            >
              <Icon name="flipH" size={15} stroke={1.7} />
            </button>
          </Tip>
          <Tip label="Flip vertical" shortcut="Shift+V">
            <button
              className="small-btn"
              style={{ flex: 1 }}
              aria-label="Flip vertical"
              onClick={() => A.flip('v')}
            >
              <Icon name="flipV" size={15} stroke={1.7} />
            </button>
          </Tip>
        </div>
      </div>
    </section>
  );
}

function AlignButtons({ count }: { count: number }) {
  const [to, setTo] = useState<A.AlignTo>('selection');
  const btn = (icon: IconName, label: string, fn: () => void, disabled = false) => (
    <Tip label={label}>
      <button className="icon-btn sm" aria-label={label} onClick={fn} disabled={disabled}>
        <Icon name={icon} size={15} stroke={1.7} />
      </button>
    </Tip>
  );
  return (
    <>
      {btn('alignLeft', 'Align left', () => A.align('left', to))}
      {btn('alignHCenter', 'Align center', () => A.align('hcenter', to))}
      {btn('alignRight', 'Align right', () => A.align('right', to))}
      {btn('distributeH', 'Distribute horizontally', () => A.distribute('h'), count < 3)}
      <M.Root modal={false}>
        <M.Trigger asChild>
          <button className="icon-btn sm" aria-label="More alignment">
            <Icon name="chevronDown" size={14} />
          </button>
        </M.Trigger>
        <M.Portal>
          <M.Content className="menu-content" align="end" sideOffset={4}>
            <M.Item className="menu-item" onSelect={() => A.align('top', to)}>
              <Icon name="alignTop" /> Align top
            </M.Item>
            <M.Item className="menu-item" onSelect={() => A.align('vcenter', to)}>
              <Icon name="alignVCenter" /> Align middle
            </M.Item>
            <M.Item className="menu-item" onSelect={() => A.align('bottom', to)}>
              <Icon name="alignBottom" /> Align bottom
            </M.Item>
            <M.Item className="menu-item" disabled={count < 3} onSelect={() => A.distribute('v')}>
              <Icon name="distributeV" /> Distribute vertically
            </M.Item>
            <M.Separator className="menu-sep" />
            {(['selection', 'artboard', 'key'] as const).map((k) => (
              <M.CheckboxItem
                key={k}
                className="menu-item"
                checked={to === k}
                onCheckedChange={() => setTo(k)}
              >
                Align to {k === 'key' ? 'key object' : k}
                {to === k && <Icon name="check" size={14} style={{ marginLeft: 'auto' }} />}
              </M.CheckboxItem>
            ))}
          </M.Content>
        </M.Portal>
      </M.Root>
    </>
  );
}

function CombineSection({ od }: { od: OpenDoc }) {
  const one = od.selection.length === 1 ? locate(od.doc, od.selection[0])?.node : null;
  if (one?.type === 'boolean') {
    return (
      <section className="insp-section">
        <h3>Combine</h3>
        <Segmented
          label="Operation"
          value={one.op}
          onChange={(op: BooleanOp) =>
            mutate(
              'Change operation',
              (d) =>
                void ((
                  locate(d as unknown as CurvsDocument, one.id)!.node as Draft<SceneNode> & { op: BooleanOp }
                ).op = op),
            )
          }
          options={[
            { value: 'union', label: 'Union' },
            { value: 'subtract', label: 'Subtract' },
            { value: 'intersect', label: 'Intersect' },
            { value: 'exclude', label: 'Exclude' },
          ]}
        />
        <div className="grid2">
          <button className="small-btn" onClick={() => A.expandBoolean()}>
            Expand
          </button>
          <button className="small-btn" onClick={() => A.releaseCompound()}>
            Release
          </button>
        </div>
      </section>
    );
  }
  const disabled = od.selection.length < 2;
  return (
    <section className="insp-section">
      <div className="insp-head">
        <h3>Combine</h3>
        <M.Root modal={false}>
          <M.Trigger asChild>
            <button className="icon-btn sm" aria-label="More path operations">
              <Icon name="more" size={16} stroke={2.2} />
            </button>
          </M.Trigger>
          <M.Portal>
            <M.Content className="menu-content" align="end" sideOffset={4}>
              <M.Item className="menu-item" disabled={disabled} onSelect={() => A.makeBoolean('exclude')}>
                Exclude
              </M.Item>
              <M.Item className="menu-item" disabled={disabled} onSelect={() => A.makeCompoundPath()}>
                Make compound path
              </M.Item>
              <M.Item className="menu-item" disabled={disabled} onSelect={() => A.makeClipGroup()}>
                Make clip group
              </M.Item>
              <M.Separator className="menu-sep" />
              <M.Item className="menu-item" onSelect={() => A.outlineStroke()}>
                Outline stroke
              </M.Item>
              <M.Item className="menu-item" onSelect={() => A.convertToPath()}>
                Convert to path
              </M.Item>
            </M.Content>
          </M.Portal>
        </M.Root>
      </div>
      <div className="grid4">
        <button className="small-btn" disabled={disabled} onClick={() => A.makeBoolean('union')}>
          Union
        </button>
        <button className="small-btn" disabled={disabled} onClick={() => A.makeBoolean('subtract')}>
          Subtract
        </button>
        <button className="small-btn" disabled={disabled} onClick={() => A.makeBoolean('intersect')}>
          Intersect
        </button>
        <button className="small-btn" disabled={disabled} onClick={() => A.divideSelection()}>
          Divide
        </button>
      </div>
      <p className="combine-note">Non-destructive by default. Expand any time.</p>
    </section>
  );
}

function editNode<T extends SceneNode>(id: string, label: string, fn: (n: Draft<T>) => void) {
  mutate(
    label,
    (d) => {
      const loc = locate(d as unknown as CurvsDocument, id);
      if (loc) fn(loc.node as Draft<T>);
    },
    undefined,
    { coalesce: 700 },
  );
}

function ShapeSection({ od }: { od: OpenDoc }) {
  if (od.selection.length !== 1) return null;
  const n = locate(od.doc, od.selection[0])?.node;
  if (!n) return null;
  const unit = od.doc.units;
  if (n.type === 'rect') {
    const r = n as RectNode;
    const same = r.corners.every((c) => c.radius === r.corners[0].radius);
    return (
      <section className="insp-section">
        <div className="insp-head">
          <h3>Corners</h3>
          <select
            className="field"
            style={{ width: 100, height: 26 }}
            aria-label="Corner type"
            value={r.corners[0].kind}
            onChange={(e) =>
              editNode<RectNode>(r.id, 'Corner type', (x) =>
                x.corners.forEach((c) => (c.kind = e.target.value as RectNode['corners'][0]['kind'])),
              )
            }
          >
            <option value="round">Round</option>
            <option value="chamfer">Chamfer</option>
            <option value="inset">Inset</option>
          </select>
        </div>
        <NumberField
          label="R"
          ariaLabel="All corners"
          value={same ? fromPt(r.corners[0].radius, unit) : null}
          unit={unit}
          mathUnit={unit}
          min={0}
          onChange={(v) =>
            editNode<RectNode>(r.id, 'Corner radius', (x) =>
              x.corners.forEach((c) => (c.radius = toPt(v, unit))),
            )
          }
        />
        <div className="grid4">
          {(['↖', '↗', '↘', '↙'] as const).map((lbl, i) => (
            <NumberField
              key={i}
              label={lbl}
              ariaLabel={`Corner ${i + 1}`}
              value={fromPt(r.corners[i].radius, unit)}
              decimals={1}
              min={0}
              onChange={(v) =>
                editNode<RectNode>(r.id, 'Corner radius', (x) => void (x.corners[i].radius = toPt(v, unit)))
              }
            />
          ))}
        </div>
      </section>
    );
  }
  if (n.type === 'ellipse') {
    const e = n as EllipseNode;
    const isArc = e.arcStart !== undefined && e.arcEnd !== undefined && e.arcEnd - e.arcStart < 360;
    return (
      <section className="insp-section">
        <div className="insp-head">
          <h3>Arc</h3>
          {isArc && (
            <label className="check muted">
              <input
                type="checkbox"
                checked={!!e.pie}
                onChange={(ev) => editNode<EllipseNode>(e.id, 'Pie', (x) => void (x.pie = ev.target.checked))}
              />
              Pie
            </label>
          )}
        </div>
        <div className="grid2">
          <NumberField
            label="From"
            ariaLabel="Arc start"
            value={e.arcStart ?? 0}
            unit="°"
            decimals={1}
            onChange={(v) =>
              editNode<EllipseNode>(e.id, 'Arc', (x) => {
                x.arcStart = v;
                if (x.arcEnd === undefined) x.arcEnd = 360 + Math.min(0, v);
                x.pie = x.pie ?? true;
              })
            }
          />
          <NumberField
            label="To"
            ariaLabel="Arc end"
            value={e.arcEnd ?? 360}
            unit="°"
            decimals={1}
            onChange={(v) =>
              editNode<EllipseNode>(e.id, 'Arc', (x) => {
                x.arcEnd = v;
                if (x.arcStart === undefined) x.arcStart = 0;
                x.pie = x.pie ?? true;
              })
            }
          />
        </div>
        {isArc && (
          <button
            className="small-btn"
            onClick={() =>
              editNode<EllipseNode>(e.id, 'Full ellipse', (x) => {
                delete x.arcStart;
                delete x.arcEnd;
                delete x.pie;
              })
            }
          >
            Full ellipse
          </button>
        )}
      </section>
    );
  }
  if (n.type === 'star') {
    const s = n as StarNode;
    return (
      <section className="insp-section">
        <div className="insp-head">
          <h3>{s.polygon ? 'Polygon' : 'Star'}</h3>
          <label className="check muted">
            <input
              type="checkbox"
              checked={s.polygon}
              onChange={(ev) =>
                editNode<StarNode>(s.id, 'Polygon', (x) => void (x.polygon = ev.target.checked))
              }
            />
            Polygon
          </label>
        </div>
        <div className="grid2">
          <NumberField
            label="Pts"
            ariaLabel="Points"
            options={STAR_POINTS}
            value={s.points}
            decimals={0}
            min={3}
            max={64}
            onChange={(v) => editNode<StarNode>(s.id, 'Points', (x) => void (x.points = Math.round(v)))}
          />
          {!s.polygon && (
            <NumberField
              label="Depth"
              ariaLabel="Depth"
              value={Math.round((1 - s.innerRatio) * 100)}
              unit="%"
              decimals={0}
              min={0}
              max={98}
              onChange={(v) => editNode<StarNode>(s.id, 'Depth', (x) => void (x.innerRatio = 1 - v / 100))}
            />
          )}
          <NumberField
            label="Round"
            ariaLabel="Rounding"
            value={Math.round(s.rounding * 100)}
            unit="%"
            decimals={0}
            min={0}
            max={100}
            onChange={(v) => editNode<StarNode>(s.id, 'Rounding', (x) => void (x.rounding = v / 100))}
          />
          <button
            className="small-btn"
            onClick={() =>
              editNode<StarNode>(s.id, 'Randomize', (x) => {
                x.points = 3 + Math.floor(Math.random() * 10);
                x.innerRatio = 0.25 + Math.random() * 0.6;
              })
            }
          >
            <Icon name="sparkle" size={14} /> Randomize
          </button>
        </div>
      </section>
    );
  }
  if (n.type === 'text') {
    const t = n as TextNode;
    const run = t.runs[0];
    const feat = (k: string) => run.features[k] ?? (k === 'kern' || k === 'liga');
    return (
      <section className="insp-section">
        <h3>Typography</h3>
        <FontPicker
          value={run.font}
          documentFonts={fontsInUse(od.doc).map((f) => f.family)}
          onChange={(font) => editNode<TextNode>(t.id, 'Font', (x) => x.runs.forEach((r) => (r.font = font)))}
        />
        <div className="grid2">
          <NumberField
            label="Size"
            ariaLabel="Font size"
            value={run.size}
            unit="pt"
            min={1}
            onChange={(v) =>
              editNode<TextNode>(t.id, 'Font size', (x) => x.runs.forEach((r) => (r.size = v)))
            }
          />
          <NumberField
            label="Lead"
            ariaLabel="Line height"
            value={run.leading * 100}
            unit="%"
            decimals={0}
            min={50}
            onChange={(v) =>
              editNode<TextNode>(t.id, 'Line height', (x) => x.runs.forEach((r) => (r.leading = v / 100)))
            }
          />
          <NumberField
            label="Track"
            ariaLabel="Tracking"
            value={run.tracking}
            decimals={0}
            onChange={(v) =>
              editNode<TextNode>(t.id, 'Tracking', (x) => x.runs.forEach((r) => (r.tracking = v)))
            }
          />
          <div className="segmented" role="group" aria-label="Alignment">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button
                key={a}
                aria-pressed={t.paragraph.align === a}
                aria-label={`Align ${a}`}
                onClick={() => editNode<TextNode>(t.id, 'Align text', (x) => void (x.paragraph.align = a))}
                style={{ padding: 0 }}
              >
                <Icon
                  name={a === 'left' ? 'alignLeft' : a === 'center' ? 'alignHCenter' : 'alignRight'}
                  size={14}
                  style={{ margin: 'auto' }}
                />
              </button>
            ))}
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          OpenType features
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
          {[
            ['kern', 'Kerning'],
            ['liga', 'Ligatures'],
            ['dlig', 'Discretionary'],
            ['smcp', 'Small caps'],
            ['onum', 'Oldstyle nums'],
            ['tnum', 'Tabular nums'],
            ['ss01', 'Stylistic 1'],
          ].map(([k, label]) => (
            <button
              key={k}
              className="chip"
              aria-pressed={feat(k)}
              onClick={() =>
                editNode<TextNode>(t.id, 'OpenType feature', (x) =>
                  x.runs.forEach((r) => (r.features = { ...r.features, [k]: !feat(k) })),
                )
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid2">
          <button
            className="small-btn"
            onClick={() =>
              editNode<TextNode>(t.id, 'Text mode', (x) => {
                if (x.mode === 'area') {
                  x.mode = 'point';
                  delete x.box;
                } else {
                  x.mode = 'area';
                  x.box = { width: 240, height: run.size * run.leading * 4 };
                }
              })
            }
          >
            {t.mode === 'area' ? 'Point text' : 'Area text'}
          </button>
          <button
            className="small-btn"
            onClick={() => void import('../../state/extra').then((m) => m.createOutlines())}
          >
            Create outlines
          </button>
        </div>
      </section>
    );
  }
  if (n.type === 'image') {
    const im = n as ImageNode;
    return (
      <section className="insp-section">
        <h3>Image</h3>
        <div className="muted" style={{ fontSize: 12 }}>
          {Math.round(im.width)} × {Math.round(im.height)} pt
        </div>
      </section>
    );
  }
  if (n.type === 'instance') {
    const sym = od.doc.symbols.find((s) => s.id === n.symbol);
    return (
      <section className="insp-section">
        <h3>Symbol</h3>
        <div className="muted" style={{ fontSize: 12 }}>
          {sym?.name ?? 'Missing symbol'}
        </div>
        <button className="small-btn" onClick={() => detachInstance(n.id)}>
          Detach
        </button>
      </section>
    );
  }
  return null;
}

function DocumentSection({ od }: { od: OpenDoc }) {
  const ab = od.doc.artboards.find((a) => a.id === od.activeArtboard) ?? od.doc.artboards[0];
  if (!ab) return null;
  const unit = od.doc.units;
  const editAb = (label: string, fn: (a: Draft<CurvsDocument>['artboards'][0]) => void) =>
    mutate(
      label,
      (d) => {
        const a = d.artboards.find((x) => x.id === ab.id);
        if (a) fn(a);
      },
      undefined,
      { coalesce: 700 },
    );
  return (
    <>
      <section className="insp-section">
        <div className="insp-head">
          <h3>Artboard</h3>
          <div className="actions">
            <Tip label="Add artboard">
              <button
                className="icon-btn sm"
                aria-label="Add artboard"
                onClick={() =>
                  mutate('Add artboard', (d) => {
                    const right = Math.max(...d.artboards.map((a) => a.x + a.width));
                    d.artboards.push({
                      ...clone(ab),
                      id: `ab_${Date.now().toString(36)}`,
                      name: `Artboard ${d.artboards.length + 1}`,
                      x: right + 60,
                      children: [],
                      guides: [],
                    } as never);
                  })
                }
              >
                <Icon name="plus" />
              </button>
            </Tip>
            <Tip label="Delete artboard">
              <button
                className="icon-btn sm"
                aria-label="Delete artboard"
                disabled={od.doc.artboards.length < 2}
                onClick={() =>
                  mutate(
                    'Delete artboard',
                    (d) => void (d.artboards = d.artboards.filter((a) => a.id !== ab.id)),
                  )
                }
              >
                <Icon name="trash" />
              </button>
            </Tip>
          </div>
        </div>
        <label className="field">
          <span className="label">Name</span>
          <input
            aria-label="Artboard name"
            key={ab.id + ab.name}
            defaultValue={ab.name}
            style={{ fontFamily: 'var(--font-ui)' }}
            onBlur={(e) =>
              e.target.value.trim() &&
              e.target.value !== ab.name &&
              editAb('Rename artboard', (a) => void (a.name = e.target.value.trim()))
            }
          />
        </label>
        <div className="grid2">
          <NumberField
            label="W"
            ariaLabel="Artboard width"
            value={fromPt(ab.width, unit)}
            unit={unit}
            mathUnit={unit}
            min={1}
            onChange={(v) => editAb('Artboard size', (a) => void (a.width = toPt(v, unit)))}
          />
          <NumberField
            label="H"
            ariaLabel="Artboard height"
            value={fromPt(ab.height, unit)}
            unit={unit}
            mathUnit={unit}
            min={1}
            onChange={(v) => editAb('Artboard size', (a) => void (a.height = toPt(v, unit)))}
          />
        </div>
        <div className="row">
          <ColorPopover
            value={ab.background}
            allowNone
            onChange={(c) => editAb('Artboard background', (a) => void (a.background = c as never))}
          >
            <button className="ap-row" style={{ flex: 1 }} aria-label="Artboard background">
              <span className="kind">Fill</span>
              <span
                className="swatch"
                style={{
                  ['--sw' as string]: ab.background
                    ? `linear-gradient(${cssColor(ab.background, od.doc.swatches)}, ${cssColor(ab.background, od.doc.swatches)})`
                    : 'none',
                }}
              />
              <span className="value">{ab.background ? 'Background' : 'Transparent'}</span>
            </button>
          </ColorPopover>
          <button
            className="small-btn"
            onClick={() =>
              editAb('Swap orientation', (a) => {
                const w = a.width;
                a.width = a.height;
                a.height = w;
              })
            }
            aria-label="Swap orientation"
          >
            <Icon name="swap" size={14} />
          </button>
        </div>
        {ab.guides.length > 0 && (
          <button className="small-btn" onClick={() => editAb('Clear guides', (a) => void (a.guides = []))}>
            Clear {ab.guides.length} guide{ab.guides.length === 1 ? '' : 's'}
          </button>
        )}
      </section>
      <section className="insp-section">
        <h3>Document</h3>
        <label className="field">
          <span className="label">Units</span>
          <select
            aria-label="Document units"
            value={unit}
            onChange={(e) => mutate('Units', (d) => void (d.units = e.target.value as Unit))}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
      </section>
    </>
  );
}

export function DesignTab() {
  const od = useActiveDoc();
  if (!od) return null;
  if (!od.selection.length)
    return (
      <>
        <DocumentSection od={od} />
        <div className="empty-insp">Select an object to edit it.</div>
      </>
    );
  return (
    <>
      <SelectionHeader od={od} />
      <TransformSection od={od} />
      <AppearanceSection od={od} />
      <ShapeSection od={od} />
      <CombineSection od={od} />
    </>
  );
}

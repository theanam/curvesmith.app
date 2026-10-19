import * as M from '@radix-ui/react-dropdown-menu';
import * as P from '@radix-ui/react-popover';
import { useState } from 'react';
import type { Draft } from 'immer';
import type {
  AppearanceItem,
  BlendMode,
  Color,
  CurvsDocument,
  Effect,
  EffectItem,
  FillItem,
  Paint,
  SceneNode,
  StrokeItem,
} from '../../core/types';
import { mutate, type OpenDoc } from '../../state/store';
import { locate, makeFill, makeStroke, INK, clone } from '../../core/document';
import { colorLabel, cssColor, paintPrimaryColor, resolveColor, rgb } from '../../core/color';
import { newId } from '../../core/id';
import { ColorPicker } from './ColorPicker';
import { Icon } from '../icons';
import { NumberField } from '../controls/NumberField';
import { Segmented } from '../controls/Segmented';
import { DASH_PRESETS, PROFILE_PRESETS, profileScale } from '../../core/geometry/strokes';
import { Tip } from '../controls/Tooltip';
import { localBounds } from '../../core/geometry/node';

const BLENDS: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
];
const blendLabel = (b: string) =>
  b
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

/** Apply an edit to the same appearance item index on every selected node. */
function editItems(
  od: OpenDoc,
  label: string,
  index: number,
  fn: (it: Draft<AppearanceItem>, n: Draft<SceneNode>) => void,
  coalesce = 700,
) {
  mutate(
    label,
    (d) => {
      for (const id of od.selection) {
        const loc = locate(d as unknown as CurvsDocument, id);
        const n = loc?.node as Draft<SceneNode> | undefined;
        const it = n?.appearance.items[index];
        if (n && it) fn(it, n);
      }
    },
    undefined,
    { coalesce },
  );
}

function editAppearance(
  od: OpenDoc,
  label: string,
  fn: (items: Draft<AppearanceItem>[], n: Draft<SceneNode>) => void,
) {
  mutate(label, (d) => {
    for (const id of od.selection) {
      const loc = locate(d as unknown as CurvsDocument, id);
      if (loc) fn((loc.node as Draft<SceneNode>).appearance.items, loc.node as Draft<SceneNode>);
    }
  });
}

const swatchBg = (p: Paint, od: OpenDoc) => {
  if (p.type === 'solid') {
    const c = cssColor(p.color, od.doc.swatches);
    return `linear-gradient(${c}, ${c})`;
  }
  const stops = [...p.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => `${cssColor(s.color, od.doc.swatches)} ${s.offset * 100}%`);
  return p.type === 'radial'
    ? `radial-gradient(${stops.join(', ')})`
    : `linear-gradient(90deg, ${stops.join(', ')})`;
};

function paintLabel(p: Paint, od: OpenDoc): string {
  if (p.type !== 'solid') return `${p.type[0].toUpperCase()}${p.type.slice(1)} gradient`;
  if ('swatch' in p.color) {
    const sw = od.doc.swatches.find((s) => s.id === (p.color as { swatch: string }).swatch);
    return sw?.name ?? 'Swatch';
  }
  return colorLabel(p.color, od.doc);
}

function ProfilePreview({ profile, width = 56 }: { profile: [number, number][] | null; width?: number }) {
  const pts: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const s = profile ? profileScale(profile, t) : 1;
    pts.push(`${t * width},${7 - s * 4}`);
    bottom.unshift(`${t * width},${7 + s * 4}`);
  }
  return (
    <svg width={width} height={14} viewBox={`0 0 ${width} 14`} aria-hidden style={{ flexShrink: 0 }}>
      <polygon points={[...pts, ...bottom].join(' ')} fill="currentColor" />
    </svg>
  );
}

function PaintEditor({ od, paint, onChange }: { od: OpenDoc; paint: Paint; onChange(p: Paint): void }) {
  const [stop, setStop] = useState(0);
  const kind = paint.type;
  const bounds = od.selection.length ? localBounds(locate(od.doc, od.selection[0])!.node, od.doc) : null;
  const toGradient = (type: 'linear' | 'radial' | 'conic'): Paint => {
    if (paint.type !== 'solid') return { ...paint, type };
    const c = paint.color;
    const b = bounds ?? { x: 0, y: 0, width: 100, height: 100 };
    const end: Color =
      resolveColor(c, od.doc.swatches).r +
        resolveColor(c, od.doc.swatches).g +
        resolveColor(c, od.doc.swatches).b >
      1.5
        ? INK
        : rgb(1, 1, 1);
    return type === 'linear'
      ? {
          type,
          from: [b.x, b.y + b.height / 2],
          to: [b.x + b.width, b.y + b.height / 2],
          stops: [
            { offset: 0, color: c },
            { offset: 1, color: end },
          ],
        }
      : {
          type,
          from: [b.x + b.width / 2, b.y + b.height / 2],
          to: [b.x + b.width, b.y + b.height / 2],
          stops: [
            { offset: 0, color: c },
            { offset: 1, color: end },
          ],
        };
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Segmented
        label="Paint type"
        value={kind}
        onChange={(v) => {
          if (v === 'solid') onChange({ type: 'solid', color: paintPrimaryColor(paint) });
          else onChange(toGradient(v));
        }}
        options={[
          { value: 'solid', label: 'Solid' },
          { value: 'linear', label: 'Linear' },
          { value: 'radial', label: 'Radial' },
          { value: 'conic', label: 'Conic' },
        ]}
      />
      {paint.type === 'solid' ? (
        <ColorPicker
          value={paint.color}
          swatches={od.doc.swatches}
          onChange={(c) => c && onChange({ type: 'solid', color: c })}
        />
      ) : (
        <>
          <div
            style={{
              position: 'relative',
              height: 22,
              margin: '0 7px',
              borderRadius: 6,
              background: swatchBg({ ...paint, type: 'linear' }, od),
              boxShadow: 'inset 0 0 0 1px var(--line)',
            }}
          >
            {paint.stops.map((s, i) => (
              <button
                key={i}
                aria-label={`Stop ${i + 1}`}
                onClick={() => setStop(i)}
                style={{
                  position: 'absolute',
                  left: `calc(${s.offset * 100}% - 7px)`,
                  top: 3,
                  width: 14,
                  height: 16,
                  borderRadius: 4,
                  padding: 0,
                  background: cssColor(s.color, od.doc.swatches),
                  border: `2px solid ${i === stop ? 'var(--cs-volt)' : '#fff'}`,
                  boxShadow: '0 0 0 1px rgba(0,0,0,.3)',
                }}
              />
            ))}
          </div>
          <div className="row">
            <NumberField
              label="Pos"
              ariaLabel="Stop position"
              value={Math.round((paint.stops[stop]?.offset ?? 0) * 100)}
              unit="%"
              decimals={0}
              min={0}
              max={100}
              onChange={(v) =>
                onChange({
                  ...paint,
                  stops: paint.stops.map((s, i) => (i === stop ? { ...s, offset: v / 100 } : s)),
                })
              }
            />
            <Tip label="Add stop">
              <button
                className="icon-btn sm"
                aria-label="Add stop"
                onClick={() => {
                  const s = paint.stops[stop] ?? paint.stops[0];
                  onChange({
                    ...paint,
                    stops: [...paint.stops, { offset: Math.min(1, s.offset + 0.1), color: clone(s.color) }],
                  });
                  setStop(paint.stops.length);
                }}
              >
                <Icon name="plus" />
              </button>
            </Tip>
            <Tip label="Remove stop">
              <button
                className="icon-btn sm"
                aria-label="Remove stop"
                disabled={paint.stops.length <= 2}
                onClick={() => {
                  onChange({ ...paint, stops: paint.stops.filter((_, i) => i !== stop) });
                  setStop(0);
                }}
              >
                <Icon name="trash" />
              </button>
            </Tip>
            <Tip label="Reverse">
              <button
                className="icon-btn sm"
                aria-label="Reverse gradient"
                onClick={() =>
                  onChange({ ...paint, stops: paint.stops.map((s) => ({ ...s, offset: 1 - s.offset })) })
                }
              >
                <Icon name="swap" />
              </button>
            </Tip>
          </div>
          {paint.stops[stop] && (
            <ColorPicker
              value={paint.stops[stop].color}
              swatches={od.doc.swatches}
              onChange={(c) =>
                c &&
                onChange({
                  ...paint,
                  stops: paint.stops.map((s, i) => (i === stop ? { ...s, color: c } : s)),
                })
              }
            />
          )}
          <span className="muted" style={{ fontSize: 12 }}>
            Use the Gradient tool (G) to set the direction on canvas.
          </span>
        </>
      )}
    </div>
  );
}

function StrokeEditor({ od, item, index }: { od: OpenDoc; item: StrokeItem; index: number }) {
  const ed = (label: string, fn: (s: Draft<StrokeItem>) => void) =>
    editItems(od, label, index, (it) => it.kind === 'stroke' && fn(it as Draft<StrokeItem>));
  const [tab, setTab] = useState<'style' | 'color'>('style');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 260 }}>
      <Segmented<'style' | 'color'>
        label="Stroke settings"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'style', label: 'Style' },
          { value: 'color', label: 'Color' },
        ]}
      />
      {tab === 'color' ? (
        <PaintEditor
          od={od}
          paint={item.paint}
          onChange={(p) => ed('Stroke color', (s) => void (s.paint = p as never))}
        />
      ) : (
        <>
          <div className="grid2">
            <NumberField
              label="W"
              ariaLabel="Stroke weight"
              value={item.width}
              unit="pt"
              mathUnit="pt"
              min={0}
              step={0.5}
              onChange={(v) => ed('Stroke weight', (s) => void (s.width = v))}
            />
            <NumberField
              label="Op."
              ariaLabel="Stroke opacity"
              value={Math.round(item.opacity * 100)}
              unit="%"
              decimals={0}
              min={0}
              max={100}
              onChange={(v) => ed('Stroke opacity', (s) => void (s.opacity = v / 100))}
            />
          </div>
          <Segmented
            label="Align"
            value={item.align}
            onChange={(v) => ed('Stroke align', (s) => void (s.align = v))}
            options={[
              { value: 'inside', label: 'Inside' },
              { value: 'center', label: 'Center' },
              { value: 'outside', label: 'Outside' },
            ]}
          />
          <div className="grid2">
            <label className="field">
              <span className="label">Cap</span>
              <select
                aria-label="Cap"
                value={item.cap}
                onChange={(e) => ed('Stroke cap', (s) => void (s.cap = e.target.value as StrokeItem['cap']))}
              >
                <option value="butt">Butt</option>
                <option value="round">Round</option>
                <option value="square">Square</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Join</span>
              <select
                aria-label="Join"
                value={item.join}
                onChange={(e) =>
                  ed('Stroke join', (s) => void (s.join = e.target.value as StrokeItem['join']))
                }
              >
                <option value="miter">Miter</option>
                <option value="round">Round</option>
                <option value="bevel">Bevel</option>
              </select>
            </label>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Dashes
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {DASH_PRESETS.map((d) => (
              <button
                key={d.label}
                className="chip"
                aria-pressed={JSON.stringify(d.dash) === JSON.stringify(item.dash)}
                onClick={() =>
                  ed('Dashes', (s) => void (s.dash = d.dash.map((x) => x * Math.max(1, item.width / 2))))
                }
              >
                {d.label}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="label">Dash</span>
            <input
              aria-label="Dash pattern"
              key={item.dash.join(',')}
              defaultValue={item.dash.join(' ')}
              placeholder="e.g. 6 4"
              onBlur={(e) => {
                const v = e.target.value
                  .split(/[\s,]+/)
                  .map(Number)
                  .filter((n) => Number.isFinite(n) && n >= 0);
                ed('Dashes', (s) => void (s.dash = v));
              }}
            />
          </label>
          <div className="muted" style={{ fontSize: 12 }}>
            Width profile
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {PROFILE_PRESETS.map((p) => (
              <Tip key={p.label} label={p.label}>
                <button
                  className="chip"
                  aria-label={p.label}
                  aria-pressed={JSON.stringify(p.profile) === JSON.stringify(item.profile)}
                  onClick={() => ed('Width profile', (s) => void (s.profile = p.profile as never))}
                  style={{ display: 'flex', alignItems: 'center', color: 'var(--fg)' }}
                >
                  <ProfilePreview profile={p.profile} width={34} />
                </button>
              </Tip>
            ))}
          </div>
          <div className="grid2">
            {(['arrowStart', 'arrowEnd'] as const).map((k) => (
              <label key={k} className="field">
                <span className="label">{k === 'arrowStart' ? 'Start' : 'End'}</span>
                <select
                  aria-label={k === 'arrowStart' ? 'Start arrowhead' : 'End arrowhead'}
                  value={item[k] ?? ''}
                  onChange={(e) =>
                    ed('Arrowhead', (s) => void (s[k] = (e.target.value || null) as StrokeItem['arrowEnd']))
                  }
                >
                  <option value="">None</option>
                  <option value="arrow">Arrow</option>
                  <option value="triangle">Triangle</option>
                  <option value="circle">Circle</option>
                  <option value="square">Square</option>
                  <option value="bar">Bar</option>
                </select>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function EffectEditor({ od, item, index }: { od: OpenDoc; item: EffectItem; index: number }) {
  const ed = (fn: (e: Draft<Effect>) => void) =>
    editItems(od, 'Effect', index, (it) => it.kind === 'effect' && fn((it as Draft<EffectItem>).effect));
  const e = item.effect;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 244 }}>
      <Segmented
        label="Effect type"
        value={e.type}
        onChange={(t) =>
          editItems(od, 'Effect type', index, (it) => {
            if (it.kind !== 'effect') return;
            (it as Draft<EffectItem>).effect = (
              t === 'blur'
                ? { type: 'blur', radius: 4 }
                : { type: t, x: 0, y: 6, blur: 12, color: rgb(0, 0, 0, 0.35) }
            ) as never;
          })
        }
        options={[
          { value: 'dropShadow', label: 'Drop' },
          { value: 'innerShadow', label: 'Inner' },
          { value: 'blur', label: 'Blur' },
        ]}
      />
      {e.type === 'blur' ? (
        <NumberField
          label="R"
          ariaLabel="Blur radius"
          value={e.radius}
          unit="pt"
          min={0}
          onChange={(v) => ed((x) => void ((x as Extract<Effect, { type: 'blur' }>).radius = v))}
        />
      ) : (
        <>
          <div className="grid2">
            <NumberField
              label="X"
              ariaLabel="Shadow X"
              value={e.x}
              unit="pt"
              onChange={(v) => ed((x) => void ((x as Extract<Effect, { x: number }>).x = v))}
            />
            <NumberField
              label="Y"
              ariaLabel="Shadow Y"
              value={e.y}
              unit="pt"
              onChange={(v) => ed((x) => void ((x as Extract<Effect, { x: number }>).y = v))}
            />
            <NumberField
              label="Blur"
              ariaLabel="Shadow blur"
              value={e.blur}
              unit="pt"
              min={0}
              onChange={(v) => ed((x) => void ((x as Extract<Effect, { x: number }>).blur = v))}
            />
          </div>
          <ColorPicker
            value={e.color}
            swatches={od.doc.swatches}
            onChange={(c) => c && ed((x) => void ((x as Extract<Effect, { x: number }>).color = c as never))}
          />
        </>
      )}
    </div>
  );
}

function Row({
  od,
  item,
  index,
  active,
  onDragStart,
  onDrop,
}: {
  od: OpenDoc;
  item: AppearanceItem;
  index: number;
  active: boolean;
  onDragStart(): void;
  onDrop(): void;
}) {
  const [over, setOver] = useState(false);
  const toggle = (
    <Tip label={item.visible ? 'Hide' : 'Show'}>
      <button
        className="icon-btn sm"
        aria-label={item.visible ? 'Hide' : 'Show'}
        onClick={() =>
          editItems(od, item.visible ? 'Hide' : 'Show', index, (it) => void (it.visible = !it.visible), 0)
        }
      >
        <Icon name={item.visible ? 'eye' : 'eyeOff'} size={14} />
      </button>
    </Tip>
  );
  const remove = (
    <Tip label="Remove">
      <button
        className="icon-btn sm"
        aria-label="Remove"
        onClick={() => editAppearance(od, 'Remove appearance', (items) => void items.splice(index, 1))}
      >
        <Icon name="minus" size={14} />
      </button>
    </Tip>
  );
  let summary: React.ReactNode;
  let editor: React.ReactNode;
  if (item.kind === 'fill') {
    summary = (
      <>
        <span className="kind">Fill</span>
        <span className="swatch" style={{ ['--sw' as string]: swatchBg(item.paint, od) }} />
        <span className="value">{paintLabel(item.paint, od)}</span>
        <span className="pct">{Math.round(item.opacity * 100)}%</span>
      </>
    );
    editor = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 244 }}>
        <PaintEditor
          od={od}
          paint={item.paint}
          onChange={(p) =>
            editItems(od, 'Fill', index, (it) => void ((it as Draft<FillItem>).paint = p as never))
          }
        />
        <div className="grid2">
          <NumberField
            label="Op."
            ariaLabel="Fill opacity"
            value={Math.round(item.opacity * 100)}
            unit="%"
            decimals={0}
            min={0}
            max={100}
            onChange={(v) =>
              editItems(od, 'Fill opacity', index, (it) => void ((it as Draft<FillItem>).opacity = v / 100))
            }
          />
          <label className="field">
            <select
              aria-label="Fill blend mode"
              value={item.blend}
              onChange={(e) =>
                editItems(
                  od,
                  'Fill blend',
                  index,
                  (it) => void ((it as Draft<FillItem>).blend = e.target.value as BlendMode),
                )
              }
            >
              {BLENDS.map((b) => (
                <option key={b} value={b}>
                  {blendLabel(b)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    );
  } else if (item.kind === 'stroke') {
    const c = paintPrimaryColor(item.paint);
    summary = (
      <>
        <span className="kind">Stroke</span>
        <span className="swatch stroke" style={{ ['--sw-color' as string]: cssColor(c, od.doc.swatches) }} />
        <span className="value">{Math.round(item.width * 100) / 100} pt</span>
        <span style={{ color: 'var(--fg)', display: 'flex' }}>
          <ProfilePreview profile={item.profile} />
        </span>
      </>
    );
    editor = <StrokeEditor od={od} item={item} index={index} />;
  } else {
    const e = item.effect;
    summary = (
      <>
        <span className="kind">Effect</span>
        <span className="value" style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--text-md)' }}>
          {e.type === 'dropShadow' ? 'Drop shadow' : e.type === 'innerShadow' ? 'Inner shadow' : 'Blur'}
        </span>
        <span className="pct">{e.type === 'blur' ? `${e.radius}` : `${e.x}, ${e.y}, ${e.blur}`}</span>
      </>
    );
    editor = <EffectEditor od={od} item={item} index={index} />;
  }
  return (
    <div
      className={`ap-row ${active ? 'active' : ''} ${item.visible ? '' : 'hidden-item'}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
      style={over ? { boxShadow: 'inset 0 2px 0 var(--cs-volt)' } : undefined}
    >
      <P.Root>
        <P.Trigger asChild>
          <button className="ap-open" aria-label={`Edit ${item.kind}`}>
            {summary}
          </button>
        </P.Trigger>
        <P.Portal>
          <P.Content className="popover" side="left" align="start" sideOffset={12} collisionPadding={12}>
            {editor}
          </P.Content>
        </P.Portal>
      </P.Root>
      <span className="row-actions">
        {toggle}
        {remove}
      </span>
    </div>
  );
}

export function AppearanceSection({ od }: { od: OpenDoc }) {
  const [drag, setDrag] = useState<number | null>(null);
  const first = locate(od.doc, od.selection[0])?.node;
  if (!first) return null;
  const isContainer = first.type === 'group' || first.type === 'clipGroup' || first.type === 'instance';
  const items = first.appearance.items;
  // Displayed top to bottom = painted last to first, like Illustrator's Appearance panel.
  const order = items.map((_, i) => i).reverse();
  const add = (kind: 'fill' | 'stroke' | 'dropShadow' | 'innerShadow' | 'blur') =>
    editAppearance(od, 'Add appearance', (list) => {
      if (kind === 'fill') list.push(makeFill(rgb(0.85, 0.85, 0.85)) as never);
      else if (kind === 'stroke') list.push(makeStroke(INK, 1) as never);
      else
        list.push({
          kind: 'effect',
          id: newId('ap'),
          visible: true,
          effect:
            kind === 'blur'
              ? { type: 'blur', radius: 4 }
              : { type: kind, x: 0, y: kind === 'dropShadow' ? 6 : 4, blur: 12, color: rgb(0, 0, 0, 0.35) },
        } as never);
    });
  return (
    <section className="insp-section" style={{ gap: 8 }}>
      <div className="insp-head">
        <h3>Appearance</h3>
        <M.Root modal={false}>
          <Tip label="Add fill, stroke or effect">
            <M.Trigger asChild>
              <button className="icon-btn sm" aria-label="Add fill, stroke or effect">
                <Icon name="plus" />
              </button>
            </M.Trigger>
          </Tip>
          <M.Portal>
            <M.Content className="menu-content" align="end" sideOffset={4}>
              {!isContainer && (
                <>
                  <M.Item className="menu-item" onSelect={() => add('fill')}>
                    <Icon name="fillIcon" /> Fill
                  </M.Item>
                  <M.Item className="menu-item" onSelect={() => add('stroke')}>
                    <Icon name="strokeIcon" /> Stroke
                  </M.Item>
                  <M.Separator className="menu-sep" />
                </>
              )}
              <M.Item className="menu-item" onSelect={() => add('dropShadow')}>
                <Icon name="effect" /> Drop shadow
              </M.Item>
              <M.Item className="menu-item" onSelect={() => add('innerShadow')}>
                <Icon name="effect" /> Inner shadow
              </M.Item>
              <M.Item className="menu-item" onSelect={() => add('blur')}>
                <Icon name="effect" /> Blur
              </M.Item>
            </M.Content>
          </M.Portal>
        </M.Root>
      </div>
      {order.map((i) => (
        <Row
          key={items[i].id}
          od={od}
          item={items[i]}
          index={i}
          active={false}
          onDragStart={() => setDrag(i)}
          onDrop={() => {
            if (drag === null || drag === i) return;
            const from = drag;
            editAppearance(od, 'Reorder appearance', (list) => {
              const [it] = list.splice(from, 1);
              list.splice(i, 0, it);
            });
            setDrag(null);
          }}
        />
      ))}
      {!items.length && (
        <span className="muted" style={{ fontSize: 12 }}>
          No fill or stroke.
        </span>
      )}
      <NodeBlendOpacity od={od} />
    </section>
  );
}

export function NodeBlendOpacity({ od }: { od: OpenDoc }) {
  const first = locate(od.doc, od.selection[0])?.node;
  if (!first) return null;
  const set = (label: string, fn: (n: Draft<SceneNode>) => void) =>
    mutate(
      label,
      (d) => {
        for (const id of od.selection) {
          const loc = locate(d as unknown as CurvsDocument, id);
          if (loc) fn(loc.node as Draft<SceneNode>);
        }
      },
      undefined,
      { coalesce: 700 },
    );
  return (
    <div className="row blend-row">
      <label className="field" style={{ flex: 1 }}>
        <span className="label">Blend</span>
        <select
          aria-label="Blend mode"
          value={first.blend}
          onChange={(e) => set('Blend mode', (n) => void (n.blend = e.target.value as BlendMode))}
          style={{ textAlign: 'right' }}
        >
          {BLENDS.map((b) => (
            <option key={b} value={b}>
              {blendLabel(b)}
            </option>
          ))}
        </select>
      </label>
      <NumberField
        className="op-field"
        label="Op."
        ariaLabel="Opacity"
        value={Math.round(first.opacity * 100)}
        unit="%"
        decimals={0}
        min={0}
        max={100}
        onChange={(v) => set('Opacity', (n) => void (n.opacity = v / 100))}
      />
    </div>
  );
}

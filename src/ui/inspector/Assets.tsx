import * as P from '@radix-ui/react-popover';
import { useEffect, useRef } from 'react';
import type { Draft } from 'immer';
import type { Appearance, CurvsDocument, FillItem, SceneNode, Swatch, SymbolDef } from '../../core/types';
import { mutate, useActiveDoc, type OpenDoc } from '../../state/store';
import { locate, clone } from '../../core/document';
import { colorToHex, paintPrimaryColor, resolveColor, rgb } from '../../core/color';
import { newId } from '../../core/id';
import { ColorPicker } from './ColorPicker';
import { Icon } from '../icons';
import { Tip } from '../controls/Tooltip';
import { drawNode } from '../../render/paint';
import { nodeBounds } from '../../core/geometry/node';
import { placeSymbol } from '../../state/extra';

function selectedFill(od: OpenDoc) {
  const n = od.selection.length ? locate(od.doc, od.selection[0])?.node : null;
  const f = n?.appearance.items.find((i) => i.kind === 'fill') as FillItem | undefined;
  return f ? paintPrimaryColor(f.paint) : null;
}

function applySwatch(od: OpenDoc, sw: Swatch) {
  if (!od.selection.length) return;
  mutate('Apply color', (d) => {
    for (const id of od.selection) {
      const loc = locate(d as unknown as CurvsDocument, id);
      if (!loc) continue;
      const n = loc.node as Draft<SceneNode>;
      const f = n.appearance.items.find((i) => i.kind === 'fill') as Draft<FillItem> | undefined;
      const color = sw.global ? { swatch: sw.id } : clone(sw.color);
      if (f) f.paint = { type: 'solid', color } as never;
      else
        n.appearance.items.unshift({
          kind: 'fill',
          id: newId('ap'),
          visible: true,
          paint: { type: 'solid', color },
          opacity: 1,
          blend: 'normal',
        } as never);
    }
  });
}

function SwatchCell({ od, sw }: { od: OpenDoc; sw: Swatch }) {
  const hex = `#${colorToHex(resolveColor(sw.color))}`;
  return (
    <P.Root>
      <Tip
        label={`${sw.name}${sw.global ? ' · global' : ''}${od.selection.length ? ' · right-click to edit' : ''}`}
      >
        <P.Trigger asChild>
          <button
            className="doc-swatch"
            aria-label={sw.name}
            onClick={(e) => {
              // With a selection, a click applies the color; ⌥-click or right-click edits it.
              if (od.selection.length && !e.altKey) {
                e.preventDefault();
                applySwatch(od, sw);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).dispatchEvent(
                new MouseEvent('click', { bubbles: true, altKey: true }),
              );
            }}
            style={{ background: hex }}
          />
        </P.Trigger>
      </Tip>
      <P.Portal>
        <P.Content className="popover" side="left" align="start" sideOffset={10} collisionPadding={12}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 244 }}>
            <label className="field">
              <span className="label">Name</span>
              <input
                aria-label="Swatch name"
                defaultValue={sw.name}
                style={{ fontFamily: 'var(--font-ui)' }}
                onBlur={(e) =>
                  mutate(
                    'Rename swatch',
                    (d) => void (d.swatches.find((s) => s.id === sw.id)!.name = e.target.value || sw.name),
                  )
                }
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={sw.global}
                onChange={(e) =>
                  mutate(
                    'Global color',
                    (d) => void (d.swatches.find((s) => s.id === sw.id)!.global = e.target.checked),
                  )
                }
              />
              Global (edits update every use)
            </label>
            <ColorPicker
              value={sw.color}
              onChange={(c) => {
                if (!c || 'swatch' in c) return;
                mutate(
                  'Edit swatch',
                  (d) => void (d.swatches.find((s) => s.id === sw.id)!.color = c as never),
                  undefined,
                  { coalesce: 700 },
                );
              }}
            />
            <button
              className="small-btn"
              onClick={() =>
                mutate('Delete swatch', (d) => void (d.swatches = d.swatches.filter((s) => s.id !== sw.id)))
              }
            >
              <Icon name="trash" size={14} /> Delete
            </button>
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

function SymbolThumb({ od, sym }: { od: OpenDoc; sym: SymbolDef }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = 80 * dpr;
    c.height = 80 * dpr;
    const ctx = c.getContext('2d')!;
    const b = nodeBounds(sym.root, od.doc);
    if (!b) return;
    const s = Math.min(60 / Math.max(b.width, 1), 60 / Math.max(b.height, 1));
    ctx.setTransform(
      dpr * s,
      0,
      0,
      dpr * s,
      dpr * (40 - (b.x + b.width / 2) * s),
      dpr * (40 - (b.y + b.height / 2) * s),
    );
    drawNode(ctx, sym.root, od.doc, { pixelScale: s * dpr });
  }, [od.doc, sym]);
  return <canvas ref={ref} style={{ width: 80, height: 80 }} aria-hidden />;
}

export function AssetsTab() {
  const od = useActiveDoc();
  if (!od) return null;
  const doc = od.doc;
  const addSwatch = () => {
    const c = selectedFill(od);
    const color = c ? resolveColor(c, doc.swatches) : rgb(0.17, 0.37, 0.42);
    const sw: Swatch = { id: newId('sw'), name: `Color ${doc.swatches.length + 1}`, color, global: true };
    mutate('Add swatch', (d) => {
      d.swatches.push(sw as never);
      // A new global color from the selection links the selection to it.
      if (c && !('swatch' in c))
        for (const id of od.selection) {
          const loc = locate(d as unknown as CurvsDocument, id);
          const f = loc?.node.appearance.items.find((i) => i.kind === 'fill') as Draft<FillItem> | undefined;
          if (f && f.paint.type === 'solid') f.paint.color = { swatch: sw.id } as never;
        }
    });
  };
  const addStyle = () => {
    const n = od.selection.length ? locate(doc, od.selection[0])?.node : null;
    if (!n) return;
    mutate(
      'Save style',
      (d) =>
        void d.styles.push({
          id: newId('st'),
          name: `Style ${d.styles.length + 1}`,
          appearance: clone(n.appearance),
        } as never),
    );
  };
  const applyStyle = (ap: Appearance) =>
    mutate('Apply style', (d) => {
      for (const id of od.selection) {
        const loc = locate(d as unknown as CurvsDocument, id);
        if (!loc) continue;
        const copy = clone(ap);
        copy.items.forEach((i) => (i.id = newId('ap')));
        (loc.node as Draft<SceneNode>).appearance = copy as never;
      }
    });
  return (
    <>
      <section className="insp-section">
        <h3>Document colors</h3>
        <div className="doc-swatches">
          {doc.swatches.map((sw) => (
            <SwatchCell key={sw.id} od={od} sw={sw} />
          ))}
          <Tip label={od.selection.length ? 'Add the selection’s fill' : 'Add color'}>
            <button className="doc-swatch add" aria-label="Add color" onClick={addSwatch}>
              <Icon name="plus" size={14} />
            </button>
          </Tip>
        </div>
        <p className="combine-note">Global colors: edit one and every object using it updates.</p>
      </section>
      <section className="insp-section">
        <div className="insp-head">
          <h3>Symbols</h3>
          <Tip label="Make symbol from selection">
            <button
              className="icon-btn sm"
              aria-label="Make symbol"
              disabled={!od.selection.length}
              onClick={() => void import('../../state/extra').then((m) => m.makeSymbol())}
            >
              <Icon name="plus" />
            </button>
          </Tip>
        </div>
        {doc.symbols.length ? (
          <div className="symbol-grid">
            {doc.symbols.map((s) => (
              <Tip key={s.id} label={`Place ${s.name}`}>
                <button
                  className="symbol-cell"
                  aria-label={`Place ${s.name}`}
                  onClick={() => placeSymbol(s.id)}
                >
                  <SymbolThumb od={od} sym={s} />
                </button>
              </Tip>
            ))}
          </div>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>
            Instances update when the master changes.
          </span>
        )}
      </section>
      <section className="insp-section">
        <div className="insp-head">
          <h3>Styles</h3>
          <Tip label="Save the selection’s appearance">
            <button
              className="icon-btn sm"
              aria-label="Save style"
              disabled={!od.selection.length}
              onClick={addStyle}
            >
              <Icon name="plus" />
            </button>
          </Tip>
        </div>
        {doc.styles.map((st) => {
          const f = st.appearance.items.find((i) => i.kind === 'fill') as FillItem | undefined;
          const s = st.appearance.items.find((i) => i.kind === 'stroke');
          const fill = f
            ? `#${colorToHex(resolveColor(paintPrimaryColor(f.paint), doc.swatches))}`
            : 'transparent';
          return (
            <div key={st.id} className="ap-row">
              <button
                className="ap-open"
                onClick={() => applyStyle(st.appearance)}
                aria-label={`Apply ${st.name}`}
              >
                <span
                  className="swatch"
                  style={{
                    ['--sw' as string]: `linear-gradient(${fill}, ${fill})`,
                    outline: s ? '2px solid var(--fg)' : undefined,
                    outlineOffset: -2,
                  }}
                />
                <span className="value" style={{ fontFamily: 'var(--font-ui)' }}>
                  {st.name}
                </span>
              </button>
              <span className="row-actions">
                <button
                  className="icon-btn sm"
                  aria-label={`Delete ${st.name}`}
                  onClick={() =>
                    mutate('Delete style', (d) => void (d.styles = d.styles.filter((x) => x.id !== st.id)))
                  }
                >
                  <Icon name="minus" size={14} />
                </button>
              </span>
            </div>
          );
        })}
        {!doc.styles.length && (
          <span className="muted" style={{ fontSize: 12 }}>
            Saved appearance stacks.
          </span>
        )}
      </section>
    </>
  );
}

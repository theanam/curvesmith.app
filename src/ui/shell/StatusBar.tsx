import * as M from '@radix-ui/react-dropdown-menu';
import * as P from '@radix-ui/react-popover';
import { useEffect, useState } from 'react';
import { setActiveArtboard, setView, useActiveDoc, isDirty, mutate, useEditor } from '../../state/store';
import { fromPt, formatNumber, toPt, UNITS } from '../../core/units';
import { ZOOM_PRESETS, zoomAt } from '../../render/viewport';
import type { Unit, Vec } from '../../core/types';
import { run, zoomFitArtboard, zoomFitAll } from '../../state/commands';
import { addArtboard, setColorMode } from '../../state/actions';
import { NumberField } from '../controls/NumberField';
import { Tip } from '../controls/Tooltip';
import { Icon } from '../icons';
import { GridControls } from '../inspector/GridGuides';

function ago(t: number | null, now: number): string {
  if (!t) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 30) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}

export function StatusBar() {
  const od = useActiveDoc();
  const showGrid = useEditor((st) => st.ui.showGrid);
  const [cursor, setCursor] = useState<Vec | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const onCursor = (e: Event) => setCursor((e as CustomEvent<Vec>).detail);
    window.addEventListener('curvesmith:cursor', onCursor);
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => {
      window.removeEventListener('curvesmith:cursor', onCursor);
      clearInterval(t);
    };
  }, []);
  if (!od) return null;
  const abs = od.doc.artboards;
  const idx = Math.max(
    0,
    abs.findIndex((a) => a.id === od.activeArtboard),
  );
  const ab = abs[idx];
  const unit = od.doc.units;
  const rel: Vec | null = cursor && ab ? [cursor[0] - ab.x, cursor[1] - ab.y] : null;
  const dirty = isDirty(od);
  const saveText = dirty
    ? od.autosavedAt
      ? `Saved to this device · ${ago(od.autosavedAt, now)}`
      : 'Unsaved changes'
    : `Saved${od.handle ? '' : ' to this device'} · ${ago(od.savedAt, now) || 'just now'}`;
  const zoom = od.view?.zoom ?? 1;
  const center = (): Vec => {
    const el = document.querySelector('[data-canvas-host]') as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return [(r?.width ?? 800) / 2, (r?.height ?? 600) / 2];
  };
  const setSize = (w: number | null, h: number | null) =>
    ab &&
    mutate(
      'Artboard size',
      (d) => {
        const a = d.artboards.find((x) => x.id === ab.id);
        if (!a) return;
        if (w !== null && w > 0) a.width = toPt(w, unit);
        if (h !== null && h > 0) a.height = toPt(h, unit);
      },
      undefined,
      { coalesce: 700 },
    );
  return (
    <footer className="statusbar">
      <M.Root modal={false}>
        <M.Trigger asChild>
          <button className="ab-switch" aria-label="Switch artboard">
            {ab?.name} · {idx + 1} of {abs.length} artboard{abs.length === 1 ? '' : 's'}
            <Chevron />
          </button>
        </M.Trigger>
        <M.Portal>
          <M.Content className="menu-content" side="top" align="start" sideOffset={6}>
            {abs.map((a) => (
              <M.Item key={a.id} className="menu-item" onSelect={() => setActiveArtboard(a.id)}>
                {a.name}
                <span className="kbd-hint">
                  {formatNumber(fromPt(a.width, unit), 1)} × {formatNumber(fromPt(a.height, unit), 1)} {unit}
                </span>
              </M.Item>
            ))}
            <M.Separator className="menu-sep" />
            <M.Item className="menu-item" onSelect={() => addArtboard()}>
              <Icon name="plus" size={14} /> Add artboard
            </M.Item>
          </M.Content>
        </M.Portal>
      </M.Root>
      {ab && (
        <P.Root>
          <P.Trigger asChild>
            <button className="hide-sm" aria-label="Artboard size and units">
              {formatNumber(fromPt(ab.width, unit), 1)} × {formatNumber(fromPt(ab.height, unit), 1)} {unit}
              <Chevron />
            </button>
          </P.Trigger>
          <P.Portal>
            <P.Content
              className="popover status-pop"
              // Fields stay unfocused until tapped, so no on-screen keyboard pops up.
              onOpenAutoFocus={(e) => e.preventDefault()}
              side="top"
              align="start"
              sideOffset={8}
              collisionPadding={10}
            >
              <div className="status-pop-title">Artboard size</div>
              <div className="wh-row">
                <NumberField
                  label="W"
                  ariaLabel="Artboard width"
                  value={fromPt(ab.width, unit)}
                  unit={unit}
                  mathUnit={unit}
                  min={0.01}
                  onChange={(v) => setSize(v, null)}
                />
                <NumberField
                  label="H"
                  ariaLabel="Artboard height"
                  value={fromPt(ab.height, unit)}
                  unit={unit}
                  mathUnit={unit}
                  min={0.01}
                  onChange={(v) => setSize(null, v)}
                />
                <Tip label="Swap width and height">
                  <button
                    className="icon-btn sm"
                    aria-label="Swap width and height"
                    onClick={() => setSize(fromPt(ab.height, unit), fromPt(ab.width, unit))}
                  >
                    <Icon name="swap" size={14} />
                  </button>
                </Tip>
              </div>
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
            </P.Content>
          </P.Portal>
        </P.Root>
      )}
      <span className="hide-sm status-cursor" style={{ minWidth: 150 }}>
        {rel
          ? `Cursor ${formatNumber(fromPt(rel[0], unit), 1)}, ${formatNumber(fromPt(rel[1], unit), 1)}`
          : ''}
      </span>
      <span className="spacer" />
      <Tip label="Save" shortcut="Mod+S" side="top">
        <button className="hide-sm status-save" aria-live="polite" onClick={() => void run('file.save')}>
          {!dirty || od.autosavedAt ? <span className="ok-dot" /> : null}
          {saveText}
        </button>
      </Tip>
      <P.Root>
        <P.Trigger asChild>
          <button className="hide-sm" aria-label="Grid settings" data-on={showGrid || undefined}>
            Grid {showGrid ? 'on' : 'off'}
            <Chevron />
          </button>
        </P.Trigger>
        <P.Portal>
          <P.Content
            className="popover status-pop"
            // Fields stay unfocused until tapped, so no on-screen keyboard pops up.
            onOpenAutoFocus={(e) => e.preventDefault()}
            side="top"
            align="end"
            sideOffset={8}
            collisionPadding={10}
          >
            <div className="status-pop-title">Grid</div>
            <GridControls od={od} />
          </P.Content>
        </P.Portal>
      </P.Root>
      <M.Root modal={false}>
        <M.Trigger asChild>
          <button className="hide-sm" aria-label="Color mode">
            {od.doc.colorProfile === 'cmyk' ? 'CMYK' : 'RGB · sRGB'}
            <Chevron />
          </button>
        </M.Trigger>
        <M.Portal>
          <M.Content className="menu-content" side="top" align="end" sideOffset={6}>
            {(
              [
                ['srgb', 'RGB · screen'],
                ['cmyk', 'CMYK · print'],
              ] as const
            ).map(([m, label]) => (
              <M.Item
                key={m}
                className={`menu-item ${od.doc.colorProfile === m ? 'current' : ''}`}
                onSelect={() => setColorMode(m)}
              >
                {label}
              </M.Item>
            ))}
          </M.Content>
        </M.Portal>
      </M.Root>
      <M.Root modal={false}>
        <M.Trigger asChild>
          <button aria-label="Zoom presets">
            {Math.round(zoom * 100)}%
            <Chevron />
          </button>
        </M.Trigger>
        <M.Portal>
          <M.Content className="menu-content" side="top" align="end" sideOffset={6} style={{ minWidth: 160 }}>
            {ZOOM_PRESETS.map((z) => (
              <M.Item
                key={z}
                className="menu-item"
                onSelect={() => od.view && setView(zoomAt(od.view, z, center()))}
              >
                {z * 100}%
              </M.Item>
            ))}
            <M.Separator className="menu-sep" />
            <M.Item className="menu-item" onSelect={zoomFitArtboard}>
              Fit artboard
            </M.Item>
            <M.Item className="menu-item" onSelect={zoomFitAll}>
              Fit all
            </M.Item>
          </M.Content>
        </M.Portal>
      </M.Root>
    </footer>
  );
}

/** Marks a status-bar item that opens a menu or panel. */
const Chevron = () => (
  <svg className="status-chevron" viewBox="0 0 10 6" width="8" height="5" aria-hidden>
    <path
      d="M1 1l4 4 4-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

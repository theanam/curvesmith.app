import * as M from '@radix-ui/react-dropdown-menu';
import { useEffect, useState } from 'react';
import { setActiveArtboard, setView, useActiveDoc, isDirty } from '../../state/store';
import { fromPt, formatNumber } from '../../core/units';
import { ZOOM_PRESETS, zoomAt } from '../../render/viewport';
import type { Vec } from '../../core/types';
import { zoomFitArtboard, zoomFitAll } from '../../state/commands';

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
  return (
    <footer className="statusbar">
      <M.Root modal={false}>
        <M.Trigger asChild>
          <button className="ab-switch" aria-label="Switch artboard">
            {ab?.name} · {idx + 1} of {abs.length} artboard{abs.length === 1 ? '' : 's'}
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
          </M.Content>
        </M.Portal>
      </M.Root>
      {ab && (
        <span className="hide-sm">
          {formatNumber(fromPt(ab.width, unit), 1)} × {formatNumber(fromPt(ab.height, unit), 1)} {unit}
        </span>
      )}
      <span className="hide-sm" style={{ minWidth: 150 }}>
        {rel
          ? `Cursor ${formatNumber(fromPt(rel[0], unit), 1)}, ${formatNumber(fromPt(rel[1], unit), 1)}`
          : ''}
      </span>
      <span className="spacer" />
      <span className="hide-sm" aria-live="polite">
        {!dirty || od.autosavedAt ? <span className="ok-dot" /> : null}
        {saveText}
      </span>
      <span className="hide-sm">{od.doc.colorProfile === 'cmyk' ? 'CMYK' : 'RGB · sRGB'}</span>
      <M.Root modal={false}>
        <M.Trigger asChild>
          <button aria-label="Zoom presets">{Math.round(zoom * 100)}%</button>
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

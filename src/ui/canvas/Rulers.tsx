import { useEffect, useRef } from 'react';
import type { OpenDoc } from '../../state/store';
import {
  beginGesture,
  cancelGesture,
  endGesture,
  getState,
  updateGesture,
  useEditor,
} from '../../state/store';
import { PT_PER, formatNumber } from '../../core/units';
import { rulerStep, toWorld } from '../../render/viewport';
import type { Vec } from '../../core/types';

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Horizontal and vertical rulers. Zero is the active artboard's top-left corner. Drag out of a ruler to add a guide. */
export function Rulers({ od, size }: { od: OpenDoc; size: { w: number; h: number } }) {
  const hRef = useRef<HTMLCanvasElement>(null);
  const vRef = useRef<HTMLCanvasElement>(null);
  const cursor = useRef<Vec | null>(null);
  const theme = useEditor((s) => s.theme);
  const guidesShown = useEditor((s) => s.ui.guides);

  useEffect(() => {
    const draw = () => {
      const s = getState();
      const d = s.docs.find((x) => x.key === s.activeKey);
      if (!d?.view) return;
      const ab = d.doc.artboards.find((a) => a.id === d.activeArtboard) ?? d.doc.artboards[0];
      const unitPt = PT_PER[d.doc.units];
      const step = rulerStep(d.view.zoom, unitPt, 50);
      const dpr = window.devicePixelRatio || 1;
      const fg = cssVar('--muted') || '#66626D';
      const tick = cssVar('--rule') || '#C9C5CE';
      for (const axis of ['x', 'y'] as const) {
        const c = axis === 'x' ? hRef.current : vRef.current;
        if (!c) continue;
        const W = Math.round(c.clientWidth * dpr);
        const H = Math.round(c.clientHeight * dpr);
        if (c.width !== W || c.height !== H) Object.assign(c, { width: W, height: H });
        const ctx = c.getContext('2d');
        if (!ctx) continue;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        const len = axis === 'x' ? c.clientWidth : c.clientHeight;
        const origin = axis === 'x' ? (ab?.x ?? 0) : (ab?.y ?? 0);
        const pan = axis === 'x' ? d.view.panX : d.view.panY;
        const z = d.view.zoom;
        const start = Math.floor(((0 - pan) / z - origin) / step) * step;
        const end = (len - pan) / z - origin;
        ctx.font = '9px "Geist Mono", ui-monospace, monospace';
        ctx.fillStyle = fg;
        ctx.strokeStyle = tick;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let v = start; v <= end + step; v += step) {
          for (let k = 0; k < 10; k++) {
            const sv = v + (k * step) / 10;
            const p = Math.round((sv + origin) * z + pan) + 0.5;
            const th = k === 0 ? 20 : k === 5 ? 7 : 4;
            if (axis === 'x') {
              ctx.moveTo(p, 20);
              ctx.lineTo(p, 20 - th);
            } else {
              ctx.moveTo(20, p);
              ctx.lineTo(20 - th, p);
            }
          }
          const p = (v + origin) * z + pan;
          const label = formatNumber(v / unitPt, 2);
          if (axis === 'x') ctx.fillText(label, p + 3, 9);
          else {
            ctx.save();
            ctx.translate(9, p + 3);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(label, -ctx.measureText(label).width - 3, 0);
            ctx.restore();
          }
        }
        ctx.stroke();
        if (cursor.current) {
          const p =
            Math.round(axis === 'x' ? cursor.current[0] * z + pan : cursor.current[1] * z + pan) + 0.5;
          ctx.strokeStyle = '#16C75B';
          ctx.beginPath();
          if (axis === 'x') {
            ctx.moveTo(p, 0);
            ctx.lineTo(p, 20);
          } else {
            ctx.moveTo(0, p);
            ctx.lineTo(20, p);
          }
          ctx.stroke();
        }
      }
    };
    draw();
    const unsub = useEditor.subscribe(draw);
    const onCursor = (e: Event) => {
      cursor.current = (e as CustomEvent<Vec>).detail;
      draw();
    };
    window.addEventListener('curvesmith:cursor', onCursor);
    return () => {
      unsub();
      window.removeEventListener('curvesmith:cursor', onCursor);
    };
  }, [size, theme]);

  const startGuide = (axis: 'x' | 'y') => (e: React.PointerEvent) => {
    // Hidden guides stay hidden: a drag from the ruler makes nothing.
    if (!getState().ui.guides) return;
    const host = document.querySelector('[data-canvas-host]') as HTMLElement | null;
    if (!host || !od.view) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const abId = od.activeArtboard;
    beginGesture();
    let index = -1;
    const move = (ev: PointerEvent) => {
      const s = getState();
      const d = s.docs.find((x) => x.key === s.activeKey);
      if (!d?.view) return;
      const r = host.getBoundingClientRect();
      const w = toWorld(d.view, [ev.clientX - r.left, ev.clientY - r.top]);
      updateGesture((doc) => {
        const ab = doc.artboards.find((a) => a.id === abId);
        if (!ab) return;
        const pos = axis === 'x' ? w[0] - ab.x : w[1] - ab.y;
        ab.guides.push({ axis, pos: Math.round(pos * 100) / 100 });
        index = ab.guides.length - 1;
      });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (ev.type === 'pointercancel') return cancelGesture();
      const r = host.getBoundingClientRect();
      const inside =
        ev.clientX >= r.left && ev.clientY >= r.top && ev.clientX <= r.right && ev.clientY <= r.bottom;
      if (inside && index >= 0) endGesture('Add guide');
      else cancelGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return (
    <>
      <div
        className={`ruler h ${guidesShown ? 'can-guide' : ''}`}
        onPointerDown={startGuide('y')}
        title={guidesShown ? 'Drag to add a guide' : undefined}
      >
        <canvas ref={hRef} />
      </div>
      <div
        className={`ruler v ${guidesShown ? 'can-guide' : ''}`}
        onPointerDown={startGuide('x')}
        title={guidesShown ? 'Drag to add a guide' : undefined}
      >
        <canvas ref={vRef} />
      </div>
    </>
  );
}

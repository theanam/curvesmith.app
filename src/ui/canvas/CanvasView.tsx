import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CurvsDocument, Vec } from '../../core/types';
import { gridOf, gridPositions, gridStep } from '../../core/grid';
import {
  getState,
  setActiveArtboard,
  setState,
  setView,
  useActiveDoc,
  useEditor,
  type ViewState,
  mutate,
  setIsolation,
  gestureActive,
  cancelGesture,
} from '../../state/store';
import { getInput, markTouch, setPointerType } from '../../state/input';
import { TouchBar } from './TouchBar';
import { activeToolImpl } from '../../tools';
import type { Overlay, ToolApi, ToolPointer } from '../../tools/types';
import { createToolApi, sharedOverlay } from '../../tools/api';
import { fitRect, toScreen, toWorld, zoomAt, clampZoom } from '../../render/viewport';
import { drawArtboardContent, drawNode } from '../../render/paint';
import { isDarkTheme } from '../../state/prefs';
import { drawGuides, drawHud, drawMarquee } from '../../render/overlay';
import { locate, parentWorldMatrix } from '../../core/document';
import { multiply } from '../../core/matrix';
import { onPathKitReady } from '../../core/booleans';
import { onFontLoaded } from '../../fonts/loader';
import { cssColor } from '../../core/color';
import { artboardAt } from '../../render/hittest';
import { Rulers } from './Rulers';
import { TextEditor } from './TextEditor';
import { placeFiles } from '../../state/io';
import { openFile } from '../../state/files';
import { Icon } from '../icons';

const overlay: Overlay = sharedOverlay();

let apiRef: (() => ToolApi | null) | null = null;
/** The active tool API (used by the global keyboard handler). */
export const currentToolApi = () => apiRef?.() ?? null;

let renderRef: (() => void) | null = null;
export const requestCanvasRender = () => renderRef?.();

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Two taps within this many milliseconds make a double-tap (the usual system double-click interval). */
const DOUBLE_TAP_MS = 500;

export function CanvasView() {
  const od = useActiveDoc();
  const ui = useEditor((s) => s.ui);
  const tool = useEditor((s) => s.tool);
  const springTool = useEditor((s) => s.springTool);
  const editingText = useEditor((s) => s.editingText);
  const croppingImage = useEditor((s) => s.croppingImage);
  const hostRef = useRef<HTMLDivElement>(null);
  const docCanvas = useRef<HTMLCanvasElement>(null);
  const overCanvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const pointer = useRef<ToolPointer | null>(null);
  const frame = useRef(0);
  const panning = useRef<{ x: number; y: number; view: ViewState } | null>(null);
  // Touch: fingers on the canvas, a two-finger pinch in progress, and the last tap (for double-tap).
  const touches = useRef(new Map<number, Vec>());
  const pinch = useRef<{ dist: number; mid: Vec; view: ViewState } | null>(null);
  /** Fingers left over from a pinch do nothing until they lift. */
  const ignored = useRef(new Set<number>());
  const lastTap = useRef<{ t: number; at: Vec } | null>(null);
  /** When a double-tap was last synthesized (never, at first: a real double-click right after load counts). */
  const syntheticDbl = useRef(-Infinity);
  const [cursor, setCursor] = useState<string>('default');

  const activeTool = springTool ?? tool;
  const impl = activeToolImpl({ springTool, tool, croppingImage });

  // ---- Size --------------------------------------------------------------------------------
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the artboard the first time a document is shown.
  useEffect(() => {
    if (!od || od.view || !size.w) return;
    const ab = od.doc.artboards.find((a) => a.id === od.activeArtboard) ?? od.doc.artboards[0];
    if (ab) setView(fitRect({ x: ab.x, y: ab.y, width: ab.width, height: ab.height }, size.w, size.h, 56));
  }, [od, size]);

  const makeApi = useCallback((): ToolApi | null => {
    if (!overCanvas.current) return null;
    return createToolApi(overCanvas.current, overlay, () => schedule());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Rendering ---------------------------------------------------------------------------
  const render = useCallback(() => {
    frame.current = 0;
    const s = getState();
    const d = s.docs.find((x) => x.key === s.activeKey);
    const dc = docCanvas.current;
    const oc = overCanvas.current;
    if (!d || !d.view || !dc || !oc) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(dc.clientWidth * dpr);
    const H = Math.round(dc.clientHeight * dpr);
    for (const c of [dc, oc]) if (c.width !== W || c.height !== H) Object.assign(c, { width: W, height: H });
    const view = d.view;
    const ctx = dc.getContext('2d');
    const o = oc.getContext('2d');
    if (!ctx || !o) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = cssVar('--paste') || '#E7E5E0';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.panX, dpr * view.panY);
    const dark = isDarkTheme();
    const hidden = s.editingText ? new Set([s.editingText]) : undefined;
    const ui = s.ui;
    for (const ab of d.doc.artboards) {
      // Artboard shadow + background.
      ctx.save();
      ctx.shadowColor = dark ? 'rgba(0,0,0,.55)' : 'rgba(26,24,32,.14)';
      ctx.shadowBlur = 40 * dpr;
      ctx.shadowOffsetY = 18 * dpr;
      ctx.fillStyle = ab.background ? cssColor(ab.background, d.doc.swatches) : '#ffffff';
      ctx.fillRect(ab.x, ab.y, ab.width, ab.height);
      ctx.restore();
      if (!ab.background) drawChecker(ctx, ab.x, ab.y, ab.width, ab.height, view.zoom);
    }
    const opts = {
      pixelScale: view.zoom * dpr,
      hidden,
      onAsset: () => schedule(),
      outline: ui.outline,
      outlineColor: cssVar('--fg') || '#000',
    };
    for (const ab of d.doc.artboards) drawArtboardContent(ctx, d.doc, ab.id, opts, false);
    // Isolation: dim everything outside the isolated group.
    if (d.isolation) {
      const loc = locate(d.doc, d.isolation);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = cssVar('--paste') || '#E7E5E0';
      ctx.globalAlpha = 0.6;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      if (loc) {
        ctx.save();
        // Redraw the isolated group on top of the dimmed scene, in its parent's space.
        const m = multiply(
          [dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.panX, dpr * view.panY],
          parentWorldMatrix(loc),
        );
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        drawNode(ctx, loc.node, d.doc, opts);
        ctx.restore();
      }
    }
    // Document grid, then the pixel grid at high zoom.
    if (ui.showGrid) drawDocGrid(ctx, view, d.doc, dpr);
    if (ui.grid && view.zoom >= 6) drawPixelGrid(ctx, view, W, H, dpr);
    // Guides.
    if (ui.guides) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = 'rgba(22, 199, 91, 0.7)';
      ctx.lineWidth = 1;
      for (const ab of d.doc.artboards)
        for (const g of ab.guides) {
          ctx.beginPath();
          if (g.axis === 'x') {
            const x = Math.round(((ab.x + g.pos) * view.zoom + view.panX) * dpr) + 0.5;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
          } else {
            const y = Math.round(((ab.y + g.pos) * view.zoom + view.panY) * dpr) + 0.5;
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
          }
          ctx.stroke();
        }
      ctx.restore();
    }

    // Overlay layer (screen space, CSS pixels).
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, W, H);
    o.setTransform(dpr, 0, 0, dpr, 0, 0);
    const api = makeApi();
    if (api) {
      const t = activeToolImpl(s);
      try {
        t.overlay?.(o, api);
      } catch (err) {
        console.error('overlay', err);
      }
      if (overlay.guides.length) drawGuides(o, overlay.guides, view);
      if (overlay.marquee && (s.springTool ?? s.tool) !== 'zoom' && (s.springTool ?? s.tool) !== 'text')
        drawMarquee(o, overlay.marquee);
      if (overlay.hud) drawHud(o, overlay.hud.at, overlay.hud.lines);
    }
    const c = overlay.cursor ?? activeToolImpl(s).cursor ?? 'default';
    setCursor((prev) => (prev === c ? prev : c));
    // `schedule` is defined from `render`; it is read through the latest closure at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [makeApi]);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(render);
  }, [render]);

  useEffect(() => {
    renderRef = schedule;
    apiRef = makeApi;
    const unsub = useEditor.subscribe(() => schedule());
    const offFont = onFontLoaded(() => schedule());
    const offPk = onPathKitReady(() => schedule());
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', schedule);
    return () => {
      unsub();
      offFont();
      offPk();
      mq?.removeEventListener?.('change', schedule);
      renderRef = null;
      apiRef = null;
    };
  }, [schedule, makeApi]);

  useEffect(() => schedule(), [size, schedule]);

  // Switching tools cancels whatever the previous tool was doing.
  const prevTool = useRef(impl);
  useEffect(() => {
    if (prevTool.current !== impl) {
      const api = makeApi();
      if (api) prevTool.current.cancel?.(api);
      overlay.guides = [];
      overlay.hud = null;
      overlay.marquee = null;
      overlay.cursor = null;
      prevTool.current = impl;
      schedule();
    }
  }, [impl, makeApi, schedule]);

  // ---- Pointer -----------------------------------------------------------------------------
  const toPointer = (
    e: React.PointerEvent | PointerEvent,
    prev: ToolPointer | null,
    view: ViewState,
  ): ToolPointer => {
    const r = hostRef.current!.getBoundingClientRect();
    const screen: Vec = [e.clientX - r.left, e.clientY - r.top];
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const world = toWorld(view, screen);
    const pad = getInput();
    return {
      world,
      screen,
      shift: e.shiftKey || pad.shift,
      alt: e.altKey || pad.alt,
      mod: (mac ? e.metaKey : e.ctrlKey) || pad.mod,
      button: e.button,
      pressure: e.pressure || 0.5,
      dragging: prev?.dragging ?? false,
      downWorld: prev?.downWorld ?? world,
      downScreen: prev?.downScreen ?? screen,
      moved: prev?.moved ?? false,
      clickCount: (e as PointerEvent).detail || 1,
    };
  };

  /** Drop whatever the tool was doing (a second finger landed, or the system took the touch). */
  const abandon = () => {
    const api = makeApi();
    const tool = impl;
    if (pointer.current && api) (tool.abortPress ?? tool.cancel)?.call(tool, api);
    if (gestureActive()) cancelGesture();
    pointer.current = null;
    overlay.guides = [];
    overlay.hud = null;
    overlay.marquee = null;
    schedule();
  };

  const local = (e: React.PointerEvent): Vec => {
    const r = hostRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const startPinch = () => {
    const [a, b] = [...touches.current.values()];
    const view = makeApi()?.view;
    if (!view) return;
    pinch.current = {
      dist: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])),
      mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      view,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    setPointerType(e.pointerType);
    if (e.pointerType === 'touch' || e.pointerType === 'pen') markTouch();
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, local(e));
      if (touches.current.size >= 2) {
        // Two fingers navigate: pinch to zoom, drag to pan.
        abandon();
        for (const id of touches.current.keys()) ignored.current.add(id);
        if (touches.current.size === 2) startPinch();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        return;
      }
    }
    const api = makeApi();
    if (!api || getState().editingText) {
      if (getState().editingText) setState({ editingText: null });
      if (!api) return;
    }
    hostRef.current?.focus();
    // Middle button pans from any tool.
    if (e.button === 1 || (e.button === 0 && activeTool === 'hand')) {
      e.preventDefault();
      panning.current = { x: e.clientX, y: e.clientY, view: api.view };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setCursor('grabbing');
      return;
    }
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = toPointer(e, null, api.view);
    p.dragging = true;
    p.downWorld = p.world;
    p.downScreen = p.screen;
    pointer.current = p;
    const ab = artboardAt(api.doc, p.world);
    if (ab && ab.id !== api.od.activeArtboard && !api.od.isolation) setActiveArtboard(ab.id);
    try {
      activeToolImpl(getState()).down?.(p, makeApi()!);
    } catch (err) {
      console.error(err);
    }
    schedule();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, local(e));
      if (pinch.current && touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        const pn = pinch.current;
        const dist = Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1]));
        const mid: Vec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const z = zoomAt(pn.view, clampZoom((pn.view.zoom * dist) / pn.dist), pn.mid);
        setView({ ...z, panX: z.panX + mid[0] - pn.mid[0], panY: z.panY + mid[1] - pn.mid[1] });
        return;
      }
      if (ignored.current.has(e.pointerId)) return;
    }
    const api = makeApi();
    if (!api) return;
    if (panning.current) {
      const pn = panning.current;
      setView({
        zoom: pn.view.zoom,
        panX: pn.view.panX + e.clientX - pn.x,
        panY: pn.view.panY + e.clientY - pn.y,
      });
      return;
    }
    const prev = pointer.current;
    const p = toPointer(e, prev, api.view);
    if (prev) {
      if (!p.moved && Math.hypot(p.screen[0] - p.downScreen[0], p.screen[1] - p.downScreen[1]) > 3)
        p.moved = true;
      pointer.current = p;
    }
    window.dispatchEvent(new CustomEvent('curvesmith:cursor', { detail: p.world }));
    try {
      activeToolImpl(getState()).move?.(p, api);
    } catch (err) {
      console.error(err);
    }
    const c = overlay.cursor ?? impl.cursor ?? 'default';
    if (c !== cursor) setCursor(c);
  };

  const releaseTouch = (e: React.PointerEvent): boolean => {
    if (e.pointerType !== 'touch') return false;
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    if (ignored.current.delete(e.pointerId)) return true;
    return false;
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    releaseTouch(e);
    panning.current = null;
    abandon();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (releaseTouch(e)) return;
    if (panning.current) {
      panning.current = null;
      setCursor(overlay.cursor ?? impl.cursor ?? 'default');
      return;
    }
    const prev = pointer.current;
    pointer.current = null;
    const api = makeApi();
    if (!api || !prev) return;
    const p = toPointer(e, prev, api.view);
    p.dragging = false;
    try {
      activeToolImpl(getState()).up?.(p, api);
    } catch (err) {
      console.error(err);
    }
    // Double-tap with a finger or pen stands in for double-click.
    if (e.pointerType !== 'mouse' && !p.moved) {
      // Time the taps by when they happened, not when they were handled: a busy main thread (a big
      // re-render after the first tap) must not stretch the gap between them.
      const now = e.timeStamp || performance.now();
      const t = lastTap.current;
      if (t && now - t.t < DOUBLE_TAP_MS && Math.hypot(t.at[0] - p.screen[0], t.at[1] - p.screen[1]) < 24) {
        lastTap.current = null;
        syntheticDbl.current = performance.now();
        const next = makeApi();
        if (next) activeToolImpl(getState()).dblclick?.(toPointer(e, null, next.view), next);
      } else lastTap.current = { t: now, at: p.screen };
    }
    schedule();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // Already handled as a double-tap.
    if (performance.now() - syntheticDbl.current < 600) return;
    const api = makeApi();
    if (!api) return;
    const p = toPointer(e as unknown as PointerEvent, null, api.view);
    activeToolImpl(getState()).dblclick?.(p, api);
    schedule();
  };

  const onPointerLeave = () => {
    const api = makeApi();
    if (api) activeToolImpl(getState()).leave?.(api);
    if (overlay.hoverId) {
      overlay.hoverId = null;
      schedule();
    }
  };

  // Wheel: scroll pans, ⌘/Ctrl + wheel and pinch zoom.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = getState();
      const d = s.docs.find((x) => x.key === s.activeKey);
      if (!d?.view) return;
      const r = el.getBoundingClientRect();
      const at: Vec = [e.clientX - r.left, e.clientY - r.top];
      const lineScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp((-e.deltaY * lineScale) / (e.ctrlKey && !e.metaKey ? 100 : 300));
        setView(zoomAt(d.view, clampZoom(d.view.zoom * factor), at));
      } else {
        const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * lineScale;
        const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * lineScale;
        setView({ ...d.view, panX: d.view.panX - dx, panY: d.view.panY - dy });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    // Safari pinch gestures.
    let gestureStart = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStart = getState().docs.find((x) => x.key === getState().activeKey)?.view?.zoom ?? 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      // iOS also reports a two-finger pinch as pointers; that path already zooms.
      if (touches.current.size >= 2) return;
      const d = getState().docs.find((x) => x.key === getState().activeKey);
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      if (!d?.view) return;
      const r = el.getBoundingClientRect();
      setView(zoomAt(d.view, gestureStart * ge.scale, [ge.clientX - r.left, ge.clientY - r.top]));
    };
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, []);

  // Dropping files on the canvas places them into this document (.curvs files open in a new tab).
  const onDrop = (e: React.DragEvent) => {
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    const curvs = files.filter((f) => f.name.toLowerCase().endsWith('.curvs'));
    const rest = files.filter((f) => !f.name.toLowerCase().endsWith('.curvs'));
    curvs.forEach((f) => void openFile(f));
    if (rest.length) void placeFiles(rest);
  };

  if (!od) return null;
  const view = od.view;

  return (
    <div className={`canvas-wrap ${ui.rulers ? '' : 'no-rulers'}`}>
      {ui.rulers ? (
        <>
          <div className="ruler-corner" />
          <Rulers od={od} size={size} />
        </>
      ) : (
        <>
          <div />
          <div />
          <div />
        </>
      )}
      <div
        ref={hostRef}
        className="canvas-host"
        data-canvas-host
        tabIndex={-1}
        aria-label="Canvas"
        role="application"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <canvas ref={docCanvas} data-layer="doc" />
        <canvas ref={overCanvas} data-layer="overlay" />
        {view &&
          od.doc.artboards.map((ab) => {
            const p = toScreen(view, [ab.x, ab.y]);
            return (
              <ArtboardLabel
                key={ab.id}
                id={ab.id}
                name={ab.name}
                x={p[0]}
                y={p[1]}
                active={ab.id === od.activeArtboard}
              />
            );
          })}
        {od.isolation && (
          <div className="isolation-banner" onPointerDown={(e) => e.stopPropagation()}>
            Editing {locate(od.doc, od.isolation)?.node.name ?? 'group'}
            <button
              className="btn btn-ghost"
              style={{ height: 24, padding: '0 8px' }}
              onClick={() => setIsolation(null)}
            >
              <Icon name="check" size={14} /> Done
            </button>
          </div>
        )}
        {editingText && view && <TextEditor od={od} id={editingText} view={view} />}
      </div>
      <TouchBar />
    </div>
  );
}

function ArtboardLabel({
  id,
  name,
  x,
  y,
  active,
}: {
  id: string;
  name: string;
  x: number;
  y: number;
  active: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div
      className={`artboard-label ${active ? 'active' : ''}`}
      style={{ left: x, top: y }}
      onPointerDown={(e) => {
        e.stopPropagation();
        setActiveArtboard(id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {editing ? (
        <input
          autoFocus
          defaultValue={name}
          aria-label="Artboard name"
          className="text-input"
          style={{ height: 22, width: 160 }}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== name)
              mutate('Rename artboard', (d) => void (d.artboards.find((a) => a.id === id)!.name = v));
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        name
      )}
    </div>
  );
}

function drawChecker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  zoom: number,
) {
  const s = 8 / zoom;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#e6e3dd';
  for (let yy = 0; yy * s < h; yy++)
    for (let xx = yy % 2; xx * s < w; xx += 2) ctx.fillRect(x + xx * s, y + yy * s, s, s);
  ctx.restore();
}

/** Smallest on-screen gap (CSS px) at which grid lines are still drawn. */
const MIN_GRID_GAP = 6;

function drawDocGrid(ctx: CanvasRenderingContext2D, view: ViewState, doc: CurvsDocument, dpr: number) {
  const g = gridOf(doc);
  const minor = gridStep(g);
  // Thin out when zoomed far out: skip subdivisions, then use every 2nd, 4th… major line.
  let major = g.spacing;
  while (major * view.zoom < MIN_GRID_GAP) major *= 2;
  const showMinor = g.subdivisions > 1 && minor * view.zoom >= MIN_GRID_GAP;
  const dev = (v: number, pan: number) => Math.round((v * view.zoom + pan) * dpr) + 0.5;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const ab of doc.artboards) {
    const x0 = dev(ab.x, view.panX) - 0.5;
    const y0 = dev(ab.y, view.panY) - 0.5;
    const x1 = dev(ab.x + ab.width, view.panX) - 0.5;
    const y1 = dev(ab.y + ab.height, view.panY) - 0.5;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();
    const lines = (step: number) => ({
      xs: gridPositions(ab.width, step).map((v) => dev(ab.x + v, view.panX)),
      ys: gridPositions(ab.height, step).map((v) => dev(ab.y + v, view.panY)),
    });
    const draw = (step: number, color: string) => {
      const { xs, ys } = lines(step);
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      if (g.style === 'dots') {
        const r = Math.max(1, dpr);
        for (const x of xs) for (const y of ys) ctx.fillRect(x - r, y - r, r * 2, r * 2);
        return;
      }
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const x of xs) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      for (const y of ys) {
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      }
      ctx.stroke();
    };
    if (showMinor) draw(minor, GRID_MINOR);
    draw(major, GRID_MAJOR);
    ctx.restore();
  }
  ctx.restore();
}

const GRID_MAJOR = 'rgba(43, 95, 107, 0.32)';
const GRID_MINOR = 'rgba(43, 95, 107, 0.13)';

function drawPixelGrid(ctx: CanvasRenderingContext2D, view: ViewState, W: number, H: number, dpr: number) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.25)';
  ctx.lineWidth = 1;
  const a = toWorld(view, [0, 0]);
  const b = toWorld(view, [W / dpr, H / dpr]);
  ctx.beginPath();
  for (let x = Math.floor(a[0]); x <= b[0]; x++) {
    const sx = Math.round((x * view.zoom + view.panX) * dpr) + 0.5;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, H);
  }
  for (let y = Math.floor(a[1]); y <= b[1]; y++) {
    const sy = Math.round((y * view.zoom + view.panY) * dpr) + 0.5;
    ctx.moveTo(0, sy);
    ctx.lineTo(W, sy);
  }
  ctx.stroke();
  ctx.restore();
}

import * as D from '@radix-ui/react-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { locate } from '../../core/document';
import { toPathData } from '../../core/geometry/pathdata';
import type { ImageNode } from '../../core/types';
import { closeDialog, getState, useActiveDoc, useEditor } from '../../state/store';
import { lsGet, lsSet } from '../../state/storage';
import { placeTrace } from '../../state/trace';
import { trace, stopTrace } from '../../trace/client';
import {
  applyMask,
  fitPixels,
  hasTransparency,
  imagePixels,
  traceToGroup,
  TRACE_MAX_PIXELS,
} from '../../trace/nodes';
import { TRACE_PRESETS, tracePreset, type TracePresetId } from '../../trace/presets';
import type { Pixels, TraceOptions, TraceResult } from '../../trace/types';
import { NumberField } from '../controls/NumberField';
import { Segmented } from '../controls/Segmented';
import { Tip } from '../controls/Tooltip';
import { Icon, type IconName } from '../icons';
import './trace.css';

type Saved = { preset: TracePresetId | 'custom'; options: TraceOptions; keepImage: boolean };
type View = 'result' | 'original' | 'outline';

const PREFS_KEY = 'cs.trace';
/** Native pixels loaded for upscaling and the AI steps. */
const SOURCE_MAX_PIXELS = 16_000_000;
/** Upscaling only pays off while the result still fits the trace budget. */
const UPSCALE_MAX_PIXELS = TRACE_MAX_PIXELS / 4;
const COLOR_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64];

const defaults = (): Saved => ({
  preset: 'illustration',
  options: tracePreset('illustration').options,
  keepImage: false,
});

type AiState = { removeBg: boolean; upscale: boolean };
type Stage = { label: string; progress: number } | null;

const ai = () => import('../../ai');

export function TraceDialog() {
  const od = useActiveDoc();
  const imageId = useEditor((s) => s.dialogArg as string | null);
  const image = useMemo(() => {
    const n = od && imageId ? locate(od.doc, imageId)?.node : null;
    return n?.type === 'image' ? (n as ImageNode) : null;
  }, [od, imageId]);
  const src = image && od ? od.doc.assets[image.asset] : undefined;

  const [saved, setSaved] = useState<Saved>(() => ({
    ...defaults(),
    ...lsGet<Partial<Saved>>(PREFS_KEY, {}),
  }));
  const { options, preset, keepImage } = saved;
  const [aiState, setAiState] = useState<AiState>({ removeBg: false, upscale: false });
  const [view, setView] = useState<View>('result');
  const [native, setNative] = useState<Pixels | null>(null);
  const [prepared, setPrepared] = useState<Pixels | null>(null);
  const [result, setResult] = useState<{ r: TraceResult; for: string } | null>(null);
  const [stage, setStage] = useState<Stage>(null);
  const [applying, setApplying] = useState(false);
  const [aiInfo, setAiInfo] = useState<{ bg: string; up: string; upOk: boolean } | null>(null);
  const prepCache = useRef(new Map<string, Promise<Pixels>>());

  useEffect(() => lsSet(PREFS_KEY, saved), [saved]);

  // Decode the image once.
  useEffect(() => {
    if (!src) return;
    let live = true;
    imagePixels(src, image?.crop, SOURCE_MAX_PIXELS)
      .then((px) => live && setNative(px))
      .catch(() => {
        toast.error('This image could not be read.');
        closeDialog();
      });
    return () => {
      live = false;
    };
  }, [src, image?.crop]);

  // Model sizes and whether upscaling suits this image.
  useEffect(() => {
    if (!native) return;
    let live = true;
    void ai().then(async (m) => {
      if (!m.aiSupported()) return;
      const [bgReady, upReady, backend] = await Promise.all([
        m.isModelReady('background'),
        m.isModelReady('upscale'),
        m.probeBackend(),
      ]);
      const n = native.width * native.height;
      const engine = backend === 'webgpu' ? m.ENGINE_WEBGPU_BYTES : m.ENGINE_WASM_BYTES;
      if (!live) return;
      setAiInfo({
        bg: bgReady ? 'Ready' : `${m.formatBytes(m.AI_MODELS.background.bytes + m.ENGINE_WASM_BYTES)} once`,
        up: upReady ? 'Ready' : `${m.formatBytes(m.AI_MODELS.upscale.bytes + engine)} once`,
        upOk: n <= UPSCALE_MAX_PIXELS && n <= m.maxUpscaleInput(backend, n * 16 <= TRACE_MAX_PIXELS ? 4 : 2),
      });
    });
    return () => {
      live = false;
    };
  }, [native]);

  // Pixels to trace: optional upscale, fit to budget, optional background removal. Cached per combination.
  const prepare = useCallback(
    (state: AiState): Promise<Pixels> => {
      const key = `${state.upscale}|${state.removeBg}`;
      let p = prepCache.current.get(key);
      if (!p && native) {
        p = (async () => {
          let px: Pixels = native;
          if (state.upscale) {
            const m = await ai();
            setStage({ label: 'Upscaling', progress: 0 });
            const factor = px.width * px.height * 16 <= TRACE_MAX_PIXELS ? 4 : 2;
            const out = await m.upscale(new ImageData(px.data.slice(), px.width, px.height), factor, {
              onProgress: (v) => setStage({ label: 'Upscaling', progress: v }),
            });
            px = out.image;
          }
          px = fitPixels(px);
          if (state.removeBg) {
            const m = await ai();
            setStage({ label: 'Removing background', progress: 0 });
            const mask = await m.removeBackground(new ImageData(px.data.slice(), px.width, px.height), {
              onProgress: (v) => setStage({ label: 'Removing background', progress: v }),
            });
            px = applyMask(px, mask);
          }
          return px;
        })();
        prepCache.current.set(key, p);
        p.catch(() => prepCache.current.delete(key));
      }
      return p ?? Promise.reject(new Error('The image is still loading.'));
    },
    [native],
  );

  useEffect(() => {
    if (!native) return;
    let live = true;
    prepare(aiState)
      .then((px) => live && setPrepared(px))
      .catch((e: Error) => {
        if (!live) return;
        setStage(null);
        if (e.name !== 'AbortError') toast.error(e.message);
        setAiState((s) => ({ ...s, removeBg: false, upscale: false }));
      });
    return () => {
      live = false;
    };
  }, [native, aiState, prepare]);

  // Live preview, debounced; a newer trace replaces a running one.
  const key = useMemo(() => JSON.stringify(options), [options]);
  useEffect(() => {
    if (!prepared) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setStage({ label: 'Tracing', progress: 0 });
      trace(prepared, options, {
        signal: ctrl.signal,
        onProgress: (p) => setStage({ label: 'Tracing', progress: p }),
      })
        .then((r) => {
          setResult({ r, for: key });
          setStage(null);
        })
        .catch((e: Error) => {
          if (e.name === 'AbortError') return;
          setStage(null);
          toast.error(e.message);
        });
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `options`
  }, [prepared, key]);

  useEffect(
    () => () => {
      stopTrace();
      void ai().then((m) => m.disposeAi());
    },
    [],
  );

  const set = (patch: Partial<TraceOptions>) =>
    setSaved((s) => ({ ...s, preset: 'custom', options: { ...s.options, ...patch } }));
  const choosePreset = (id: TracePresetId) =>
    setSaved((s) => ({ ...s, preset: id, options: tracePreset(id).options }));

  const ready = result && result.for === key && prepared;
  const apply = async () => {
    if (!image || !prepared) return;
    setApplying(true);
    try {
      const r = ready ? result.r : await trace(prepared, options);
      if (!r.layers.length) {
        toast.error('Nothing to trace with these settings.');
        return;
      }
      const latest = locate(activeDocOrThrow(), image.id)?.node as ImageNode | undefined;
      if (!latest) return;
      placeTrace(image.id, traceToGroup(r, latest), keepImage);
      closeDialog();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  if (!image || !src) return null;
  const stats = result?.r;
  const subpaths = stats?.layers.reduce((n, l) => n + l.subpaths.length, 0) ?? 0;
  const opaque = native ? !hasTransparency(native) : false;

  return (
    <D.Root open onOpenChange={(o) => !o && closeDialog()}>
      <D.Portal>
        <D.Overlay className="dialog-overlay" />
        <D.Content
          className="dialog trace-dialog"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (document.querySelector('.trace-dialog .btn-primary') as HTMLElement | null)?.focus();
          }}
        >
          <div className="dialog-head">
            <D.Title className="dialog-title">Trace image</D.Title>
            <D.Close asChild>
              <button className="icon-btn" aria-label="Close" style={{ marginLeft: 'auto' }}>
                <Icon name="close" />
              </button>
            </D.Close>
          </div>
          <div className="trace-body">
            <div className="trace-stage">
              <TracePreview pixels={prepared ?? native} result={stats ?? null} view={view} />
              <div className="trace-views" role="radiogroup" aria-label="Preview">
                {(
                  [
                    ['result', 'Result', 'shapes'],
                    ['outline', 'Outlines', 'path'],
                    ['original', 'Original', 'image'],
                  ] as [View, string, IconName][]
                ).map(([v, label, icon]) => (
                  <Tip key={v} label={label}>
                    <button
                      className="icon-btn"
                      role="radio"
                      aria-checked={view === v}
                      aria-label={label}
                      onClick={() => setView(v)}
                    >
                      <Icon name={icon} />
                    </button>
                  </Tip>
                ))}
              </div>
              {stage && (
                <div className="trace-progress" role="status">
                  <span>{stage.label}</span>
                  <div className="trace-bar">
                    <div style={{ width: `${Math.round(stage.progress * 100)}%` }} />
                  </div>
                </div>
              )}
              {stats && (
                <div className="trace-stats mono" data-testid="trace-stats">
                  {plural(stats.layers.length, 'color')} · {plural(subpaths, 'shape')} ·{' '}
                  {plural(stats.nodes, 'node')}
                </div>
              )}
            </div>
            <div className="trace-options">
              <div className="trace-presets" role="radiogroup" aria-label="Presets">
                {TRACE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    role="radio"
                    aria-checked={preset === p.id}
                    className="trace-preset"
                    onClick={() => choosePreset(p.id)}
                    data-preset={p.id}
                  >
                    <PresetGlyph id={p.id} />
                    {p.label}
                  </button>
                ))}
              </div>
              <Segmented<TraceOptions['mode']>
                label="Mode"
                value={options.mode}
                onChange={(mode) => set({ mode })}
                options={[
                  { value: 'color', label: 'Color' },
                  { value: 'gray', label: 'Gray' },
                  { value: 'bw', label: 'B&W' },
                ]}
              />
              {options.mode === 'bw' ? (
                <div className="trace-row">
                  <NumberField
                    className="wide-label"
                    label="Threshold"
                    ariaLabel="Threshold"
                    value={options.threshold < 0 ? null : Math.min(255, options.threshold)}
                    placeholder="Auto"
                    decimals={0}
                    min={0}
                    max={255}
                    options={[64, 96, 128, 160, 192, 224, 255]}
                    onChange={(threshold) => set({ threshold })}
                  />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={options.threshold < 0}
                      onChange={(e) => set({ threshold: e.target.checked ? -1 : 128 })}
                    />
                    Auto
                  </label>
                </div>
              ) : (
                <NumberField
                  className="wide-label"
                  label="Colors"
                  ariaLabel="Colors"
                  value={options.colors}
                  decimals={0}
                  min={2}
                  max={64}
                  options={COLOR_OPTIONS}
                  onChange={(colors) => set({ colors: Math.round(colors) })}
                />
              )}
              <NumberField
                className="wide-label"
                label="Smoothness"
                ariaLabel="Smoothness"
                unit="%"
                value={options.smoothness}
                decimals={0}
                min={0}
                max={100}
                step={10}
                onChange={(smoothness) => set({ smoothness })}
              />
              <NumberField
                className="wide-label"
                label="Corners"
                ariaLabel="Corners"
                unit="%"
                value={options.corners}
                decimals={0}
                min={0}
                max={100}
                step={10}
                onChange={(corners) => set({ corners })}
              />
              <NumberField
                className="wide-label"
                label="Ignore specks under"
                ariaLabel="Ignore specks under"
                unit="px"
                value={options.speckle}
                decimals={0}
                min={0}
                max={400}
                options={[0, 2, 5, 10, 20, 30, 50, 100, 200, 400]}
                onChange={(speckle) => set({ speckle: Math.round(speckle) })}
              />
              <NumberField
                className="wide-label"
                label="Denoise"
                ariaLabel="Denoise"
                value={options.denoise}
                decimals={0}
                min={0}
                max={3}
                onChange={(denoise) => set({ denoise: Math.round(denoise) })}
              />
              {options.mode !== 'bw' && (
                <>
                  <Check
                    label="Stack layers"
                    value={options.stacked}
                    onChange={(stacked) => set({ stacked })}
                  />
                  <Check
                    label="Drop background color"
                    value={options.ignoreBackground}
                    onChange={(ignoreBackground) => set({ ignoreBackground })}
                  />
                </>
              )}
              <Check
                label="Keep image underneath"
                value={keepImage}
                onChange={(v) => setSaved((s) => ({ ...s, keepImage: v }))}
              />
              {aiInfo && (
                <div className="trace-ai">
                  <div className="trace-ai-head">
                    <Icon name="sparkle" size={14} /> On-device AI
                  </div>
                  <AiToggle
                    label="Remove background"
                    note={aiInfo.bg}
                    value={aiState.removeBg}
                    disabled={!!stage && stage.label !== 'Tracing'}
                    onChange={(removeBg) => setAiState((s) => ({ ...s, removeBg }))}
                  />
                  <AiToggle
                    label="Upscale first"
                    note={aiInfo.upOk ? aiInfo.up : 'Image is large enough'}
                    value={aiState.upscale}
                    disabled={!aiInfo.upOk || (!!stage && stage.label !== 'Tracing')}
                    onChange={(upscale) => setAiState((s) => ({ ...s, upscale }))}
                  />
                  {preset === 'silhouette' && opaque && !aiState.removeBg && (
                    <div className="trace-hint">
                      Silhouettes need a cut-out subject: turn on Remove background.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="dialog-foot">
            <button className="btn" onClick={closeDialog}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void apply()}
              disabled={applying || !prepared}
              data-action="trace-apply"
            >
              <Icon name="wand" size={15} stroke={2} /> Trace
            </button>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

function activeDocOrThrow() {
  const s = getState();
  const od = s.docs.find((d) => d.key === s.activeKey);
  if (!od) throw new Error('No open document.');
  return od.doc;
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function AiToggle(p: {
  label: string;
  note: string;
  value: boolean;
  disabled?: boolean;
  onChange(v: boolean): void;
}) {
  return (
    <label className={`check trace-ai-row ${p.disabled ? 'disabled' : ''}`}>
      <input
        type="checkbox"
        checked={p.value}
        disabled={p.disabled}
        onChange={(e) => p.onChange(e.target.checked)}
      />
      <span>{p.label}</span>
      <span className="muted mono">{p.note}</span>
    </label>
  );
}

/** Tiny pictures of what each preset makes. */
function PresetGlyph({ id }: { id: TracePresetId }) {
  const g: Record<TracePresetId, React.ReactNode> = {
    logo: (
      <>
        <circle cx="9" cy="12" r="5" fill="var(--cs-volt)" />
        <rect x="12" y="7" width="8" height="10" rx="1" fill="currentColor" opacity=".7" />
      </>
    ),
    illustration: (
      <>
        <path d="M3 18c3-7 6-9 9-5s5 3 9-4v11H3z" fill="currentColor" opacity=".45" />
        <circle cx="16" cy="7" r="3" fill="var(--cs-volt)" />
      </>
    ),
    photo: (
      <>
        <path d="M3 20l6-8 4 5 3-3 5 6z" fill="currentColor" opacity=".7" />
        <path d="M3 4h18v16H3z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </>
    ),
    gray: (
      <>
        <rect x="3" y="5" width="6" height="14" fill="currentColor" opacity=".2" />
        <rect x="9" y="5" width="6" height="14" fill="currentColor" opacity=".5" />
        <rect x="15" y="5" width="6" height="14" fill="currentColor" opacity=".85" />
      </>
    ),
    lineart: (
      <path
        d="M4 17c4-9 7 2 10-6s4 0 6-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    ),
    silhouette: (
      <path d="M12 3a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm-6 18c0-5 2.5-9 6-9s6 4 6 9z" fill="currentColor" />
    ),
  };
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      {g[id]}
    </svg>
  );
}

/** Canvas preview of the source pixels, the traced result, or its outlines over a faded source. */
function TracePreview({
  pixels,
  result,
  view,
}: {
  pixels: Pixels | null;
  result: TraceResult | null;
  view: View;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const paths = useMemo(
    () =>
      (typeof Path2D === 'function' ? result?.layers : undefined)?.map((l) => ({
        color: `rgb(${Math.round(l.color.r * 255)},${Math.round(l.color.g * 255)},${Math.round(l.color.b * 255)})`,
        path: new Path2D(toPathData(l.subpaths, 2)),
      })) ?? [],
    [result],
  );
  const bitmap = useMemo(() => {
    if (!pixels) return null;
    const c = document.createElement('canvas');
    c.width = pixels.width;
    c.height = pixels.height;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
    return c;
  }, [pixels]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const w = result?.width ?? pixels?.width;
    const h = result?.height ?? pixels?.height;
    if (!w || !h) return;
    const pad = 24;
    const s = Math.min((size.w - pad * 2) / w, (size.h - pad * 2) / h);
    const ox = (size.w - w * s) / 2;
    const oy = (size.h - h * s) / 2;
    ctx.setTransform(s * dpr, 0, 0, s * dpr, ox * dpr, oy * dpr);
    if (view !== 'result' || !result) {
      if (bitmap) {
        ctx.globalAlpha = view === 'outline' && result ? 0.35 : 1;
        ctx.drawImage(bitmap, 0, 0, w, h);
        ctx.globalAlpha = 1;
      }
      if (view === 'outline' && result) {
        const accent = getComputedStyle(c).getPropertyValue('--accent').trim() || '#0a84ff';
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1 / s;
        for (const p of paths) ctx.stroke(p.path);
      }
      return;
    }
    for (const p of paths) {
      ctx.fillStyle = p.color;
      ctx.fill(p.path, 'evenodd');
    }
  }, [size, paths, bitmap, view, result, pixels]);

  return (
    <div className="trace-preview" ref={host}>
      <canvas ref={canvas} style={{ width: size.w, height: size.h }} aria-label="Trace preview" role="img" />
    </div>
  );
}

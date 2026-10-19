import * as D from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { activeDoc, closeDialog, useActiveDoc } from '../../state/store';
import {
  exportFormats,
  estimateSize,
  formatBytes,
  GROUP_LABELS,
  PDF_COMPATIBILITY,
  type FormatDescriptor,
} from '../../formats/registry';
import { artworkIds, runExport, scopeFor, type ScopeKind } from '../../state/io';
import { renderToCanvas, scopeBounds } from '../../render/raster';
import { Icon } from '../icons';
import { NumberField } from '../controls/NumberField';
import { Segmented } from '../controls/Segmented';
import type { FormatGroup } from '../../formats/types';
import './export.css';

type Opts = Record<string, unknown>;

function Check({ label, value, onChange }: { label: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Options({
  f,
  opts,
  set,
  size,
}: {
  f: FormatDescriptor;
  opts: Opts;
  set(patch: Opts): void;
  size: { w: number; h: number };
}) {
  const o = opts as Record<string, never>;
  if (f.id === 'svg')
    return (
      <>
        <div className="opt-label">Text</div>
        <Segmented
          label="Text"
          value={o.text ?? 'keep'}
          onChange={(v) => set({ text: v })}
          options={[
            { value: 'keep', label: 'Keep as text' },
            { value: 'outlines', label: 'Convert to outlines' },
          ]}
        />
        <div className="opt-label">Styling</div>
        <Segmented
          label="Styling"
          value={o.styling ?? 'attributes'}
          onChange={(v) => set({ styling: v })}
          options={[
            { value: 'attributes', label: 'Attributes' },
            { value: 'inline', label: 'Inline CSS' },
            { value: 'classes', label: 'Classes' },
          ]}
        />
        <NumberField
          label="Decimal places"
          ariaLabel="Decimal places"
          value={Number(o.decimals ?? 2)}
          decimals={0}
          min={0}
          max={6}
          onChange={(v) => set({ decimals: Math.round(v) })}
          className="wide-label"
        />
        <Check label="Minify output" value={!!o.minify} onChange={(v) => set({ minify: v })} />
        <Check
          label="Responsive (viewBox only)"
          value={!!o.responsive}
          onChange={(v) => set({ responsive: v })}
        />
        <Check
          label="Include artboard background"
          value={!!o.background}
          onChange={(v) => set({ background: v })}
        />
        <Check label="Use layer names as IDs" value={!!o.layerIds} onChange={(v) => set({ layerIds: v })} />
      </>
    );
  if (f.id === 'pdf' || f.id === 'ai')
    return (
      <>
        <label className="field wide-label">
          <span className="label">Compatibility</span>
          <select
            aria-label="Compatibility"
            value={o.compatibility ?? 'PDF 1.7'}
            onChange={(e) => set({ compatibility: e.target.value })}
            style={{ textAlign: 'right' }}
          >
            {PDF_COMPATIBILITY.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <Check label="Embed fonts" value={!!o.embedFonts} onChange={(v) => set({ embedFonts: v })} />
        <Check
          label="Keep layers and editability"
          value={!!o.keepLayers}
          onChange={(v) => set({ keepLayers: v })}
        />
        <Check label="Add 3 mm bleed" value={!!o.bleed} onChange={(v) => set({ bleed: v })} />
        <Check label="Crop marks" value={!!o.cropMarks} onChange={(v) => set({ cropMarks: v })} />
      </>
    );
  if (f.id === 'eps')
    return (
      <>
        <Check label="Add 3 mm bleed" value={!!o.bleed} onChange={(v) => set({ bleed: v })} />
        <Check label="Crop marks" value={!!o.cropMarks} onChange={(v) => set({ cropMarks: v })} />
      </>
    );
  if (f.id === 'dxf')
    return (
      <>
        <div className="opt-label">Units</div>
        <Segmented
          label="Units"
          value={o.units ?? 'mm'}
          onChange={(v) => set({ units: v })}
          options={[
            { value: 'mm', label: 'mm' },
            { value: 'in', label: 'in' },
            { value: 'px', label: 'px' },
          ]}
        />
        <NumberField
          label="Curve tolerance"
          ariaLabel="Curve tolerance"
          value={Number(o.tolerance ?? 0.1)}
          decimals={2}
          step={0.05}
          min={0.01}
          onChange={(v) => set({ tolerance: v })}
          className="wide-label"
        />
      </>
    );
  if (f.group === 'raster') {
    const scale = Number(o.scale ?? 1);
    const custom = ![1, 2, 3].includes(scale) || o.width !== undefined;
    const w = Math.round(Number(o.width) || size.w * scale);
    const h = Math.round(o.width ? (size.h * Number(o.width)) / size.w : size.h * scale);
    return (
      <>
        <div className="opt-label">Scale</div>
        <div className="scale-btns">
          {[1, 2, 3].map((s) => (
            <button
              key={s}
              className="small-btn"
              aria-pressed={!custom && scale === s}
              onClick={() => set({ scale: s, width: undefined, height: undefined })}
            >
              {s}×
            </button>
          ))}
          <button
            className="small-btn"
            aria-pressed={custom}
            onClick={() => set({ scale: 1.5, width: undefined })}
          >
            Custom
          </button>
        </div>
        <div className="grid2">
          <NumberField
            label="W"
            ariaLabel="Width in pixels"
            value={w}
            unit="px"
            decimals={0}
            min={1}
            onChange={(v) => set({ width: Math.round(v), scale: v / size.w })}
          />
          <NumberField
            label="H"
            ariaLabel="Height in pixels"
            value={h}
            unit="px"
            decimals={0}
            min={1}
            onChange={(v) => set({ width: Math.round((v / size.h) * size.w), scale: v / size.h })}
          />
        </div>
        {f.id !== 'png' && (
          <>
            <div className="opt-label row" style={{ justifyContent: 'space-between' }}>
              Quality <span className="mono">{Number(o.quality ?? 90)}</span>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              value={Number(o.quality ?? 90)}
              onChange={(e) => set({ quality: Number(e.target.value) })}
              aria-label="Quality"
              className="range"
            />
          </>
        )}
        {f.id !== 'jpg' && (
          <Check
            label="Transparent background"
            value={!!o.transparent}
            onChange={(v) => set({ transparent: v })}
          />
        )}
        <Check label="Anti-alias" value={o.antialias !== false} onChange={(v) => set({ antialias: v })} />
      </>
    );
  }
  if (f.id === 'curvs')
    return (
      <p className="muted" style={{ margin: 0 }}>
        Everything is kept: artboards, live shapes, appearance stacks, symbols, global colors and embedded
        images.
      </p>
    );
  return null;
}

function Preview({ kind, format }: { kind: ScopeKind; format: FormatDescriptor }) {
  const od = useActiveDoc();
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!od) return;
    let alive = true;
    const scope = scopeFor(kind);
    const area = scopeBounds(od.doc, scope, od.activeArtboard);
    const box = ref.current?.getBoundingClientRect();
    const maxW = (box?.width ?? 400) - 64;
    const maxH = (box?.height ?? 440) - 64;
    const scale = Math.min(maxW / area.rect.width, maxH / area.rect.height) * (window.devicePixelRatio || 1);
    const transparent = format.id === 'jpg' ? false : format.group !== 'raster' ? false : true;
    try {
      const c = renderToCanvas(
        od.doc,
        area,
        scope.kind === 'all' ? { kind: 'artboard', id: od.activeArtboard } : scope,
        { scale, transparent, antialias: true },
      );
      const finish = (b: Blob | null) =>
        alive && b && setUrl((old) => (old && URL.revokeObjectURL(old), URL.createObjectURL(b)));
      if ('convertToBlob' in c) void c.convertToBlob().then(finish);
      else (c as HTMLCanvasElement).toBlob(finish);
    } catch {
      setUrl(null);
    }
    return () => {
      alive = false;
    };
  }, [od, kind, format]);
  return (
    <div className="export-preview" ref={ref}>
      {url ? (
        <img src={url} alt="Export preview" className={format.id === 'dxf' ? 'outline' : ''} />
      ) : (
        <Icon name="image" size={28} />
      )}
    </div>
  );
}

export function ExportDialog() {
  const od = useActiveDoc();
  const formats = exportFormats();
  const initialFormat = od?.lastExport?.format ?? 'svg';
  const [fid, setFid] = useState(initialFormat);
  const [kind, setKind] = useState<ScopeKind>(() => {
    const last = od?.lastExport?.scope;
    if (last && (last !== 'artwork' || artworkIds().length)) return last;
    return od?.selection.length ? 'selection' : 'artboard';
  });
  const [name, setName] = useState(od?.lastExport?.name ?? od?.name ?? 'Untitled');
  const [busy, setBusy] = useState(false);
  const f = formats.find((x) => x.id === fid) ?? formats[0];
  const [all, setAll] = useState<Record<string, Opts>>(() => {
    const o: Record<string, Opts> = {};
    for (const x of formats) o[x.id] = { ...(x.defaults ?? {}), ...(od?.exportSettings[x.id] ?? {}) };
    return o;
  });
  const opts = all[f.id];
  const set = (patch: Opts) => setAll({ ...all, [f.id]: { ...opts, ...patch } });
  const groups = useMemo(() => {
    const g: Record<FormatGroup, FormatDescriptor[]> = { native: [], vector: [], raster: [] };
    for (const x of formats) g[x.group].push(x);
    return g;
  }, [formats]);
  if (!od) return null;
  const scope = scopeFor(kind);
  const area = scopeBounds(od.doc, scope, od.activeArtboard);
  const est = estimateSize(f.id, od.doc, scope, opts, od.activeArtboard);
  const label = f.id === 'curvs' ? '.curvs' : f.label;
  const doExport = async () => {
    setBusy(true);
    const ok = await runExport(f.id, kind, opts, name.trim() || 'Untitled');
    setBusy(false);
    if (ok) closeDialog();
  };
  return (
    <D.Root open onOpenChange={(o) => !o && closeDialog()}>
      <D.Portal>
        <D.Overlay className="dialog-overlay" />
        <D.Content
          className="dialog export-dialog"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (document.querySelector('.export-dialog .btn-primary') as HTMLElement | null)?.focus();
          }}
        >
          <div className="dialog-head">
            <D.Title className="dialog-title">Export</D.Title>
            <Segmented<ScopeKind>
              label="Scope"
              value={kind}
              onChange={setKind}
              options={[
                ...(activeDoc()?.selection.length
                  ? [{ value: 'selection' as const, label: 'Selection' }]
                  : []),
                ...(artworkIds().length ? [{ value: 'artwork' as const, label: 'Artwork only' }] : []),
                { value: 'artboard', label: 'This artboard' },
                { value: 'all', label: `All artboards (${od.doc.artboards.length})` },
              ]}
            />
            <D.Close asChild>
              <button className="icon-btn" aria-label="Close" style={{ marginLeft: 'auto' }}>
                <Icon name="close" />
              </button>
            </D.Close>
          </div>
          <div className="export-body">
            <nav className="export-formats" aria-label="Formats">
              {(['native', 'vector', 'raster'] as const).map((g) => (
                <div key={g}>
                  <div className="fmt-group">{GROUP_LABELS[g]}</div>
                  {groups[g].map((x) => (
                    <button
                      key={x.id}
                      className="fmt-item"
                      aria-pressed={x.id === f.id}
                      onClick={() => setFid(x.id)}
                    >
                      <span className="mono fmt-id">{x.id === 'curvs' ? '.curvs' : x.label}</span>
                      <span className="fmt-desc">{x.descriptor}</span>
                    </button>
                  ))}
                </div>
              ))}
            </nav>
            <Preview kind={kind} format={f} />
            <div className="export-options">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3>{label} options</h3>
                <span className="mono muted" style={{ fontSize: 11 }}>
                  .{f.extensions[0]}
                </span>
              </div>
              <Options f={f} opts={opts} set={set} size={{ w: area.rect.width, h: area.rect.height }} />
              <div style={{ flex: 1 }} />
              <div className="export-note">
                {f.note ??
                  'Export presets remember these settings per format. Re-export in one click from File › Export again.'}
              </div>
            </div>
          </div>
          <div className="dialog-foot export-foot">
            <label className="field export-name">
              <input
                aria-label="File name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ fontFamily: 'var(--font-ui)', fontSize: 13 }}
              />
              <span className="mono muted">.{f.extensions[0]}</span>
            </label>
            <span className="mono muted" style={{ fontSize: 12 }}>
              ≈ {formatBytes(est)}
            </span>
            <div style={{ flex: 1 }} />
            <button className="btn" onClick={closeDialog}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => void doExport()} disabled={busy}>
              <Icon name="download" size={15} stroke={2} /> Export {label === '.curvs' ? '.curvs' : label}
            </button>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

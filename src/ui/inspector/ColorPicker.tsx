import { clone } from '../../core/document';
import * as P from '@radix-ui/react-popover';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Color, SrgbColor, Swatch } from '../../core/types';
import {
  colorToHex,
  hexToColor,
  hsbToRgb,
  oklchToRgb,
  resolveColor,
  rgb,
  rgbToCmyk,
  rgbToHsb,
  rgbToOklch,
} from '../../core/color';
import { Icon } from '../icons';
import { useActiveDoc } from '../../state/store';
import { Tip } from '../controls/Tooltip';

const DEFAULT_SWATCHES = [
  '#1A1820',
  '#FFFFFF',
  '#F6F4EF',
  '#E6E3DD',
  '#66626D',
  '#16C75B',
  '#2B5F6B',
  '#F0843A',
  '#E5484D',
  '#F5C84B',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#0EA5E9',
  '#14B8A6',
  '#84CC16',
  '#A16207',
  '#000000',
];

type Mode = 'hex' | 'rgb' | 'hsb' | 'oklch' | 'cmyk';

function Slider({
  value,
  onChange,
  background,
  label,
}: {
  value: number;
  onChange(v: number): void;
  background: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    onChange(Math.max(0, Math.min(1, (clientX - r.left) / r.width)));
  };
  return (
    <div
      ref={ref}
      className="cp-slider"
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      tabIndex={0}
      style={{ background }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        set(e.clientX);
      }}
      onPointerMove={(e) => e.buttons && set(e.clientX)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp')
          onChange(Math.min(1, value + (e.shiftKey ? 0.1 : 0.01)));
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown')
          onChange(Math.max(0, value - (e.shiftKey ? 0.1 : 0.01)));
      }}
    >
      <div className="knob" style={{ left: `${value * 100}%` }} />
    </div>
  );
}

export function ColorPicker({
  value,
  onChange,
  swatches = [],
  allowNone,
}: {
  value: Color | null;
  onChange(c: Color | null): void;
  swatches?: Swatch[];
  allowNone?: boolean;
}) {
  const resolved: SrgbColor | null = value ? resolveColor(value, swatches) : null;
  const [hsb, setHsb] = useState(() => (resolved ? rgbToHsb(resolved) : { h: 0, s: 0, b: 0 }));
  const [mode, setMode] = useState<Mode>('hex');
  const areaRef = useRef<HTMLDivElement>(null);
  const alpha = resolved?.a ?? 1;
  const linked = value && 'swatch' in value ? swatches.find((s) => s.id === value.swatch) : null;

  // Keep the hue stable for greys; follow external changes otherwise.
  useEffect(() => {
    if (!resolved) return;
    const n = rgbToHsb(resolved);
    const cur = hsbToRgb(hsb.h, hsb.s, hsb.b);
    if (colorToHex(cur) !== colorToHex(resolved)) setHsb(n.s === 0 ? { ...n, h: hsb.h } : n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved?.r, resolved?.g, resolved?.b]);

  const emit = (h: number, s: number, b: number, a = alpha) => {
    setHsb({ h, s, b });
    onChange(hsbToRgb(h, s, b, a));
  };

  const setArea = (clientX: number, clientY: number) => {
    const r = areaRef.current!.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const b = 1 - Math.max(0, Math.min(1, (clientY - r.top) / r.height));
    emit(hsb.h, s, b);
  };

  const pickScreen = async () => {
    const ED = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } })
      .EyeDropper;
    if (!ED) return;
    try {
      const r = await new ED().open();
      const c = hexToColor(r.sRGBHex);
      if (c) onChange({ ...c, a: alpha });
    } catch {
      /* cancelled */
    }
  };

  const hueColor = `hsl(${hsb.h}, 100%, 50%)`;
  const cur = resolved ?? rgb(0, 0, 0, 0);
  const curHex = `#${colorToHex(cur)}`;

  return (
    <div className="cp">
      <div
        ref={areaRef}
        className="cp-area"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})`,
        }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          setArea(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => e.buttons && setArea(e.clientX, e.clientY)}
        aria-label="Saturation and brightness"
        role="presentation"
      >
        <div
          className="knob"
          style={{ left: `${hsb.s * 100}%`, top: `${(1 - hsb.b) * 100}%`, background: curHex }}
        />
      </div>
      <Slider
        label="Hue"
        value={hsb.h / 360}
        onChange={(v) => emit(v * 360, hsb.s, hsb.b)}
        background="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
      />
      <Slider
        label="Opacity"
        value={alpha}
        onChange={(v) => emit(hsb.h, hsb.s, hsb.b, v)}
        background={`linear-gradient(to right, transparent, ${curHex}), repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 8px 8px`}
      />
      <div className="row" style={{ gap: 6 }}>
        <select
          className="field"
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          aria-label="Color model"
          style={{ width: 74, fontSize: 12 }}
        >
          <option value="hex">HEX</option>
          <option value="rgb">RGB</option>
          <option value="hsb">HSB</option>
          <option value="oklch">OKLCH</option>
          <option value="cmyk">CMYK</option>
        </select>
        <Channels mode={mode} color={cur} hsb={hsb} onChange={(c) => onChange(c)} />
        <Tip label="Pick from screen">
          <button
            className="icon-btn sm"
            aria-label="Pick from screen"
            onClick={pickScreen}
            disabled={!('EyeDropper' in window)}
          >
            <Icon name="eyedropper" size={14} />
          </button>
        </Tip>
      </div>
      {linked && (
        <div className="row muted" style={{ fontSize: 12 }}>
          <Icon name="link" size={13} /> {linked.name}
          <button
            className="small-btn"
            style={{ marginLeft: 'auto', height: 24 }}
            onClick={() => onChange(clone(linked.color))}
          >
            <Icon name="unlink" size={13} /> Unlink
          </button>
        </div>
      )}
      {swatches.length > 0 && (
        <>
          <div className="muted" style={{ fontSize: 12 }}>
            Document colors
          </div>
          <div className="cp-swatches">
            {swatches.map((s) => (
              <Tip key={s.id} label={s.global ? `${s.name} (global)` : s.name}>
                <button
                  aria-label={s.name}
                  aria-pressed={!!linked && linked.id === s.id}
                  style={{ background: `#${colorToHex(resolveColor(s.color))}` }}
                  onClick={() => onChange(s.global ? { swatch: s.id } : clone(s.color))}
                />
              </Tip>
            ))}
          </div>
        </>
      )}
      <div className="cp-swatches">
        {allowNone && (
          <button
            aria-label="No color"
            onClick={() => onChange(null)}
            style={{
              background:
                'linear-gradient(to top right, #fff calc(50% - 1px), #e5484d calc(50% - 1px), #e5484d calc(50% + 1px), #fff calc(50% + 1px))',
            }}
          />
        )}
        {(allowNone ? DEFAULT_SWATCHES.slice(0, -1) : DEFAULT_SWATCHES).map((h) => (
          <button
            key={h}
            aria-label={h}
            style={{ background: h }}
            onClick={() => onChange({ ...hexToColor(h)!, a: alpha })}
          />
        ))}
      </div>
    </div>
  );
}

function Channels({
  mode,
  color,
  hsb,
  onChange,
}: {
  mode: Mode;
  color: SrgbColor;
  hsb: { h: number; s: number; b: number };
  onChange(c: SrgbColor): void;
}) {
  const [hexText, setHexText] = useState(colorToHex(color));
  useEffect(() => setHexText(colorToHex(color)), [color]);
  if (mode === 'hex')
    return (
      <label className="field" style={{ flex: 1 }}>
        <span className="label">#</span>
        <input
          aria-label="Hex"
          value={hexText}
          onChange={(e) => setHexText(e.target.value)}
          onBlur={() => {
            const c = hexToColor(hexText);
            if (c) onChange({ ...c, a: hexText.replace('#', '').length === 8 ? c.a : color.a });
            else setHexText(colorToHex(color));
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
    );
  const fields: { label: string; value: number; max: number; set(v: number): SrgbColor }[] = [];
  if (mode === 'rgb')
    (['r', 'g', 'b'] as const).forEach((k) =>
      fields.push({
        label: k.toUpperCase(),
        value: Math.round(color[k] * 255),
        max: 255,
        set: (v) => ({ ...color, [k]: v / 255 }),
      }),
    );
  if (mode === 'hsb') {
    fields.push({
      label: 'H',
      value: Math.round(hsb.h),
      max: 360,
      set: (v) => hsbToRgb(v, hsb.s, hsb.b, color.a),
    });
    fields.push({
      label: 'S',
      value: Math.round(hsb.s * 100),
      max: 100,
      set: (v) => hsbToRgb(hsb.h, v / 100, hsb.b, color.a),
    });
    fields.push({
      label: 'B',
      value: Math.round(hsb.b * 100),
      max: 100,
      set: (v) => hsbToRgb(hsb.h, hsb.s, v / 100, color.a),
    });
  }
  if (mode === 'oklch') {
    const o = rgbToOklch(color);
    fields.push({
      label: 'L',
      value: Math.round(o.l * 100),
      max: 100,
      set: (v) => oklchToRgb(v / 100, o.c, o.h, color.a),
    });
    fields.push({
      label: 'C',
      value: Math.round(o.c * 1000) / 1000,
      max: 0.4,
      set: (v) => oklchToRgb(o.l, v, o.h, color.a),
    });
    fields.push({
      label: 'H',
      value: Math.round(o.h),
      max: 360,
      set: (v) => oklchToRgb(o.l, o.c, v, color.a),
    });
  }
  if (mode === 'cmyk') {
    const c = rgbToCmyk(color);
    const from = (cc: number, m: number, y: number, k: number) =>
      rgb((1 - cc) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k), color.a);
    fields.push({
      label: 'C',
      value: Math.round(c.c * 100),
      max: 100,
      set: (v) => from(v / 100, c.m, c.y, c.k),
    });
    fields.push({
      label: 'M',
      value: Math.round(c.m * 100),
      max: 100,
      set: (v) => from(c.c, v / 100, c.y, c.k),
    });
    fields.push({
      label: 'Y',
      value: Math.round(c.y * 100),
      max: 100,
      set: (v) => from(c.c, c.m, v / 100, c.k),
    });
    fields.push({
      label: 'K',
      value: Math.round(c.k * 100),
      max: 100,
      set: (v) => from(c.c, c.m, c.y, v / 100),
    });
  }
  return (
    <div className="row" style={{ gap: 4, flex: 1, minWidth: 0 }}>
      {fields.map((f) => (
        <label key={f.label} className="field" style={{ flex: 1, padding: '0 4px', gap: 2 }} title={f.label}>
          <input
            aria-label={f.label}
            defaultValue={f.value}
            key={`${f.label}${f.value}`}
            style={{ textAlign: 'center' }}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onChange(f.set(Math.max(0, Math.min(f.max, v))));
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
      ))}
    </div>
  );
}

export function ColorPopover({
  value,
  onChange,
  children,
  allowNone,
  side = 'left',
}: {
  value: Color | null;
  onChange(c: Color | null): void;
  children: ReactNode;
  allowNone?: boolean;
  side?: 'left' | 'right' | 'bottom' | 'top';
}) {
  const od = useActiveDoc();
  return (
    <P.Root>
      <P.Trigger asChild>{children}</P.Trigger>
      <P.Portal>
        <P.Content className="popover" side={side} align="start" sideOffset={8} collisionPadding={12}>
          <ColorPicker
            value={value}
            onChange={onChange}
            swatches={od?.doc.swatches ?? []}
            allowNone={allowNone}
          />
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

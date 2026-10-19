import * as M from '@radix-ui/react-dropdown-menu';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { evaluateInput, formatNumber } from '../../core/units';
import type { Unit } from '../../core/types';
import { redo, undo } from '../../state/store';
import { IS_MAC } from '../../state/commands';

type Props = {
  label: ReactNode;
  /** Value in display units. */
  value: number | null;
  onChange(v: number): void;
  unit?: Unit | '%' | '°' | '';
  /** Unit used for unit-suffixed math (10mm → field unit). */
  mathUnit?: Unit;
  decimals?: number;
  step?: number;
  min?: number;
  max?: number;
  /** Values offered in the dropdown of a bounded field. Generated from min/max when omitted. */
  options?: number[];
  ariaLabel: string;
  percentOf?: number;
  className?: string;
  placeholder?: string;
  /** Extra control inside the field, after the value. */
  suffix?: ReactNode;
};

const NICE = [1, 2, 2.5, 5];

/** Preset values for a bounded range: every step when there are few, otherwise about ten round values. */
export function rangeOptions(min: number, max: number, step = 1): number[] {
  const span = max - min;
  if (span / step <= 12) {
    const out: number[] = [];
    for (let v = min; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
    return out;
  }
  const raw = span / 10;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = (NICE.find((n) => n * pow >= raw) ?? 10) * pow;
  const out = new Set<number>([min]);
  for (let v = Math.ceil(min / nice) * nice; v <= max + 1e-9; v += nice) out.add(Math.round(v * 1000) / 1000);
  out.add(max);
  return [...out].sort((a, b) => a - b);
}

const Chevron = ({ up }: { up?: boolean }) => (
  <svg
    viewBox="0 0 10 6"
    width="8"
    height="5"
    aria-hidden
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={up ? 'M1 5l4-4 4 4' : 'M1 1l4 4 4-4'} />
  </svg>
);

/**
 * Numeric field. Accepts math (120/3, +12, 50%, 10mm); ↑/↓ step (⇧ ×10, ⌥ ×0.1).
 * Bounded fields (min and max) get a dropdown of presets; unbounded ones get up/down steppers.
 */
export function NumberField(p: Props) {
  const { value, unit = '', decimals = 2, step = 1 } = p;
  const suffixText = unit ? (unit === '%' || unit === '°' ? unit : ` ${unit}`) : '';
  // When the value with its unit does not fit, the unit is left off so the number is never cut.
  const [compact, setCompact] = useState(false);
  const shown = value === null ? '' : `${formatNumber(value, decimals)}${compact ? '' : suffixText}`;
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter commits and then blurs; the blur must not commit the same entry a second time.
  const skipBlurCommit = useRef(false);
  // True while the user has typed something that is not committed yet.
  const dirty = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const repeat = useRef<{
    timeout?: ReturnType<typeof setTimeout>;
    interval?: ReturnType<typeof setInterval>;
  }>({});

  const bounded = Number.isFinite(p.min) && Number.isFinite(p.max);
  const options = p.options ?? (bounded ? rangeOptions(p.min!, p.max!, step >= 1 ? step : 1) : null);

  // Re-check the fit when the field changes size (inspector drawer, window resize).
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = inputRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el || focused || !suffixText || value === null) return;
    const full = `${formatNumber(value, decimals)}${suffixText}`;
    if (!compact && el.value === full && el.scrollWidth > el.clientWidth + 1) setCompact(true);
    else if (compact) {
      // Try the unit again when the number gets shorter or the field wider.
      el.value = full;
      if (el.scrollWidth <= el.clientWidth + 1) setCompact(false);
      el.value = shown;
    }
  }, [focused, suffixText, value, decimals, compact, shown, width]);

  // Select the whole entry once when focus arrives, before any typing.
  useLayoutEffect(() => {
    if (focused) inputRef.current?.select();
  }, [focused]);

  // Follow outside changes (undo, steppers, other edits) unless the user is mid-entry.
  useEffect(() => {
    if (!focused) setText(shown);
    else if (!dirty.current) setText(value === null ? '' : formatNumber(value, decimals));
  }, [shown, focused, value, decimals]);

  useEffect(() => () => stopRepeat(), []);

  const clamp = (v: number) => Math.max(p.min ?? -Infinity, Math.min(p.max ?? Infinity, v));

  const commit = () => {
    dirty.current = false;
    let t = text.trim();
    // In a % or ° field the suffix is the field's own unit; length suffixes are converted by the evaluator.
    if (unit === '%' || unit === '°') t = t.replace(/[%°]\s*$/, '');
    else if (unit && !p.mathUnit) t = t.replace(new RegExp(`\\s*${unit}$`), '');
    const v = evaluateInput(t, { current: value ?? 0, unit: p.mathUnit, percentOf: p.percentOf });
    if (v !== null && v !== value) p.onChange(clamp(v));
    else setText(focused ? formatNumber(value ?? 0, decimals) : shown);
  };

  const stepBy = (dir: 1 | -1, e: { shiftKey: boolean; altKey: boolean }) => {
    const k = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * step * dir;
    const v = clamp(Math.round(((valueRef.current ?? 0) + k) * 1000) / 1000);
    dirty.current = false;
    valueRef.current = v;
    p.onChange(v);
  };

  function stopRepeat() {
    clearTimeout(repeat.current.timeout);
    clearInterval(repeat.current.interval);
    repeat.current = {};
  }

  /** Press steps once; holding repeats after a short delay. */
  const startRepeat = (dir: 1 | -1) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stepBy(dir, e);
    const mods = { shiftKey: e.shiftKey, altKey: e.altKey };
    stopRepeat();
    repeat.current.timeout = setTimeout(() => {
      repeat.current.interval = setInterval(() => stepBy(dir, mods), 60);
    }, 380);
  };

  const stepButton = (dir: 1 | -1) => (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`${dir > 0 ? 'Increase' : 'Decrease'} ${p.ariaLabel}`}
      onPointerDown={startRepeat(dir)}
      onPointerUp={stopRepeat}
      onPointerLeave={stopRepeat}
      onPointerCancel={stopRepeat}
      onClick={(e) => {
        e.preventDefault();
        // Keyboard and assistive tech activate with a click and no pointer events.
        if (e.detail === 0) stepBy(dir, e);
      }}
    >
      <Chevron up={dir > 0} />
    </button>
  );

  return (
    <label className={`field ${options ? 'has-options' : 'has-steps'} ${p.className ?? ''}`}>
      <span className="label" aria-hidden>
        {p.label}
      </span>
      <input
        aria-label={p.ariaLabel}
        value={focused ? text : shown}
        placeholder={p.placeholder ?? (value === null ? 'Mixed' : undefined)}
        inputMode="decimal"
        spellCheck={false}
        ref={inputRef}
        onFocus={() => {
          setFocused(true);
          dirty.current = false;
          setText(value === null ? '' : formatNumber(value, decimals));
        }}
        onBlur={() => {
          if (!skipBlurCommit.current && dirty.current) commit();
          skipBlurCommit.current = false;
          dirty.current = false;
          setFocused(false);
        }}
        onChange={(e) => {
          dirty.current = true;
          setText(e.target.value);
        }}
        onKeyDown={(e) => {
          const mod = IS_MAC ? e.metaKey : e.ctrlKey;
          if (mod && e.key.toLowerCase() === 'z' && !dirty.current) {
            // Nothing typed here: undo and redo belong to the document.
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
          } else if (e.key === 'Enter') {
            commit();
            skipBlurCommit.current = true;
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            dirty.current = false;
            setText(shown);
            skipBlurCommit.current = true;
            setFocused(false);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            stepBy(e.key === 'ArrowUp' ? 1 : -1, e);
          }
        }}
      />
      {p.suffix}
      {options ? (
        <M.Root modal={false}>
          <M.Trigger asChild>
            <button
              type="button"
              className="field-drop"
              aria-label={`${p.ariaLabel} presets`}
              tabIndex={-1}
              onClick={(e) => e.preventDefault()}
            >
              <Chevron />
            </button>
          </M.Trigger>
          <M.Portal>
            <M.Content className="menu-content field-menu" align="end" sideOffset={6} collisionPadding={8}>
              {options.map((o) => (
                <M.Item
                  key={o}
                  className={`menu-item ${o === value ? 'current' : ''}`}
                  onSelect={() => p.onChange(clamp(o))}
                >
                  {formatNumber(o, decimals)}
                  {suffixText}
                </M.Item>
              ))}
            </M.Content>
          </M.Portal>
        </M.Root>
      ) : (
        <span className="field-steps">
          {stepButton(1)}
          {stepButton(-1)}
        </span>
      )}
    </label>
  );
}

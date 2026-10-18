import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { evaluateInput, formatNumber } from '../../core/units';
import type { Unit } from '../../core/types';

type Props = {
  label: ReactNode;
  /** Value in display units. */
  value: number | null;
  onChange(v: number): void;
  /** Called once when a scrub starts/ends so callers can group live changes into one undo step. */
  onScrubStart?(): void;
  onScrubEnd?(): void;
  unit?: Unit | '%' | '°' | '';
  /** Unit used for unit-suffixed math (10mm → field unit). */
  mathUnit?: Unit;
  decimals?: number;
  step?: number;
  min?: number;
  max?: number;
  ariaLabel: string;
  percentOf?: number;
  className?: string;
  placeholder?: string;
  /** Extra control inside the field, after the value (e.g. a lock toggle). */
  suffix?: ReactNode;
};

/**
 * Numeric field: accepts math (120/3, +12, 50%, 10mm), arrow keys step (⇧ ×10, ⌥ ×0.1),
 * and scrubbing by dragging the label.
 */
export function NumberField(p: Props) {
  const { value, unit = '', decimals = 2, step = 1 } = p;
  const shown =
    value === null
      ? ''
      : `${formatNumber(value, decimals)}${unit ? (unit === '%' || unit === '°' ? unit : ` ${unit}`) : ''}`;
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  const scrub = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter commits and then blurs; the blur must not commit the same entry a second time.
  const skipBlurCommit = useRef(false);

  // Select the whole entry once when focus arrives, before any typing.
  useLayoutEffect(() => {
    if (focused) inputRef.current?.select();
  }, [focused]);

  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);

  const clamp = (v: number) => Math.max(p.min ?? -Infinity, Math.min(p.max ?? Infinity, v));

  const commit = () => {
    let t = text.trim();
    // In a % or ° field the suffix is the field's own unit; length suffixes are converted by the evaluator.
    if (unit === '%' || unit === '°') t = t.replace(/[%°]\s*$/, '');
    else if (unit && !p.mathUnit) t = t.replace(new RegExp(`\\s*${unit}$`), '');
    const v = evaluateInput(t, { current: value ?? 0, unit: p.mathUnit, percentOf: p.percentOf });
    if (v !== null && v !== value) p.onChange(clamp(v));
    else setText(shown);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (value === null) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    scrub.current = { x: e.clientX, v: value, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = scrub.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (!s.moved && Math.abs(dx) < 2) return;
    if (!s.moved) p.onScrubStart?.();
    s.moved = true;
    const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    p.onChange(clamp(Math.round((s.v + dx * step * k) * 1000) / 1000));
  };
  const onPointerUp = () => {
    if (scrub.current?.moved) p.onScrubEnd?.();
    scrub.current = null;
  };

  return (
    <label className={`field ${p.className ?? ''}`}>
      <span
        className="label scrub"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-hidden
      >
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
          setText(value === null ? '' : formatNumber(value, decimals));
        }}
        onBlur={() => {
          if (!skipBlurCommit.current) commit();
          skipBlurCommit.current = false;
          setFocused(false);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            skipBlurCommit.current = true;
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setText(shown);
            skipBlurCommit.current = true;
            setFocused(false);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const k = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
            const v = clamp(Math.round(((value ?? 0) + k) * 1000) / 1000);
            p.onChange(v);
            setText(formatNumber(v, decimals));
          }
        }}
      />
      {p.suffix}
    </label>
  );
}

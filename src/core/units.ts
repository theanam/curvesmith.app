import type { Unit } from './types';

/** Points per unit. Internal geometry is always in points (1/72 in). px assumes 72 ppi (1px = 1pt), like Illustrator. */
export const PT_PER: Record<Unit, number> = {
  pt: 1,
  px: 1,
  mm: 72 / 25.4,
  cm: 72 / 2.54,
  in: 72,
  pc: 12,
};

export const UNITS: Unit[] = ['mm', 'cm', 'in', 'px', 'pt', 'pc'];

export const toPt = (v: number, unit: Unit) => v * PT_PER[unit];
export const fromPt = (v: number, unit: Unit) => v / PT_PER[unit];

export function formatNumber(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return '0';
  const f = Math.pow(10, decimals);
  const r = Math.round(v * f) / f;
  return String(Object.is(r, -0) ? 0 : r);
}

export const formatLength = (
  pt: number,
  unit: Unit,
  decimals = unit === 'mm' || unit === 'pt' || unit === 'px' ? 1 : 2,
) => `${formatNumber(fromPt(pt, unit), decimals)} ${unit}`;

export type EvalContext = {
  /** Current value in the field's display unit; used for +12, -3, *2 and %. */
  current: number;
  /** The field's display unit. Values typed with another unit are converted into it. */
  unit?: Unit;
  /** Base for percentages (defaults to current). */
  percentOf?: number;
};

/**
 * Evaluate a numeric field entry. Supports + - * / ( ), units (10mm, 2in), percentages (50%),
 * and relative entries that start with an operator (+12, *2, /3) applied to the current value.
 * Returns null when the input cannot be parsed.
 */
export function evaluateInput(input: string, ctx: EvalContext): number | null {
  const s = input.trim().replace(/,/g, '.').replace(/[×x]/g, '*').replace(/÷/g, '/').replace(/°/g, '');
  if (!s) return null;
  // A leading + * / makes the entry relative to the current value. A leading - is a negative number.
  const expr = /^[+*/]/.test(s) ? `(${ctx.current})${s}` : s;
  try {
    const p = new Parser(expr, ctx);
    const v = p.parseExpression();
    p.skipWs();
    if (p.pos < p.src.length) return null;
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

class Parser {
  pos = 0;
  constructor(
    public src: string,
    private ctx: EvalContext,
  ) {}
  skipWs() {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }
  parseExpression(): number {
    let v = this.parseTerm();
    for (;;) {
      this.skipWs();
      const c = this.src[this.pos];
      if (c === '+' || c === '-') {
        this.pos++;
        const r = this.parseTerm();
        v = c === '+' ? v + r : v - r;
      } else return v;
    }
  }
  parseTerm(): number {
    let v = this.parseFactor();
    for (;;) {
      this.skipWs();
      const c = this.src[this.pos];
      if (c === '*' || c === '/') {
        this.pos++;
        const r = this.parseFactor();
        v = c === '*' ? v * r : v / r;
      } else return v;
    }
  }
  parseFactor(): number {
    this.skipWs();
    const c = this.src[this.pos];
    if (c === '-') {
      this.pos++;
      return -this.parseFactor();
    }
    if (c === '+') {
      this.pos++;
      return this.parseFactor();
    }
    if (c === '(') {
      this.pos++;
      const v = this.parseExpression();
      this.skipWs();
      if (this.src[this.pos] !== ')') throw new Error('Expected )');
      this.pos++;
      return this.suffix(v);
    }
    const m = /^\d*\.?\d+(?:e[+-]?\d+)?/i.exec(this.src.slice(this.pos));
    if (!m) throw new Error('Expected number');
    this.pos += m[0].length;
    return this.suffix(parseFloat(m[0]));
  }
  suffix(v: number): number {
    this.skipWs();
    if (this.src[this.pos] === '%') {
      this.pos++;
      return (v / 100) * (this.ctx.percentOf ?? this.ctx.current);
    }
    const m = /^(mm|cm|in|px|pt|pc)\b/i.exec(this.src.slice(this.pos));
    if (m) {
      this.pos += m[0].length;
      const u = m[1].toLowerCase() as Unit;
      const target = this.ctx.unit ?? u;
      return (v * PT_PER[u]) / PT_PER[target];
    }
    return v;
  }
}

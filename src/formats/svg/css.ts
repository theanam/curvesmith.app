/* Minimal CSS support for SVG import: rule parsing, simple selectors (tag, .class, #id, compounds,
   descendant and child combinators, comma lists) and the extended named colors. */
import { hexToColor, parseCssColor } from '../../core/color';
import type { SrgbColor } from '../../core/types';

export type CssRule = {
  selector: Compound[];
  specificity: number;
  order: number;
  decls: Record<string, string>;
};
type Compound = { tag: string | null; ids: string[]; classes: string[]; combinator: ' ' | '>' | null };

export function parseDeclarations(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part
      .slice(i + 1)
      .replace(/!important/i, '')
      .trim();
    if (k && v) out[k] = v;
  }
  return out;
}

function parseSelector(sel: string): Compound[] | null {
  const parts = sel
    .trim()
    .replace(/\s*>\s*/g, ' > ')
    .split(/\s+/);
  const out: Compound[] = [];
  let comb: ' ' | '>' | null = null;
  for (const p of parts) {
    if (p === '>') {
      comb = '>';
      continue;
    }
    const m = /^(\*|[a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(p);
    if (!m || (!m[1] && !m[2])) return null;
    const ids: string[] = [];
    const classes: string[] = [];
    for (const t of m[2].match(/[.#][\w-]+/g) ?? []) (t[0] === '#' ? ids : classes).push(t.slice(1));
    out.push({
      tag: m[1] && m[1] !== '*' ? m[1].toLowerCase() : null,
      ids,
      classes,
      combinator: out.length ? (comb ?? ' ') : null,
    });
    comb = null;
  }
  return out.length ? out : null;
}

/** Parse a stylesheet. Unsupported selectors are counted in `skipped`. */
export function parseStylesheet(css: string, startOrder = 0): { rules: CssRule[]; skipped: number } {
  const rules: CssRule[] = [];
  let skipped = 0;
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!\[CDATA\[|\]\]>/g, '');
  let i = 0;
  let order = startOrder;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const head = src.slice(i, open).trim();
    // Find the matching close brace (at-rules may nest).
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    const body = src.slice(open + 1, j - 1);
    i = j;
    if (head.startsWith('@')) {
      if (/^@media\s+(all|screen)\b/i.test(head)) {
        const inner = parseStylesheet(body, order);
        rules.push(...inner.rules);
        skipped += inner.skipped;
        order += inner.rules.length;
      }
      continue;
    }
    const decls = parseDeclarations(body);
    for (const s of head.split(',')) {
      const sel = /[:[+~]/.test(s) ? null : parseSelector(s);
      if (!sel) {
        skipped++;
        continue;
      }
      const specificity = sel.reduce(
        (n, c) => n + c.ids.length * 100 + c.classes.length * 10 + (c.tag ? 1 : 0),
        0,
      );
      rules.push({ selector: sel, specificity, order: order++, decls });
    }
  }
  return { rules, skipped };
}

function matchesCompound(el: Element, c: Compound): boolean {
  if (c.tag && el.localName.toLowerCase() !== c.tag) return false;
  if (c.ids.length && !c.ids.every((id) => el.getAttribute('id') === id)) return false;
  if (c.classes.length) {
    const cls = (el.getAttribute('class') ?? '').split(/\s+/);
    if (!c.classes.every((k) => cls.includes(k))) return false;
  }
  return true;
}

export function matches(el: Element, sel: Compound[]): boolean {
  let i = sel.length - 1;
  if (!matchesCompound(el, sel[i])) return false;
  let cur: Element | null = el;
  while (i > 0) {
    const comb = sel[i].combinator;
    i--;
    if (comb === '>') {
      cur = cur.parentElement;
      if (!cur || !matchesCompound(cur, sel[i])) return false;
    } else {
      cur = cur.parentElement;
      while (cur && !matchesCompound(cur, sel[i])) cur = cur.parentElement;
      if (!cur) return false;
    }
  }
  return true;
}

/** Declarations from the stylesheet that apply to an element, in cascade order. */
export function cascade(el: Element, rules: CssRule[]): Record<string, string> {
  const hits = rules
    .filter((r) => matches(el, r.selector))
    .sort((a, b) => a.specificity - b.specificity || a.order - b.order);
  return Object.assign({}, ...hits.map((r) => r.decls));
}

const EXTRA_NAMED =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aquamarine:7fffd4,azure:f0ffff,bisque:ffe4c4,blanchedalmond:ffebcd,blueviolet:8a2be2,' +
  'burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,cornflowerblue:6495ed,cornsilk:fff8dc,darkcyan:008b8b,darkgoldenrod:b8860b,' +
  'darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darksalmon:e9967a,' +
  'darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,' +
  'deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,' +
  'forestgreen:228b22,gainsboro:dcdcdc,ghostwhite:f8f8ff,goldenrod:daa520,greenyellow:adff2f,honeydew:f0fff0,hotpink:ff69b4,' +
  'indianred:cd5c5c,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,' +
  'lightgoldenrodyellow:fafad2,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,' +
  'lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,limegreen:32cd32,' +
  'linen:faf0e6,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,' +
  'mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,' +
  'mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,oldlace:fdf5e6,olivedrab:6b8e23,orangered:ff4500,' +
  'orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,' +
  'peachpuff:ffdab9,peru:cd853f,plum:dda0dd,powderblue:b0e0e6,rebeccapurple:663399,rosybrown:bc8f8f,royalblue:4169e1,' +
  'saddlebrown:8b4513,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,slateblue:6a5acd,slategrey:708090,snow:fffafa,' +
  'springgreen:00ff7f,thistle:d8bfd8,wheat:f5deb3,yellowgreen:9acd32,darkslate:2f4f4f';

const extraNamed = new Map(EXTRA_NAMED.split(',').map((p) => p.split(':') as [string, string]));

export function parseSvgColor(v: string): SrgbColor | null {
  const s = v.trim().toLowerCase();
  const c = parseCssColor(s);
  if (c) return c;
  const hex = extraNamed.get(s);
  return hex ? hexToColor(hex) : null;
}

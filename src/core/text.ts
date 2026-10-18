import type { TextNode, TextRun } from './types';

export type Measurer = (text: string, run: TextRun) => number;

/** Rough width estimate used when no canvas is available (tests, workers). */
const approxMeasure: Measurer = (text, run) =>
  text.length * run.size * 0.55 + (Math.max(0, text.length - 1) * run.tracking * run.size) / 1000;

let measurer: Measurer = approxMeasure;
export const setMeasurer = (m: Measurer) => {
  measurer = m;
  layoutCache = new WeakMap();
};
export const measureText = (text: string, run: TextRun) => measurer(text, run);

export const cssFont = (run: TextRun) =>
  `${run.font.style === 'italic' ? 'italic ' : ''}${run.font.weight} ${run.size}px "${run.font.family}"`;

export type TextLine = { text: string; x: number; baseline: number; width: number };
export type TextLayout = {
  lines: TextLine[];
  width: number;
  height: number;
  ascent: number;
  lineHeight: number;
};

export const textContent = (n: TextNode) => n.runs.map((r) => r.text).join('');
export const primaryRun = (n: TextNode): TextRun => n.runs[0];

let layoutCache = new WeakMap<TextNode, TextLayout>();

/** Lay out a text node in its local space. Point text: origin is the first line's top-left. */
export function layoutText(n: TextNode): TextLayout {
  const cached = layoutCache.get(n);
  if (cached) return cached;
  const run = primaryRun(n);
  const text = textContent(n);
  const lineHeight = run.size * run.leading;
  const ascent = run.size * 0.8 + (lineHeight - run.size) / 2;
  const boxWidth = n.mode === 'area' && n.box ? n.box.width : Infinity;
  const raw: string[] = [];
  for (const para of text.split('\n')) {
    if (boxWidth === Infinity) {
      raw.push(para);
      continue;
    }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const candidate = line + w;
      if (line && measurer(candidate.trimEnd(), run) > boxWidth) {
        raw.push(line.trimEnd());
        line = w.trimStart();
      } else line = candidate;
    }
    raw.push(line);
  }
  const widths = raw.map((l) => measurer(l, run));
  const maxW = Math.max(0, ...widths);
  const blockW = boxWidth === Infinity ? maxW : boxWidth;
  const lines = raw.map((t, i) => {
    let x = n.paragraph.indent && i === 0 ? n.paragraph.indent : 0;
    if (n.paragraph.align === 'center') x = (blockW - widths[i]) / 2;
    else if (n.paragraph.align === 'right') x = blockW - widths[i];
    return { text: t, x, baseline: ascent + i * lineHeight, width: widths[i] };
  });
  const height = n.mode === 'area' && n.box ? n.box.height : raw.length * lineHeight;
  const layout = { lines, width: blockW, height, ascent, lineHeight };
  layoutCache.set(n, layout);
  return layout;
}

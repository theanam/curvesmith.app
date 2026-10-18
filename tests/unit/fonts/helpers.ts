import type { TextNode, TextRun } from '../../../src/core/types';

export const CATALOG_ROWS = [
  ['abel', 'Abel', 'sans', [400], 0],
  ['geist', 'Geist', 'sans', [100, 200, 300, 400, 500, 600, 700, 800, 900], 1],
  ['inter', 'Inter', 'sans', [100, 200, 300, 400, 500, 600, 700, 800, 900], 1],
  ['lobster', 'Lobster', 'display', [400], 0],
  ['playfair-display', 'Playfair Display', 'serif', [400, 500, 600, 700, 800, 900], 1],
  ['roboto', 'Roboto', 'sans', [100, 300, 400, 500, 700, 900], 1],
  ['roboto-mono', 'Roboto Mono', 'mono', [100, 200, 300, 400, 500, 600, 700], 1],
  ['caveat', 'Caveat', 'handwriting', [400, 500, 600, 700], 0],
  ['noto-serif', 'Noto Serif', 'serif', [100, 400, 900], 1],
];

export function run(over: Partial<TextRun> = {}): TextRun {
  return {
    text: 'Hello',
    font: { family: 'Geist', weight: 400, style: 'normal' },
    size: 100,
    tracking: 0,
    leading: 1.2,
    features: {},
    ...over,
  };
}

export function textNode(
  text: string,
  over: Partial<TextNode> = {},
  runOver: Partial<TextRun> = {},
): TextNode {
  return {
    id: 't1',
    name: 'Text',
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    transform: [1, 0, 0, 1, 0, 0],
    appearance: { items: [] },
    type: 'text',
    mode: 'point',
    runs: [run({ text, ...runOver })],
    paragraph: { align: 'left', indent: 0 },
    ...over,
  };
}

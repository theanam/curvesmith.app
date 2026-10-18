import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CurvsDocument, SceneNode } from '../../../src/core/types';
import {
  createDocument,
  makeEllipse,
  makeGroup,
  makePath,
  makeRect,
  makeStar,
  makeStroke,
  makeText,
  walk,
} from '../../../src/core/document';
import { rgb } from '../../../src/core/color';
import { parsePathData } from '../../../src/core/geometry/pathdata';
import { nodeBounds, worldBounds } from '../../../src/core/geometry/node';
import { locate } from '../../../src/core/document';
import type { ExportContext } from '../../../src/formats/types';

export const fixture = (p: string) => new Uint8Array(readFileSync(resolve(__dirname, '../../fixtures', p)));
export const fixtureText = (p: string) => readFileSync(resolve(__dirname, '../../fixtures', p), 'utf8');

/** 1×1 red PNG. */
export const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function ctxFor(doc: CurvsDocument, warnings: string[] = []): ExportContext {
  return { name: 'Test', selection: [], activeArtboard: doc.artboards[0].id, warn: (m) => warnings.push(m) };
}

/** A document that touches most features: shapes, gradient, dashed stroke, group with opacity, text, image, clip. */
export function sampleDoc(): CurvsDocument {
  const doc = createDocument({ name: 'Poster', width: 400, height: 300, units: 'mm' });
  const ab = doc.artboards[0];
  const rect = makeRect(20, 20, 120, 80);
  rect.name = 'Card';
  rect.appearance.items = [
    {
      kind: 'fill',
      id: 'ap_f1',
      visible: true,
      paint: { type: 'solid', color: rgb(0.169, 0.373, 0.42) },
      opacity: 1,
      blend: 'normal',
    },
  ];
  const ell = makeEllipse(250, 70, 50, 30);
  ell.name = 'Sun';
  ell.appearance.items = [
    {
      kind: 'fill',
      id: 'ap_f2',
      visible: true,
      paint: {
        type: 'linear',
        from: [-50, 0],
        to: [50, 0],
        stops: [
          { offset: 0, color: rgb(1, 0, 0) },
          { offset: 1, color: rgb(0, 0, 1) },
        ],
      },
      opacity: 1,
      blend: 'normal',
    },
    { ...makeStroke(rgb(0, 0, 0), 2), dash: [6, 3] },
  ];
  const path = makePath(parsePathData('M20 200 C 60 150 100 250 140 200 L 160 260 Z'));
  path.name = 'Wave';
  path.appearance.items = [
    {
      kind: 'fill',
      id: 'ap_f3',
      visible: true,
      paint: { type: 'solid', color: rgb(1, 0.8, 0) },
      opacity: 0.5,
      blend: 'normal',
    },
    { ...makeStroke(rgb(0, 0, 0.5), 3), cap: 'round', join: 'round' },
  ];
  const star = makeStar(300, 220, 40);
  star.name = 'Star';
  const inner = makeRect(0, 0, 30, 30);
  const g = makeGroup([star, inner], 'Shapes');
  g.opacity = 0.8;
  const text = makeText(30, 120, 'Low Tide');
  text.name = 'Title';
  doc.assets['assets/red.png'] = PNG_1PX;
  const img: SceneNode = {
    ...makeRect(200, 120, 40, 40),
    type: 'image',
    asset: 'assets/red.png',
    width: 40,
    height: 40,
  } as unknown as SceneNode;
  delete (img as unknown as Record<string, unknown>).corners;
  img.name = 'Photo';
  ab.children = [rect, ell, path, g, text, img];
  return doc;
}

export type Summary = {
  type: string;
  name: string;
  bounds: [number, number, number, number] | null;
  colors: string[];
};

/** Flat summary of leaf objects in document order, for golden comparisons. */
export function summarize(doc: CurvsDocument): Summary[] {
  const out: Summary[] = [];
  walk(doc, (n, ancestors, ab) => {
    if (n.type === 'group' || n.type === 'clipGroup') return;
    const loc = locate(doc, n.id);
    const b = loc ? worldBounds(loc, doc) : nodeBounds(n, doc);
    void ancestors;
    void ab;
    out.push({
      type: n.type,
      name: n.name,
      bounds: b ? [b.x, b.y, b.width, b.height] : null,
      // Images ignore their appearance stack when painted.
      colors: (n.type === 'image' ? [] : n.appearance.items)
        .filter((i) => i.kind !== 'effect')
        .map((i) => {
          const p = (i as { paint: { type: string; color?: { r: number; g: number; b: number } } }).paint;
          if (p.type !== 'solid' || !p.color) return `${i.kind}:${p.type}`;
          const c = p.color;
          return `${i.kind}:${[c.r, c.g, c.b].map((v) => Math.round(v * 255)).join(',')}`;
        }),
    });
  });
  return out;
}

export function expectBoundsClose(a: Summary['bounds'], b: Summary['bounds'], tol = 0.6) {
  if (!a || !b) return a === b;
  return a.every((v, i) => Math.abs(v - b[i]) <= tol);
}

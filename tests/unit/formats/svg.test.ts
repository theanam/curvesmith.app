import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'fflate';
import { importSvg } from '../../../src/formats/svg/import';
import { artboardToSvgString, buildSvg, exportSvgString, slugify } from '../../../src/formats/svg/export';
import { parseLength, parseTransform, viewBoxMatrix } from '../../../src/formats/svg/import';
import { parseStylesheet, cascade } from '../../../src/formats/svg/css';
import type { CurvsDocument, SceneNode, TextNode } from '../../../src/core/types';
import { createDocument, makeRect, makeText, walk } from '../../../src/core/document';
import { rgb } from '../../../src/core/color';
import { ctxFor, expectBoundsClose, fixture, sampleDoc, summarize } from './helpers';
import { utf8 } from '../../../src/formats/shared/bytes';

vi.mock('../../../src/fonts/loader', () => ({
  getFontBytes: async () =>
    new Uint8Array(readFileSync(resolve(__dirname, '../../fixtures/fonts/geist-latin-400-normal.ttf'))),
  ensureFont: async () => undefined,
  onFontLoaded: () => () => undefined,
}));

const all = (doc: CurvsDocument) => {
  const out: SceneNode[] = [];
  walk(doc, (n) => {
    out.push(n);
  });
  return out;
};

const svgFrom = (s: string) => importSvg(utf8(s), { fileName: 't.svg' });

describe('SVG helpers', () => {
  it('parses lengths with units', () => {
    expect(parseLength('10')).toBe(10);
    expect(parseLength('1in')).toBe(72);
    expect(parseLength('25.4mm')).toBeCloseTo(72);
    expect(parseLength('50%', 200)).toBe(100);
    expect(parseLength('junk', 0, 7)).toBe(7);
  });
  it('parses transform lists left to right', () => {
    const m = parseTransform('translate(10 20) scale(2)');
    expect(m).toEqual([2, 0, 0, 2, 10, 20]);
    const r = parseTransform('rotate(90 10 10)');
    expect(r[4]).toBeCloseTo(20);
    expect(r[5]).toBeCloseTo(0);
    expect(parseTransform('skewX(45)')[2]).toBeCloseTo(1);
    expect(parseTransform('matrix(1 0 0 1 5 6)')).toEqual([1, 0, 0, 1, 5, 6]);
  });
  it('maps viewBox with preserveAspectRatio', () => {
    expect(viewBoxMatrix([0, 0, 100, 50], 200, 200, null)).toEqual([2, 0, 0, 2, 0, 50]);
    expect(viewBoxMatrix([0, 0, 100, 50], 200, 200, 'none')).toEqual([2, 0, 0, 4, 0, 0]);
    expect(viewBoxMatrix([0, 0, 100, 50], 200, 200, 'xMinYMin slice')).toEqual([4, 0, 0, 4, 0, 0]);
  });
  it('cascades simple CSS selectors by specificity', () => {
    const { rules, skipped } = parseStylesheet(
      'rect{fill:red} .a{fill:blue} #b{fill:green} g > rect.a{stroke:black} a:hover{fill:pink}',
    );
    expect(skipped).toBe(1);
    const doc = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><g><rect id="b" class="a"/></g></svg>',
      'image/svg+xml',
    );
    const el = doc.getElementsByTagName('rect')[0];
    expect(cascade(el, rules)).toEqual({ fill: 'green', stroke: 'black' });
  });
  it('slugifies names into valid ids', () => {
    expect(slugify('Layer 1')).toBe('Layer-1');
    expect(slugify('1st')).toBe('id-1st');
    expect(slugify('Café!')).toBe('Cafe');
  });
});

describe('SVG import', () => {
  it('imports the feature fixture with an honest report', async () => {
    const { doc, report } = await importSvg(fixture('svg/features.svg'), { fileName: 'features.svg' });
    const ab = doc.artboards[0];
    // 200 mm × 100 mm, viewBox 400 × 200 → scale 1.417.
    expect(ab.width).toBeCloseTo((200 * 72) / 25.4, 3);
    expect(ab.height).toBeCloseTo((100 * 72) / 25.4, 3);
    expect(doc.units).toBe('px');
    const nodes = all(doc);
    const byName = (n: string) => nodes.find((x) => x.name === n)!;

    const bg = byName('bg');
    expect(bg.type).toBe('rect');
    if (bg.type === 'rect') expect(bg.corners[0].radius).toBe(8);
    const fill = bg.appearance.items[0];
    expect(fill.kind === 'fill' && fill.paint.type === 'solid' && fill.paint.color).toMatchObject({
      r: 0x2b / 255,
      g: 0x5f / 255,
      b: 0x6b / 255,
    });

    const layer = byName('Layer_1');
    expect(layer.type).toBe('group');
    expect(layer.opacity).toBe(0.5);
    if (layer.type === 'group') {
      const [circle, line, poly, star] = layer.children;
      expect(circle.type).toBe('ellipse');
      // g.layer > circle rule wins over the default black.
      const cf = circle.appearance.items[0];
      expect(cf.kind === 'fill' && cf.paint.type === 'solid' && cf.paint.color).toMatchObject({
        r: 1,
        g: 0,
        b: 0,
      });
      expect(line.type).toBe('path');
      expect(line.appearance.items.find((i) => i.kind === 'stroke')).toMatchObject({ width: 4 });
      const ps = poly.appearance.items.find((i) => i.kind === 'stroke');
      expect(ps && ps.kind === 'stroke' && ps.paint.type === 'solid' && ps.paint.color).toMatchObject({
        r: 0x80 / 255,
        g: 0,
        b: 0x80 / 255,
      });
      expect(poly.appearance.items.some((i) => i.kind === 'fill')).toBe(false);
      expect(star.type === 'path' && star.fillRule).toBe('evenodd');
      expect(star.appearance.items.find((i) => i.kind === 'stroke')).toMatchObject({ width: 3 });
    }

    const ellipse = nodes.find((n) => n.type === 'ellipse' && n.rx === 40)!;
    const grad = ellipse.appearance.items[0];
    expect(grad.kind === 'fill' && grad.paint.type).toBe('linear');
    if (grad.kind === 'fill' && grad.paint.type === 'linear') {
      // objectBoundingBox (0..1 across the ellipse box) in the ellipse's local space (centered).
      expect(grad.paint.from[0]).toBeCloseTo(-40);
      expect(grad.paint.to[0]).toBeCloseTo(40);
      expect(grad.paint.stops[1].color).toMatchObject({ a: 0.5 });
    }
    const stroke = ellipse.appearance.items[1];
    expect(stroke).toMatchObject({ kind: 'stroke', dash: [4, 2], cap: 'round', width: 2 });

    const radial = nodes.find((n) => n.type === 'ellipse' && n.rx === 30)!;
    const rf = radial.appearance.items[0];
    expect(rf.kind === 'fill' && rf.paint.type).toBe('radial');

    // href-inherited gradient in user space, mapped into the rect's local space (rect x = 10 → local 0).
    const lg2 = nodes.find((n) => n.type === 'rect' && n.width === 100 && n.height === 20)!;
    const lf = lg2.appearance.items[0];
    if (lf.kind === 'fill' && lf.paint.type === 'linear') {
      expect(lf.paint.from[0]).toBeCloseTo(0);
      expect(lf.paint.to[0]).toBeCloseTo(100);
      expect(lf.paint.stops).toHaveLength(2);
    } else throw new Error('expected a linear gradient');

    const clip = nodes.find((n) => n.type === 'clipGroup');
    expect(clip).toBeDefined();

    const text = nodes.find((n) => n.type === 'text') as TextNode;
    expect(text.runs[0].text).toBe('Hello world');
    expect(text.runs[0].font).toEqual({ family: 'Geist', weight: 700, style: 'normal' });
    expect(text.paragraph.align).toBe('center');

    const images = nodes.filter((n) => n.type === 'image');
    expect(images).toHaveLength(2);
    const embedded = images.find((n) => n.type === 'image' && n.asset.startsWith('assets/'));
    expect(embedded && embedded.type === 'image' && doc.assets[embedded.asset]).toMatch(
      /^data:image\/png;base64,/,
    );
    if (embedded?.type === 'image') expect(embedded.asset).toMatch(/^assets\/[0-9a-f]{64}\.png$/);

    expect(report.warnings).toEqual(
      expect.arrayContaining([
        '1 mask was dropped.',
        '1 filter effect was dropped.',
        '1 pattern fill was replaced with a flat color.',
        '1 linked image was left unembedded.',
        '1 unsupported element was skipped.',
        '1 CSS rule was skipped.',
      ]),
    );
  });

  it('inlines <use> of a symbol with its viewBox mapping', async () => {
    const { doc } = await importSvg(fixture('svg/features.svg'), { fileName: 'f.svg' });
    const orange = all(doc).find(
      (n) =>
        n.type === 'rect' &&
        n.appearance.items.some(
          (i) =>
            i.kind === 'fill' &&
            i.paint.type === 'solid' &&
            i.paint.color &&
            'r' in i.paint.color &&
            i.paint.color.r === 1 &&
            i.paint.color.g > 0.6,
        ),
    );
    expect(orange).toBeDefined();
    const s = summarize(doc).find((x) => x.type === 'rect' && x.colors[0] === 'fill:255,165,0')!;
    // 30×30 user units at (200,150), scaled by 200mm/400.
    const k = (200 * 72) / 25.4 / 400;
    expect(expectBoundsClose(s.bounds, [200 * k, 150 * k, 30 * k, 30 * k], 0.01)).toBe(true);
  });

  it('handles SVGZ and documents without a viewBox', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="40"><rect width="10" height="10"/></svg>';
    const { doc } = await importSvg(gzipSync(utf8(svg)), { fileName: 'a.svgz' });
    expect(doc.artboards[0].width).toBe(50);
    expect(doc.artboards[0].height).toBe(40);
  });

  it('sizes from content when there is no size at all', async () => {
    const { doc } = await svgFrom(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="20" height="30"/></svg>',
    );
    expect(doc.artboards[0].width).toBe(25);
    expect(doc.artboards[0].height).toBe(35);
  });

  it('applies nested transforms and display/visibility', async () => {
    const { doc } = await svgFrom(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g transform="translate(10 0)"><g transform="scale(2)"><rect x="1" y="1" width="5" height="5"/></g></g><rect display="none" width="1" height="1"/><rect visibility="hidden" width="2" height="2"/></svg>',
    );
    const s = summarize(doc);
    expect(s).toHaveLength(2);
    expect(expectBoundsClose(s[0].bounds, [12, 2, 10, 10], 1e-6)).toBe(true);
    expect(all(doc).find((n) => n.type === 'rect' && n.width === 2)!.visible).toBe(false);
  });

  it('rejects broken files with a clear message', async () => {
    await expect(svgFrom('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>')).rejects.toThrow(
      /could not be read/,
    );
  });
});

describe('SVG export', () => {
  it('writes attributes, gradients, dashes and opacity', async () => {
    const doc = sampleDoc();
    const warnings: string[] = [];
    const svg = await exportSvgString(
      doc,
      { kind: 'artboard', id: doc.artboards[0].id },
      {},
      ctxFor(doc, warnings),
    );
    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toContain('width="400" height="300" viewBox="0 0 400 300"');
    expect(svg).toContain('<linearGradient id="cs-grad');
    expect(svg).toContain('gradientUnits="userSpaceOnUse"');
    expect(svg).toContain('stroke-dasharray="6 3"');
    expect(svg).toContain('id="Card"');
    expect(svg).toContain('opacity="0.8"');
    expect(svg).toContain('<text');
    expect(svg).toContain('<image');
    // The document is well-formed.
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  it('supports inline CSS, classes, minify, responsive and background options', () => {
    const doc = sampleDoc();
    const scope = { kind: 'artboard' as const, id: doc.artboards[0].id };
    const ctx = ctxFor(doc);
    const inline = buildSvg(doc, scope, ctx, { styling: 'inline' });
    expect(inline).toMatch(/style="fill:#2b5f6b"/);
    const classes = buildSvg(doc, scope, ctx, { styling: 'classes' });
    expect(classes).toMatch(/<style>[^<]*\.c1\{/);
    expect(classes).toMatch(/class="c\d+"/);
    const min = buildSvg(doc, scope, ctx, {
      minify: true,
      responsive: true,
      background: true,
      layerIds: false,
    });
    expect(min).not.toContain('\n');
    expect(min).not.toMatch(/<svg[^>]* width=/);
    expect(min).toContain('<rect width="400" height="300" fill="#ffffff"/>');
    expect(min).not.toContain('id="Card"');
    expect(min.length).toBeLessThan(buildSvg(doc, scope, ctx, {}).length);
  });

  it('honours decimal places', () => {
    const doc = createDocument({ width: 10, height: 10, units: 'px' });
    doc.artboards[0].children = [makeRect(1.23456, 0, 1, 1)];
    const ctx = ctxFor(doc);
    expect(buildSvg(doc, { kind: 'all' }, ctx, { decimals: 1 })).toContain('translate(1.2 0)');
    expect(buildSvg(doc, { kind: 'all' }, ctx, { decimals: 3 })).toContain('translate(1.235 0)');
  });

  it('mirrors paint semantics: inside/outside strokes, shadows, blur, blend, profiles, arrows', () => {
    const doc = createDocument({ width: 200, height: 200, units: 'px' });
    const r = makeRect(10, 10, 50, 50);
    const st = r.appearance.items[1];
    if (st.kind === 'stroke') {
      st.align = 'inside';
      st.blend = 'multiply';
    }
    r.appearance.items.push(
      {
        kind: 'effect',
        id: 'e1',
        visible: true,
        effect: { type: 'dropShadow', x: 2, y: 4, blur: 6, color: rgb(0, 0, 0, 0.3) },
      },
      {
        kind: 'effect',
        id: 'e2',
        visible: true,
        effect: { type: 'innerShadow', x: 0, y: 2, blur: 4, color: rgb(0, 0, 0, 0.5) },
      },
      { kind: 'effect', id: 'e3', visible: true, effect: { type: 'blur', radius: 3 } },
    );
    const r2 = makeRect(100, 10, 50, 50);
    const s2 = r2.appearance.items[1];
    if (s2.kind === 'stroke') s2.align = 'outside';
    const line = makeRect(0, 0, 1, 1);
    const p = {
      ...line,
      type: 'path',
      subpaths: [
        {
          closed: false,
          nodes: [
            { x: 0, y: 100, in: null, out: null, kind: 'sharp' },
            { x: 100, y: 150, in: null, out: null, kind: 'sharp' },
          ],
        },
      ],
      fillRule: 'nonzero',
    } as unknown as SceneNode;
    const ps = p.appearance.items[1];
    if (ps.kind === 'stroke') {
      ps.profile = [
        [0, 0.1],
        [0.5, 1],
        [1, 0.1],
      ];
      ps.arrowEnd = 'triangle';
    }
    p.blend = 'screen';
    doc.artboards[0].children = [r, r2, p];
    const svg = buildSvg(doc, { kind: 'all' }, ctxFor(doc), {});
    expect(svg).toMatch(/<clipPath id="cs-clip\d+">\s*<rect width="50" height="50"\/>\s*<\/clipPath>/);
    expect(svg).toMatch(/stroke-width="2"/);
    expect(svg).toContain('<mask id="cs-mask');
    expect(svg).toContain('<feOffset dx="2" dy="4"');
    expect(svg).toContain('operator="arithmetic"');
    expect(svg).toContain('<feGaussianBlur stdDeviation="3"/>');
    expect(svg).toContain('mix-blend-mode:multiply');
    expect(svg).toContain('mix-blend-mode:screen');
    // Profile outline + arrowhead → fills, no plain stroke on the path.
    const pathEls = svg.match(/<path [^>]*\/>/g) ?? [];
    expect(pathEls.filter((e) => e.includes('fill="#1a1820"')).length).toBeGreaterThanOrEqual(2);
  });

  it('converts text to outlines when the font is available', async () => {
    const doc = createDocument({ width: 200, height: 100, units: 'px' });
    doc.artboards[0].children = [makeText(10, 10, 'Hi')];
    const svg = await exportSvgString(doc, { kind: 'all' }, { text: 'outlines' }, ctxFor(doc));
    expect(svg).not.toContain('<text');
    expect(svg).toMatch(/ d="M[^"]+Z/);
  });

  it('writes all artboards side by side and the selection tightly', () => {
    const doc = sampleDoc();
    const second = {
      ...doc.artboards[0],
      id: 'ab_2',
      name: 'Back',
      x: 500,
      children: [makeRect(0, 0, 10, 10)],
    };
    doc.artboards.push(second);
    const svg = buildSvg(doc, { kind: 'all' }, ctxFor(doc), {});
    expect(svg).toContain('viewBox="0 0 900 300"');
    expect(svg).toContain('<g id="Poster">');
    expect(svg).toContain('<g id="Back" transform="translate(500 0)">');
    const card = doc.artboards[0].children[0];
    const sel = buildSvg(doc, { kind: 'selection', ids: [card.id] }, ctxFor(doc), {});
    expect(sel).toContain('viewBox="0 0 120 80"');
  });

  it('prints artboards with sizes in points', () => {
    const doc = sampleDoc();
    const s = artboardToSvgString(doc, doc.artboards[0].id);
    expect(s).toContain('width="400pt" height="300pt"');
    expect(s).toContain('fill="#ffffff"');
  });

  it('round-trips: fixture → import → export → import keeps objects, bounds and colors', async () => {
    const first = await importSvg(fixture('svg/features.svg'), { fileName: 'features.svg' });
    const out = await exportSvgString(first.doc, { kind: 'all' }, {}, ctxFor(first.doc));
    const second = await importSvg(utf8(out), { fileName: 'again.svg' });
    const a = summarize(first.doc);
    const b = summarize(second.doc);
    expect(b.map((x) => x.type)).toEqual(a.map((x) => x.type));
    a.forEach((x, i) => {
      expect(
        expectBoundsClose(x.bounds, b[i].bounds, 0.05),
        `${x.name} ${JSON.stringify(x.bounds)} vs ${JSON.stringify(b[i].bounds)}`,
      ).toBe(true);
      expect(b[i].colors).toEqual(x.colors);
    });
    expect(second.doc.artboards[0].width).toBeCloseTo(first.doc.artboards[0].width, 2);
  });

  it('round-trips a native document through SVG', async () => {
    const doc = sampleDoc();
    const out = await exportSvgString(doc, { kind: 'all' }, { decimals: 3 }, ctxFor(doc));
    const back = await importSvg(utf8(out), { fileName: 'x.svg' });
    const a = summarize(doc);
    const b = summarize(back.doc);
    // Stars have no SVG element: they come back as paths.
    expect(b.map((x) => x.type)).toEqual(a.map((x) => (x.type === 'star' ? 'path' : x.type)));
    a.forEach((x, i) => {
      if (x.type !== 'text') expect(expectBoundsClose(x.bounds, b[i].bounds, 0.05), x.name).toBe(true);
      expect(b[i].colors).toEqual(x.colors);
    });
  });
});

/// <reference types="node" />
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as opentype from 'opentype.js';
import type { Subpath } from '../../../src/core/types';
import { commandsToSubpaths, textToSubpaths, type OtFont } from '../../../src/fonts/outline';
import { textNode } from './helpers';

const bytes = readFileSync(resolve(process.cwd(), 'tests/fixtures/fonts/geist-latin-400-normal.ttf'));
let font: OtFont;

beforeAll(() => {
  const ot = (
    (opentype as unknown as { parse?: unknown }).parse
      ? opentype
      : (opentype as unknown as { default: unknown }).default
  ) as {
    parse(b: ArrayBuffer): OtFont;
  };
  font = ot.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
});

function bounds(sps: Subpath[]) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const sp of sps)
    for (const n of sp.nodes) {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x);
      y1 = Math.max(y1, n.y);
    }
  return { x0, y0, x1, y1 };
}

describe('commandsToSubpaths', () => {
  it('converts lines, cubics and quads (to cubics) and merges the closing node', () => {
    const sps = commandsToSubpaths([
      { type: 'M', x: 0, y: 0 },
      { type: 'L', x: 10, y: 0 },
      { type: 'Q', x1: 10, y1: 10, x: 0, y: 10 },
      { type: 'C', x1: -5, y1: 10, x2: -5, y2: 0, x: 0, y: 0 },
      { type: 'Z' },
      { type: 'M', x: 50, y: 50 },
      { type: 'L', x: 60, y: 60 },
    ]);
    expect(sps).toHaveLength(2);
    const [a, b] = sps;
    expect(a.closed).toBe(true);
    expect(a.nodes.map((n) => [n.x, n.y])).toEqual([
      [0, 0],
      [10, 0],
      [0, 10],
    ]);
    // Quad (10,0)-(10,10)-(0,10): control points at 2/3 toward the quad control.
    expect(a.nodes[1].out![0]).toBeCloseTo(10);
    expect(a.nodes[1].out![1]).toBeCloseTo(20 / 3);
    expect(a.nodes[2].in![0]).toBeCloseTo(20 / 3);
    expect(a.nodes[2].in![1]).toBeCloseTo(10);
    expect(a.nodes[2].out).toEqual([-5, 10]);
    // The cubic's end handle moved onto the first node when the duplicate closing node merged.
    expect(a.nodes[0].in).toEqual([-5, 0]);
    expect(b.closed).toBe(false);
    expect(b.nodes).toHaveLength(2);
  });
});

describe('textToSubpaths', () => {
  it('outlines glyphs at the layout baseline with bounds near the font size', () => {
    const node = textNode('HH');
    const sps = textToSubpaths(node, font);
    expect(sps.length).toBeGreaterThanOrEqual(2);
    expect(sps.every((s) => s.closed && s.nodes.length >= 3)).toBe(true);
    const b = bounds(sps);
    // Cap height of Geist is ~0.7 em; size 100, baseline at layout ascent (80 + 10).
    const capH = b.y1 - b.y0;
    expect(capH).toBeGreaterThan(60);
    expect(capH).toBeLessThan(85);
    expect(b.y1).toBeCloseTo(90, 0);
    expect(b.x0).toBeGreaterThanOrEqual(0);
    expect(b.x1).toBeLessThan(200);
  });

  it('glyphs with curves get cubic handles', () => {
    const sps = textToSubpaths(textNode('o'), font);
    expect(sps.some((s) => s.nodes.some((n) => n.in || n.out))).toBe(true);
  });

  it('tracking widens the outline', () => {
    const plain = bounds(textToSubpaths(textNode('HHHH'), font));
    const loose = bounds(textToSubpaths(textNode('HHHH', {}, { tracking: 200 }), font));
    // 3 gaps × 0.2 em × 100.
    expect(loose.x1 - loose.x0 - (plain.x1 - plain.x0)).toBeCloseTo(60, 0);
  });

  it('alignment shifts lines horizontally', () => {
    const area = { mode: 'area' as const, box: { width: 1000, height: 200 } };
    const left = bounds(
      textToSubpaths(textNode('Hi', { ...area, paragraph: { align: 'left', indent: 0 } }), font),
    );
    const center = bounds(
      textToSubpaths(textNode('Hi', { ...area, paragraph: { align: 'center', indent: 0 } }), font),
    );
    const right = bounds(
      textToSubpaths(textNode('Hi', { ...area, paragraph: { align: 'right', indent: 0 } }), font),
    );
    const w = left.x1 - left.x0;
    expect(center.x0).toBeGreaterThan(left.x0 + 300);
    expect(right.x0).toBeGreaterThan(center.x0 + 300);
    expect(right.x1).toBeLessThanOrEqual(1000);
    expect(right.x1).toBeGreaterThan(1000 - 20);
    expect((center.x0 + center.x1) / 2).toBeCloseTo(500, -1);
    expect(center.x1 - center.x0).toBeCloseTo(w, 3);
  });

  it('multiple lines stack by line height', () => {
    const sps = textToSubpaths(textNode('H\nH'), font);
    const ys = sps.map((s) => bounds([s]).y1).sort((a, b) => a - b);
    expect(ys[ys.length - 1] - ys[0]).toBeCloseTo(120, 0);
  });

  it('kerning changes advance for kerned pairs', () => {
    const kerned = font.getAdvanceWidth('AV', 100, { kerning: true });
    const unkerned = font.getAdvanceWidth('AV', 100, { kerning: false });
    expect(kerned).toBeLessThanOrEqual(unkerned);
  });
});

describe('outlineText', () => {
  afterEach(() => {
    vi.doUnmock('../../../src/fonts/loader');
    vi.resetModules();
  });

  it('parses bytes from the loader and caches the parsed font', async () => {
    vi.resetModules();
    const getFontBytes = vi.fn(async () => new Uint8Array(bytes));
    vi.doMock('../../../src/fonts/loader', () => ({ getFontBytes, onFontLoaded: () => () => undefined }));
    const { outlineText } = await import('../../../src/fonts/outline');
    const a = await outlineText(textNode('Hello'));
    const b = await outlineText(textNode('World'));
    expect(a!.length).toBeGreaterThan(4);
    expect(b!.length).toBeGreaterThan(4);
    expect(getFontBytes).toHaveBeenCalledTimes(1);
  });

  it('returns null when the face is unavailable', async () => {
    vi.resetModules();
    vi.doMock('../../../src/fonts/loader', () => ({
      getFontBytes: async () => null,
      onFontLoaded: () => () => undefined,
    }));
    const { outlineText } = await import('../../../src/fonts/outline');
    expect(await outlineText(textNode('Hello'))).toBeNull();
  });
});

describe('installCanvasMeasurer', () => {
  it('returns false without a 2D context and keeps the estimate', async () => {
    vi.resetModules();
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { installCanvasMeasurer } = await import('../../../src/fonts/outline');
    expect(installCanvasMeasurer()).toBe(false);
    spy.mockRestore();
  });

  it('measures with the canvas and adds tracking between characters', async () => {
    vi.resetModules();
    const ctx = { font: '', measureText: (t: string) => ({ width: t.length * 10 }) };
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const { installCanvasMeasurer } = await import('../../../src/fonts/outline');
    const text = await import('../../../src/core/text');
    expect(installCanvasMeasurer()).toBe(true);
    const r = textNode('abcd', {}, { size: 20, tracking: 100 }).runs[0];
    expect(text.measureText('abcd', r)).toBeCloseTo(40 + 3 * 2);
    expect(ctx.font).toBe('400 20px "Geist"');
    spy.mockRestore();
  });
});

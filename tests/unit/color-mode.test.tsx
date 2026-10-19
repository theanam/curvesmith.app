import { describe, expect, it } from 'vitest';
import {
  cmyk,
  colorForMode,
  convertDocumentColors,
  hexToColor,
  resolveCmyk,
  resolveColor,
  rgb,
} from '../../src/core/color';
import { createDocument, makeFill, makeRect } from '../../src/core/document';
import type { CurvsDocument, FillItem } from '../../src/core/types';
import { readCurvs, writeCurvs } from '../../src/formats/curvs';
import { setColorMode } from '../../src/state/actions';
import { activeDoc, undo } from '../../src/state/store';
import { createFromPreset, PRESETS } from '../../src/ui/home/Home';
import { children, freshDoc } from './helpers';

function docWithColors(): CurvsDocument {
  const doc = createDocument({ width: 100, height: 100, units: 'mm' });
  const a = makeRect(0, 0, 10, 10, { items: [makeFill(rgb(1, 0, 0))] });
  const b = makeRect(0, 0, 10, 10);
  b.appearance.items = [
    {
      kind: 'fill',
      id: 'g',
      visible: true,
      opacity: 1,
      blend: 'normal',
      paint: {
        type: 'linear',
        from: [0, 0],
        to: [1, 0],
        stops: [
          { offset: 0, color: rgb(0, 0, 1) },
          { offset: 1, color: { swatch: 'sw1' } },
        ],
      },
    },
  ];
  doc.swatches = [{ id: 'sw1', name: 'Brand', color: hexToColor('#16C75B')!, global: true } as never];
  doc.artboards[0].children = [a, b];
  return doc;
}

describe('color modes', () => {
  it('converts colors without changing how they look, and keeps exact inks', () => {
    const c = cmyk(0.6, 0.4, 0.4, 1);
    expect(resolveCmyk(c)).toBe(c);
    expect(colorForMode(rgb(0.2, 0.4, 0.6), 'cmyk')).toMatchObject({ space: 'cmyk' });
    const back = resolveColor(colorForMode(rgb(0.2, 0.4, 0.6), 'cmyk'));
    expect(back.r).toBeCloseTo(0.2);
    expect(back.g).toBeCloseTo(0.4);
    expect(back.b).toBeCloseTo(0.6);
    expect(colorForMode({ swatch: 'x' }, 'cmyk')).toEqual({ swatch: 'x' });
  });

  it('converts every color in a document, both ways', () => {
    const doc = docWithColors();
    convertDocumentColors(doc, 'cmyk');
    expect(doc.colorProfile).toBe('cmyk');
    const [a, b] = doc.artboards[0].children;
    expect((a.appearance.items[0] as FillItem).paint).toMatchObject({
      color: { space: 'cmyk', c: 0, m: 1, y: 1, k: 0 },
    });
    const g = (b.appearance.items[0] as FillItem).paint as Extract<FillItem['paint'], { stops: unknown }>;
    expect(g.stops[0].color).toMatchObject({ space: 'cmyk' });
    expect(g.stops[1].color).toEqual({ swatch: 'sw1' });
    expect(doc.swatches[0].color).toMatchObject({ space: 'cmyk' });
    expect(doc.artboards[0].background).toMatchObject({ space: 'cmyk', k: 0 });
    convertDocumentColors(doc, 'srgb');
    expect((a.appearance.items[0] as FillItem).paint).toMatchObject({
      color: { space: 'srgb', r: 1, g: 0, b: 0 },
    });
  });

  it('switches mode as one undo step', () => {
    freshDoc();
    setColorMode('cmyk');
    expect(activeDoc()!.doc.colorProfile).toBe('cmyk');
    expect(activeDoc()!.doc.artboards[0].background).toMatchObject({ space: 'cmyk' });
    undo();
    expect(activeDoc()!.doc.colorProfile).toBe('srgb');
    expect(children()).toEqual([]);
  });

  it('saves the mode in .curvs files', async () => {
    const doc = docWithColors();
    convertDocumentColors(doc, 'cmyk');
    const back = await readCurvs(await writeCurvs(doc));
    expect(back.colorProfile).toBe('cmyk');
  });

  it('starts print sizes in CMYK and screen sizes in RGB', () => {
    createFromPreset(PRESETS.find((p) => p.id === 'a4')!);
    expect(activeDoc()!.doc.colorProfile).toBe('cmyk');
    createFromPreset(PRESETS.find((p) => p.id === 'social')!);
    expect(activeDoc()!.doc.colorProfile).toBe('srgb');
  });
});

describe('color mode UI', () => {
  it('switches the document from the inspector and shows it in the status bar', async () => {
    const { render, screen, fireEvent } = await import('@testing-library/react');
    const T = await import('@radix-ui/react-tooltip');
    const { DesignTab } = await import('../../src/ui/inspector/Design');
    const { StatusBar } = await import('../../src/ui/shell/StatusBar');
    freshDoc();
    render(
      <T.Provider>
        <DesignTab />
        <StatusBar />
      </T.Provider>,
    );
    expect(screen.getByText('RGB · sRGB')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'CMYK' }));
    expect(activeDoc()!.doc.colorProfile).toBe('cmyk');
    expect(screen.queryByText('RGB · sRGB')).toBeNull();
    expect(screen.getAllByText('CMYK')).toHaveLength(2);
  });

  it('edits exact ink values in a CMYK document', async () => {
    const { render, screen, fireEvent } = await import('@testing-library/react');
    const T = await import('@radix-ui/react-tooltip');
    const { ColorPicker } = await import('../../src/ui/inspector/ColorPicker');
    freshDoc();
    setColorMode('cmyk');
    const seen: unknown[] = [];
    render(
      <T.Provider>
        <ColorPicker value={cmyk(0.6, 0.4, 0.4, 1)} onChange={(c) => seen.push(c)} />
      </T.Provider>,
    );
    expect(screen.getByRole('combobox', { name: 'Color model' })).toHaveValue('cmyk');
    expect(screen.getByRole('textbox', { name: 'C' })).toHaveValue('60');
    const k = screen.getByRole('textbox', { name: 'K' });
    fireEvent.change(k, { target: { value: '90' } });
    fireEvent.blur(k);
    expect(seen.at(-1)).toEqual(cmyk(0.6, 0.4, 0.4, 0.9));
    fireEvent.click(screen.getByRole('button', { name: '#E5484D' }));
    expect(seen.at(-1)).toMatchObject({ space: 'cmyk' });
  });
});

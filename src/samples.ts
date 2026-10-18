/* Starter documents shown under Libraries (and used for screenshots). Built in code so they always match the model. */
import type { CurvsDocument, SceneNode } from './core/types';
import {
  createDocument,
  makeEllipse,
  makeGroup,
  makePath,
  makeRect,
  makeStar,
  makeText,
  makeFill,
  makeStroke,
} from './core/document';
import { parsePathData } from './core/geometry/pathdata';
import { transformSubpath } from './core/geometry/bezier';
import { hexToColor } from './core/color';
import { toPt } from './core/units';
import { uniformCorners } from './core/geometry/shapes';
import { newId } from './core/id';

const hex = (h: string) => hexToColor(h)!;

export function lowTidePoster(): CurvsDocument {
  const W = toPt(420, 'mm');
  const H = toPt(594, 'mm');
  const doc = createDocument({ name: 'Poster A2', width: W, height: H, units: 'mm' });
  const k = W / 400; // the design was drawn on a 400-unit-wide grid
  const sw = (id: string, name: string, h: string) => ({ id, name, color: hex(h), global: true });
  doc.swatches = [
    sw('sw_sand', 'Sand', '#F1E4CF'),
    sw('sw_sun', 'Sun', '#F0843A'),
    sw('sw_teal', 'Shallow', '#3E7B84'),
    sw('sw_deep', 'Deep teal', '#2B5F6B'),
    sw('sw_ink', 'Ink', '#1A1820'),
  ];
  const fill = (swatch: string) => ({
    items: [{ ...makeFill(), paint: { type: 'solid' as const, color: { swatch } } }],
  });
  const wave = (d: string, name: string, swatch: string) => {
    const p = makePath(
      parsePathData(d).map((s) => transformSubpath(s, [k, 0, 0, k, 0, 0])),
      fill(swatch),
      name,
    );
    return p;
  };
  const bg = makeRect(0, 0, W, H, fill('sw_sand'));
  bg.name = 'Background';
  bg.locked = true;
  const sun = makeEllipse(270 * k, 170 * k, 92 * k, 92 * k, fill('sw_sun'));
  sun.name = 'Sun';
  const waves = makeGroup(
    [
      wave('M0 295C70 268 150 322 220 300C290 278 330 266 400 300V566H0Z', 'Wave 1', 'sw_teal'),
      wave('M0 360C70 320 140 400 210 360C280 320 330 330 400 360V566H0Z', 'Wave 2', 'sw_deep'),
      wave('M0 430C80 405 160 452 240 425C310 402 360 418 400 440V566H0Z', 'Wave 3', 'sw_ink'),
    ],
    'Waves',
  );
  const number = makeText(28 * k, 33 * k, 'NO. 07');
  number.runs[0] = {
    ...number.runs[0],
    font: { family: 'Geist Mono', weight: 500, style: 'normal' },
    size: 12 * k,
  };
  number.appearance = fill('sw_ink');
  number.name = 'Issue';
  const title = makeText(26 * k, 462 * k, 'Low Tide');
  title.runs[0] = {
    ...title.runs[0],
    font: { family: 'Bricolage Grotesque', weight: 700, style: 'normal' },
    size: 54 * k,
    tracking: -30,
    leading: 1,
  };
  title.appearance = { items: [{ ...makeFill(hex('#F6F4EF')) }] };
  title.name = 'Title';
  const sub = makeText(28 * k, 528 * k, 'Field recordings · Vol. 2');
  sub.runs[0] = { ...sub.runs[0], size: 13 * k };
  sub.appearance = { items: [{ ...makeFill(hex('#F6F4EF')) }] };
  sub.name = 'Subtitle';
  doc.artboards[0].children = [bg, sun, waves, number, makeGroup([title, sub], 'Title block')];
  doc.artboards[0].name = 'Poster A2';
  return doc;
}

export function logoExplorations(): CurvsDocument {
  const doc = createDocument({ name: 'Logo explorations', width: 1200, height: 800, units: 'px' });
  const ab = doc.artboards[0];
  ab.background = hex('#ECE9E4');
  const ink = hex('#1A1820');
  const disc = makeEllipse(300, 400, 110, 110, { items: [makeFill(ink)] });
  disc.name = 'Mark A';
  const tri = makeStar(300, 410, 52, 3, true, { items: [makeFill(hex('#F6F4EF'))] });
  tri.rounding = 0.12;
  tri.name = 'Peak';
  const tile = makeRect(500, 290, 220, 220, { items: [makeFill(hex('#2B5F6B'))] });
  tile.corners = uniformCorners(44);
  tile.name = 'Mark B';
  const arch = makePath(
    parsePathData('M560 460C560 330 660 330 660 460'),
    { items: [makeStroke(hex('#F1E4CF'), 22)] },
    'Arch',
  );
  (arch.appearance.items[0] as { cap: string }).cap = 'round';
  const diamond = makeRect(-90, -90, 180, 180, { items: [makeFill(hex('#16C75B'))] });
  diamond.transform = [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 930, 400];
  diamond.name = 'Mark C';
  ab.children = [makeGroup([disc, tri], 'Mark A'), makeGroup([tile, arch], 'Mark B'), diamond];
  return doc;
}

export function iconSet(): CurvsDocument {
  const doc = createDocument({ name: 'Icons', width: 960, height: 480, units: 'px' });
  const ab = doc.artboards[0];
  ab.background = hex('#ECE9E4');
  const icons = [
    'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
    'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M20 20l-4.8-4.8',
    'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
    'M3 6h18v12H3zM3 7l9 6 9-6',
    'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2',
    'M12 5v14M5 12h14',
    'M5 12l5 5L20 7',
    'M6 6l12 12M18 6L6 18',
  ];
  const nodes: SceneNode[] = icons.map((d, i) => {
    const s = 6;
    const x = 120 + (i % 4) * 220;
    const y = 120 + Math.floor(i / 4) * 200;
    const st = makeStroke(hex('#1A1820'), 1.6 * s);
    st.cap = 'round';
    st.join = 'round';
    const p = makePath(
      parsePathData(d).map((sp) => transformSubpath(sp, [s, 0, 0, s, x - 12 * s + 60, y - 12 * s + 60])),
      { items: [st] },
      `Icon ${i + 1}`,
    );
    p.id = newId('nd');
    return p;
  });
  ab.children = nodes;
  return doc;
}

export const SAMPLES = [
  { id: 'low-tide', name: 'Low Tide poster', make: lowTidePoster, desc: 'Poster · global colors · groups' },
  {
    id: 'logos',
    name: 'Logo explorations',
    make: logoExplorations,
    desc: 'Shapes · rounded corners · rotation',
  },
  { id: 'icons', name: 'Icon set', make: iconSet, desc: 'Stroked paths · round caps' },
];

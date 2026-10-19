import { describe, expect, it } from 'vitest';
import type { CurvsDocument, ImageNode } from '../../src/core/types';
import { createDocument, makeFill, makeStroke } from '../../src/core/document';
import { imageLayers } from '../../src/core/image';
import { hexToColor } from '../../src/core/color';
import { buildSvg } from '../../src/formats/svg/export';
import { flattenPage } from '../../src/formats/shared/scene';
import { pagesForScope } from '../../src/formats/shared/pages';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DwnwEIGBj+MzAwAAA4BwH/2hk1tQAAAABJRU5ErkJggg==';

function docWithImage(): { doc: CurvsDocument; img: ImageNode } {
  const doc = createDocument({ width: 200, height: 200, units: 'pt' });
  const img: ImageNode = {
    id: 'nd_img',
    name: 'Photo',
    visible: true,
    locked: false,
    opacity: 1,
    blend: 'normal',
    transform: [1, 0, 0, 1, 20, 20],
    appearance: {
      items: [
        makeFill(hexToColor('#ffffff')!),
        makeStroke(hexToColor('#e5484d')!, 8),
        {
          kind: 'effect',
          id: 'e',
          visible: true,
          effect: { type: 'dropShadow', x: 0, y: 4, blur: 8, color: hexToColor('#000000')! },
        },
      ],
    },
    type: 'image',
    asset: 'assets/a.png',
    width: 100,
    height: 80,
  };
  doc.assets['assets/a.png'] = PNG;
  doc.artboards[0].children.push(img);
  return { doc, img };
}

describe('image appearance', () => {
  it('splits the stack around the bitmap', () => {
    const { img } = docWithImage();
    const { below, above } = imageLayers(img);
    expect(below.map((i) => i.kind)).toEqual(['fill', 'effect']);
    expect(above.map((i) => i.kind)).toEqual(['stroke']);
  });

  it('SVG export paints fill, then the image, then the stroke', () => {
    const { doc } = docWithImage();
    const svg = buildSvg(
      doc,
      { kind: 'all' },
      { activeArtboard: doc.artboards[0].id, name: 't' },
      { minify: true },
    );
    const iImage = svg.indexOf('<image');
    const iStroke = svg.search(/stroke="#e5484d"/i);
    const iFill = svg.search(/fill="#fff(fff)?"/i);
    expect(iImage).toBeGreaterThan(-1);
    expect(iStroke).toBeGreaterThan(iImage);
    expect(iFill).toBeGreaterThan(-1);
    expect(iFill).toBeLessThan(iImage);
    expect(svg).toMatch(/stroke-width="8"/);
  });

  it('PDF, EPS and EMF ops put the stroke after the image', () => {
    const { doc } = docWithImage();
    const page = pagesForScope(
      doc,
      { kind: 'all' },
      { activeArtboard: doc.artboards[0].id, name: 't' },
      true,
    )[0];
    const ops = flattenPage(page, { doc, warn: () => undefined, textOutlines: false }).map((o) => o.op);
    const img = ops.indexOf('image');
    expect(img).toBeGreaterThan(-1);
    expect(ops.slice(0, img)).toContain('fill');
    expect(ops.slice(img + 1)).toContain('stroke');
  });

  it('an image without appearance exports as just the image', () => {
    const { doc, img } = docWithImage();
    img.appearance = { items: [] };
    const svg = buildSvg(
      doc,
      { kind: 'all' },
      { activeArtboard: doc.artboards[0].id, name: 't' },
      { minify: true },
    );
    expect(svg).toContain('<image');
    expect(svg).not.toMatch(/<(path|rect)[^>]*fill="none"/);
  });
});

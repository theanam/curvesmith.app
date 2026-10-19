/* EPS writer: hand-written PostScript (level 3 for gradients via shfill). One page; scope "all" places every
   artboard side by side. Content is drawn in a y-down frame set up once (`0 H translate 1 -1 scale`).
   PostScript has no transparency or blend modes: objects are drawn opaque and the export says so. */
import type { CurvsDocument, ExportScope, Matrix, Paint, Subpath } from '../../core/types';
import { resolveColor } from '../../core/color';
import { subpathsBounds } from '../../core/geometry/bezier';
import { layoutText, primaryRun } from '../../core/text';
import { type ExportContext, warner } from '../types';
import type { EpsExportOptions } from '../registry';
import { pagesForScope } from '../shared/pages';
import {
  collectText,
  deviceComponents,
  deviceSpace,
  flattenPage,
  pathSegments,
  resolvedStops,
  type DrawOp,
} from '../shared/scene';
import { loadFonts } from '../shared/fonts';
import { dataUrlToBytes, jpegComponents, readImageSize, sniffImageMime } from '../shared/bytes';
import { decodePng } from '../shared/png';
import { BLEED_PT } from '../pdf/export';

const MARK_MARGIN = 20;

const n = (v: number) => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};
const mat = (m: Matrix) => `[${m.map(n).join(' ')}]`;

const psString = (s: string) =>
  '(' +
  [...s]
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if (ch === '(' || ch === ')' || ch === '\\') return '\\' + ch;
      if (c < 32 || c > 126) return '?';
      return ch;
    })
    .join('') +
  ')';

function hexLines(bytes: Uint8Array, out: string[]) {
  const HEX = '0123456789abcdef';
  for (let i = 0; i < bytes.length; i += 36) {
    let line = '';
    for (let j = i; j < Math.min(bytes.length, i + 36); j++) line += HEX[bytes[j] >> 4] + HEX[bytes[j] & 15];
    out.push(line);
  }
  out.push('>');
}

class EpsWriter {
  out: string[] = [];
  constructor(
    private doc: CurvsDocument,
    private warn: (m: string) => void,
  ) {}

  path(subpaths: Subpath[]) {
    const parts: string[] = [];
    for (const s of pathSegments(subpaths)) {
      if (s.t === 'M') parts.push(`${n(s.p[0])} ${n(s.p[1])} m`);
      else if (s.t === 'L') parts.push(`${n(s.p[0])} ${n(s.p[1])} l`);
      else if (s.t === 'C')
        parts.push(`${n(s.c1[0])} ${n(s.c1[1])} ${n(s.c2[0])} ${n(s.c2[1])} ${n(s.p[0])} ${n(s.p[1])} c`);
      else parts.push('h');
    }
    for (let i = 0; i < parts.length; i += 6) this.out.push(parts.slice(i, i + 6).join(' '));
  }

  shading(p: Extract<Paint, { stops: unknown }>): string {
    const stops = resolvedStops(p, this.doc);
    const c = (s: (typeof stops)[number]) => `[${s.components.map(n).join(' ')}]`;
    const fn = (a: (typeof stops)[number], b: (typeof stops)[number]) =>
      `<< /FunctionType 2 /Domain [0 1] /C0 ${c(a)} /C1 ${c(b)} /N 1 >>`;
    let func: string;
    if (stops.length === 2) func = fn(stops[0], stops[1]);
    else {
      const fns: string[] = [];
      const bounds: string[] = [];
      const enc: string[] = [];
      for (let i = 0; i < stops.length - 1; i++) {
        fns.push(fn(stops[i], stops[i + 1]));
        if (i > 0) bounds.push(n(stops[i].offset));
        enc.push('0 1');
      }
      func = `<< /FunctionType 3 /Domain [0 1] /Functions [${fns.join(' ')}] /Bounds [${bounds.join(' ')}] /Encode [${enc.join(' ')}] >>`;
    }
    const [fx, fy] = p.from;
    const [tx, ty] = p.to;
    if (p.type === 'conic') this.warn('Conic gradients were saved as linear gradients.');
    const coords =
      p.type === 'radial'
        ? `[${n(fx)} ${n(fy)} 0 ${n(fx)} ${n(fy)} ${n(Math.hypot(tx - fx, ty - fy) || 1)}]`
        : `[${n(fx)} ${n(fy)} ${n(tx)} ${n(ty)}]`;
    return `<< /ShadingType ${p.type === 'radial' ? 3 : 2} /ColorSpace /${deviceSpace(this.doc)} /Coords ${coords} /Extend [true true] /Function ${func} >> shfill`;
  }

  color(p: Paint) {
    const v = deviceComponents(p.type === 'solid' ? p.color : p.stops[0].color, this.doc);
    this.out.push(`${v.map(n).join(' ')} ${v.length === 4 ? 'setcmykcolor' : 'setrgbcolor'}`);
  }

  checkAlpha(p: Paint, opacity: number, blend: string) {
    const alpha = p.type === 'solid' ? resolveColor(p.color, this.doc.swatches).a : 1;
    if (alpha * opacity < 0.999)
      this.warn('EPS has no transparency, so see-through objects were drawn opaque.');
    if (blend !== 'normal') this.warn('Blend modes were dropped.');
  }

  draw(o: DrawOp) {
    switch (o.op) {
      case 'fill': {
        if (!o.subpaths.length) return;
        this.checkAlpha(o.paint, o.opacity, o.blend);
        this.out.push('gsave', `${mat(o.m)} concat`);
        this.path(o.subpaths);
        if (o.paint.type === 'solid') {
          this.color(o.paint);
          this.out.push(o.evenOdd ? 'f*' : 'f');
        } else this.out.push(`${o.evenOdd ? 'W*' : 'W'} n`, this.shading(o.paint));
        this.out.push('grestore');
        return;
      }
      case 'stroke': {
        if (!o.subpaths.length) return;
        this.checkAlpha(o.paint, o.opacity, o.blend);
        this.out.push('gsave', `${mat(o.m)} concat`);
        let width = o.width;
        if (o.align !== 'center') {
          if (o.align === 'outside') {
            const b = subpathsBounds(o.subpaths) ?? { x: 0, y: 0, width: 0, height: 0 };
            const pad = o.width * 4 + 1000;
            this.out.push(
              `${n(b.x - pad)} ${n(b.y - pad)} m ${n(b.x + b.width + pad)} ${n(b.y - pad)} l ${n(b.x + b.width + pad)} ${n(b.y + b.height + pad)} l ${n(b.x - pad)} ${n(b.y + b.height + pad)} l h`,
            );
          }
          this.path(o.subpaths);
          this.out.push(`${o.align === 'outside' || o.evenOdd ? 'W*' : 'W'} n`);
          width *= 2;
        }
        this.out.push(
          `${n(width)} setlinewidth ${o.cap === 'round' ? 1 : o.cap === 'square' ? 2 : 0} setlinecap ${o.join === 'round' ? 1 : o.join === 'bevel' ? 2 : 0} setlinejoin`,
        );
        if (o.join === 'miter') this.out.push(`${n(Math.max(1, o.miter))} setmiterlimit`);
        if (o.dash.length && o.dash.some((d) => d > 0))
          this.out.push(`[${o.dash.map(n).join(' ')}] ${n(o.dashOffset)} setdash`);
        this.path(o.subpaths);
        if (o.paint.type === 'solid') {
          this.color(o.paint);
          this.out.push('S');
        } else this.out.push('strokepath W n', this.shading(o.paint));
        this.out.push('grestore');
        return;
      }
      case 'clip':
        this.out.push('gsave', `${mat(o.m)} concat`);
        this.path(o.subpaths);
        // Back to page space by inverting the clip's matrix, so later objects keep their own transforms.
        this.out.push(`${o.evenOdd ? 'W*' : 'W'} n`, `${mat(o.m)} matrix invertmatrix concat`);
        return;
      case 'unclip':
        this.out.push('grestore');
        return;
      case 'layer':
        this.out.push(`%%Layer: ${o.name.replace(/[\r\n]/g, ' ')}`);
        return;
      case 'endLayer':
        return;
      case 'image':
        this.image(o);
        return;
      case 'text': {
        this.warn('Text without an available font was set in Helvetica.');
        this.checkAlpha(o.paint, o.opacity, o.blend);
        const run = primaryRun(o.node);
        const font = `/${run.font.weight >= 600 ? (run.font.style === 'italic' ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : run.font.style === 'italic' ? 'Helvetica-Oblique' : 'Helvetica'}`;
        this.out.push('gsave', `${mat(o.m)} concat`, `${font} findfont ${n(run.size)} scalefont setfont`);
        this.color(o.paint);
        if (o.stroke) this.out.push(`${n(o.stroke.width)} setlinewidth`);
        for (const line of layoutText(o.node).lines) {
          if (!line.text) continue;
          const show = o.stroke ? 'false charpath S' : 'show';
          this.out.push(
            `gsave ${n(line.x)} ${n(line.baseline)} translate 1 -1 scale 0 0 moveto ${psString(line.text)} ${show} grestore`,
          );
        }
        this.out.push('grestore');
        return;
      }
    }
  }

  image(o: Extract<DrawOp, { op: 'image' }>) {
    const d = o.src ? dataUrlToBytes(o.src) : null;
    if (!d) return;
    const mime = sniffImageMime(d.bytes) ?? d.mime;
    const nd = o.node;
    const place = (w: number, h: number) => {
      this.out.push('gsave', `${mat(o.m)} concat`);
      if (nd.crop && nd.crop.width > 0 && nd.crop.height > 0) {
        this.out.push(`0 0 m ${n(nd.width)} 0 l ${n(nd.width)} ${n(nd.height)} l 0 ${n(nd.height)} l h W n`);
        const sx = nd.width / nd.crop.width;
        const sy = nd.height / nd.crop.height;
        this.out.push(
          `${n(-nd.crop.x * sx)} ${n(-nd.crop.y * sy)} translate ${n(w * sx)} ${n(h * sy)} scale`,
        );
      } else this.out.push(`${n(nd.width)} ${n(nd.height)} scale`);
    };
    if (o.opacity < 0.999) this.warn('EPS has no transparency, so see-through objects were drawn opaque.');
    if (mime === 'image/jpeg') {
      const size = readImageSize(d.bytes);
      if (!size) return;
      const comps = jpegComponents(d.bytes);
      const space = comps === 1 ? '/DeviceGray' : comps === 4 ? '/DeviceCMYK' : '/DeviceRGB';
      const decode = comps === 1 ? '[0 1]' : comps === 4 ? '[1 0 1 0 1 0 1 0]' : '[0 1 0 1 0 1]';
      place(size.width, size.height);
      this.out.push(
        `${space} setcolorspace`,
        `<< /ImageType 1 /Width ${size.width} /Height ${size.height} /BitsPerComponent 8 /Decode ${decode} /ImageMatrix [${size.width} 0 0 ${size.height} 0 0] /DataSource currentfile /ASCIIHexDecode filter /DCTDecode filter >> image`,
      );
      hexLines(d.bytes, this.out);
      this.out.push('grestore');
      return;
    }
    const px = mime === 'image/png' ? decodePng(d.bytes) : null;
    if (!px) {
      this.warn('Some images could not be embedded and were left out.');
      return;
    }
    // Composite over white: EPS images have no alpha.
    const rgb = new Uint8Array(px.width * px.height * 3);
    let hasAlpha = false;
    for (let i = 0, j = 0; i < px.rgba.length; i += 4, j += 3) {
      const a = px.rgba[i + 3] / 255;
      if (a < 1) hasAlpha = true;
      rgb[j] = Math.round(px.rgba[i] * a + 255 * (1 - a));
      rgb[j + 1] = Math.round(px.rgba[i + 1] * a + 255 * (1 - a));
      rgb[j + 2] = Math.round(px.rgba[i + 2] * a + 255 * (1 - a));
    }
    if (hasAlpha) this.warn('Image transparency was flattened onto white.');
    place(px.width, px.height);
    this.out.push(
      '/DeviceRGB setcolorspace',
      `<< /ImageType 1 /Width ${px.width} /Height ${px.height} /BitsPerComponent 8 /Decode [0 1 0 1 0 1] /ImageMatrix [${px.width} 0 0 ${px.height} 0 0] /DataSource currentfile /ASCIIHexDecode filter >> image`,
    );
    hexLines(rgb, this.out);
    this.out.push('grestore');
  }
}

export async function exportEpsString(
  doc: CurvsDocument,
  scope: ExportScope,
  options: Partial<EpsExportOptions>,
  ctx: ExportContext,
): Promise<string> {
  const warn = warner(ctx);
  const page = pagesForScope(doc, scope, ctx, false)[0] ?? {
    name: ctx.name,
    width: 1,
    height: 1,
    x: 0,
    y: 0,
    backgrounds: [],
    roots: [],
    artboards: [],
  };
  const fonts = await loadFonts(collectText(page, doc));
  const bleed = options.bleed ? BLEED_PT : 0;
  const off = bleed + (options.cropMarks ? MARK_MARGIN : 0);
  const W = page.width + off * 2;
  const H = page.height + off * 2;
  const bgPage = bleed
    ? {
        ...page,
        backgrounds: page.backgrounds.map((b) => ({
          ...b,
          rect: {
            x: b.rect.x - bleed,
            y: b.rect.y - bleed,
            width: b.rect.width + bleed * 2,
            height: b.rect.height + bleed * 2,
          },
        })),
      }
    : page;
  const ops = flattenPage(bgPage, { doc, fonts, textOutlines: true, warn });
  const w = new EpsWriter(doc, warn);
  const date = new Date()
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC');
  const title = (ctx.name || 'Untitled').replace(/[\r\n]/g, ' ');
  w.out.push(
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%BoundingBox: 0 0 ${Math.ceil(W)} ${Math.ceil(H)}`,
    `%%HiResBoundingBox: 0 0 ${n(W)} ${n(H)}`,
    `%%Title: ${title}`,
    '%%Creator: Curvesmith',
    `%%CreationDate: ${date}`,
    '%%LanguageLevel: 3',
    '%%DocumentData: Clean7Bit',
    '%%Pages: 1',
    '%%EndComments',
    '%%BeginProlog',
    '/CSdict 24 dict def CSdict begin',
    '/m /moveto load def /l /lineto load def /c /curveto load def /h /closepath load def',
    '/f /fill load def /f* /eofill load def /S /stroke load def /n /newpath load def',
    '/W /clip load def /W* /eoclip load def',
    'end',
    '%%EndProlog',
    '%%Page: 1 1',
    'save',
    'CSdict begin',
    'gsave',
    `0 ${n(H)} translate 1 -1 scale ${n(off)} ${n(off)} translate`,
  );
  for (const o of ops) w.draw(o);
  w.out.push('grestore');
  if (options.cropMarks) {
    const gap = bleed + 3;
    const len = 14;
    w.out.push('gsave 1 1 1 1 setcmykcolor 0.25 setlinewidth');
    for (const cx of [off, off + page.width]) {
      for (const cy of [off, off + page.height]) {
        const sx = cx === off ? -1 : 1;
        const sy = cy === off ? -1 : 1;
        w.out.push(`${n(cx + sx * gap)} ${n(cy)} m ${n(cx + sx * (gap + len))} ${n(cy)} l S`);
        w.out.push(`${n(cx)} ${n(cy + sy * gap)} m ${n(cx)} ${n(cy + sy * (gap + len))} l S`);
      }
    }
    w.out.push('grestore');
  }
  w.out.push('end', 'restore', 'showpage', '%%Trailer', '%%EOF', '');
  return w.out.join('\n');
}

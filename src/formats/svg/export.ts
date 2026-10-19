import { isEvenOdd } from '../../core/document';
/* SVG writer. Mirrors src/render/paint.ts: appearance items become stacked elements (bottom-to-top), drop shadows
   and inner shadows become filters, inside/outside strokes are clipped/masked at twice the width, width profiles
   and arrowheads are filled outlines, booleans export their computed result.
   Scope "all" writes one SVG with every artboard at its world position (one <g> per artboard) and a viewBox
   that covers them all. Gradient coordinates live in each node's local space, so gradients use
   gradientUnits="userSpaceOnUse" inside the node's transformed element. */
import type {
  AppearanceItem,
  Artboard,
  BlendMode,
  Color,
  CurvsDocument,
  ExportScope,
  ImageNode,
  Matrix,
  Paint,
  SceneNode,
  StrokeItem,
  Subpath,
  TextNode,
} from '../../core/types';
import { resolveColor } from '../../core/color';
import { isIdentity } from '../../core/matrix';
import { nodeSubpaths } from '../../core/geometry/node';
import { toPathData } from '../../core/geometry/pathdata';
import { subpathsBounds, unionRect, type Rect } from '../../core/geometry/bezier';
import { arrowHeads, profileOutline } from '../../core/geometry/strokes';
import { layoutText, primaryRun } from '../../core/text';
import { colorToHex } from '../../core/color';
import type { ExportContext } from '../types';
import type { SvgExportOptions } from '../registry';
import { serialize, x, type XNode } from '../shared/xml';
import { imageLayers, imageRect } from '../../core/image';
import { pagesForScope } from '../shared/pages';
import { fontKey, loadFonts, textOutlines, type LoadedFont } from '../shared/fonts';
import { dataUrlToBytes, readImageSize } from '../shared/bytes';

export const SVG_DEFAULTS: SvgExportOptions = {
  text: 'keep',
  styling: 'attributes',
  decimals: 2,
  minify: false,
  responsive: false,
  background: false,
  layerIds: true,
};

type Props = [string, string][];

/** Props that only exist as CSS (never as presentation attributes). */
const CSS_ONLY = new Set(['mix-blend-mode', 'isolation']);

export function slugify(name: string): string {
  let s = name
    .trim()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .replace(/-+/g, '-');
  if (!s || !/^[A-Za-z_]/.test(s)) s = 'id-' + s;
  return s;
}

class SvgWriter {
  defs: XNode[] = [];
  classes = new Map<string, string>();
  private used = new Set<string>();
  private counter = 0;
  private geomCache = new Map<string, string>();

  constructor(
    private doc: CurvsDocument,
    private o: SvgExportOptions,
    private fonts: Map<string, LoadedFont>,
    private warn: (m: string) => void,
  ) {}

  num(v: number, digits = this.o.decimals): string {
    const f = Math.pow(10, digits);
    const r = Math.round(v * f) / f;
    return Object.is(r, -0) ? '0' : String(r);
  }

  matrix(m: Matrix): string | null {
    if (isIdentity(m)) return null;
    const d = Math.max(this.o.decimals, 4);
    if (
      Math.abs(m[0] - 1) < 1e-9 &&
      Math.abs(m[1]) < 1e-9 &&
      Math.abs(m[2]) < 1e-9 &&
      Math.abs(m[3] - 1) < 1e-9
    )
      return `translate(${this.num(m[4])} ${this.num(m[5])})`;
    return `matrix(${[m[0], m[1], m[2], m[3]].map((v) => this.num(v, d)).join(' ')} ${this.num(m[4])} ${this.num(m[5])})`;
  }

  defId(prefix: string): string {
    let id: string;
    do id = `cs-${prefix}${++this.counter}`;
    while (this.used.has(id));
    this.used.add(id);
    return id;
  }

  nameId(name: string): string | undefined {
    if (!this.o.layerIds || !name) return undefined;
    const base = slugify(name);
    let id = base;
    for (let i = 2; this.used.has(id); i++) id = `${base}-${i}`;
    this.used.add(id);
    return id;
  }

  /** Apply style props as attributes, inline CSS or classes (merging with what the element already has). */
  style(el: XNode, props: Props): XNode {
    if (!props.length) return el;
    const merge = (name: string, value: string, sep: string) => {
      const a = el.attrs.find(([k]) => k === name);
      if (a) a[1] = `${a[1]}${sep}${value}`;
      else el.attrs.push([name, value]);
    };
    const decl = (ps: Props) => ps.map(([k, v]) => `${k}:${v}`).join(';');
    if (this.o.styling === 'attributes') {
      const css = props.filter(([k]) => CSS_ONLY.has(k));
      el.attrs.push(...props.filter(([k]) => !CSS_ONLY.has(k)));
      if (css.length) merge('style', decl(css), ';');
    } else if (this.o.styling === 'inline') {
      merge('style', decl(props), ';');
    } else {
      const key = decl(props);
      let cls = this.classes.get(key);
      if (!cls) {
        cls = `c${this.classes.size + 1}`;
        this.classes.set(key, cls);
      }
      merge('class', cls, ' ');
    }
    return el;
  }

  color(c: Color): { hex: string; alpha: number } {
    const s = resolveColor(c, this.doc.swatches);
    return { hex: '#' + colorToHex(s).toLowerCase(), alpha: s.a };
  }

  paint(p: Paint, kind: 'fill' | 'stroke', opacity: number): Props {
    if (p.type === 'solid') {
      const { hex, alpha } = this.color(p.color);
      const a = alpha * opacity;
      return [[kind, hex], ...(a < 0.9995 ? ([[`${kind}-opacity`, this.num(a, 3)]] as Props) : [])];
    }
    const id = this.gradient(p);
    return [
      [kind, `url(#${id})`],
      ...(opacity < 0.9995 ? ([[`${kind}-opacity`, this.num(opacity, 3)]] as Props) : []),
    ];
  }

  gradient(p: Extract<Paint, { stops: unknown }>): string {
    const id = this.defId('grad');
    const stops = [...p.stops]
      .sort((a, b) => a.offset - b.offset)
      .map((s) => {
        const { hex, alpha } = this.color(s.color);
        return x('stop', [
          ['offset', this.num(Math.max(0, Math.min(1, s.offset)), 4)],
          ['stop-color', hex],
          ['stop-opacity', alpha < 0.9995 ? this.num(alpha, 3) : undefined],
        ]);
      });
    const [fx, fy] = p.from;
    const [tx, ty] = p.to;
    if (p.type === 'radial') {
      const r = Math.hypot(tx - fx, ty - fy) || 1;
      this.defs.push(
        x(
          'radialGradient',
          [
            ['id', id],
            ['gradientUnits', 'userSpaceOnUse'],
            ['cx', this.num(fx)],
            ['cy', this.num(fy)],
            ['r', this.num(r)],
          ],
          stops,
        ),
      );
    } else {
      if (p.type === 'conic') this.warn('Conic gradients were saved as linear gradients.');
      this.defs.push(
        x(
          'linearGradient',
          [
            ['id', id],
            ['gradientUnits', 'userSpaceOnUse'],
            ['x1', this.num(fx)],
            ['y1', this.num(fy)],
            ['x2', this.num(tx)],
            ['y2', this.num(ty)],
          ],
          stops,
        ),
      );
    }
    return id;
  }

  blendProps(b: BlendMode): Props {
    return b !== 'normal' ? [['mix-blend-mode', b]] : [];
  }

  /** A factory for the node's geometry element; long paths are defined once and referenced with <use>. */
  geometry(n: SceneNode, subpaths: Subpath[], evenOdd: boolean, reuse: boolean): () => XNode {
    if (n.type === 'rect' && n.corners.every((c) => c.kind === 'round' && c.radius === n.corners[0].radius)) {
      const r = Math.min(n.corners[0].radius, Math.abs(n.width) / 2, Math.abs(n.height) / 2);
      if (n.width >= 0 && n.height >= 0)
        return () =>
          x('rect', [
            ['width', this.num(n.width)],
            ['height', this.num(n.height)],
            ['rx', r > 0 ? this.num(r) : undefined],
          ]);
    }
    if (
      n.type === 'ellipse' &&
      (n.arcStart === undefined ||
        n.arcEnd === undefined ||
        n.arcStart === n.arcEnd ||
        Math.abs(n.arcEnd - n.arcStart) >= 360)
    )
      return () =>
        x('ellipse', [
          ['rx', this.num(Math.abs(n.rx))],
          ['ry', this.num(Math.abs(n.ry))],
        ]);
    const d = toPathData(subpaths, this.o.decimals);
    const rule: [string, string][] = evenOdd ? [['fill-rule', 'evenodd']] : [];
    if (reuse && d.length > 160) {
      let id = this.geomCache.get(d);
      if (!id) {
        id = this.defId('shape');
        this.geomCache.set(d, id);
        this.defs.push(
          x('path', [
            ['id', id],
            ['d', d],
          ]),
        );
      }
      const ref = id;
      return () => x('use', [['href', `#${ref}`], ...rule]);
    }
    return () => x('path', [['d', d], ...rule]);
  }

  textElement(n: TextNode): () => XNode {
    const run = primaryRun(n);
    const layout = layoutText(n);
    const fam = /[\s,'"]/.test(run.font.family) ? `'${run.font.family.replace(/'/g, '')}'` : run.font.family;
    const props: Props = [
      ['font-family', fam],
      ['font-size', this.num(run.size)],
      ...(run.font.weight !== 400 ? ([['font-weight', String(run.font.weight)]] as Props) : []),
      ...(run.font.style === 'italic' ? ([['font-style', 'italic']] as Props) : []),
      ...(run.tracking ? ([['letter-spacing', this.num((run.tracking / 1000) * run.size)]] as Props) : []),
    ];
    return () => {
      const spans = layout.lines.map((l) =>
        x(
          'tspan',
          [
            ['x', this.num(l.x)],
            ['y', this.num(l.baseline)],
          ],
          [l.text],
        ),
      );
      const el = x('text', [['xml:space', 'preserve']], spans);
      el.inline = true;
      return this.style(el, props);
    };
  }

  shadowFilter(e: { x: number; y: number; blur: number; color: Color }, inner: boolean): string {
    const id = this.defId(inner ? 'inner' : 'shadow');
    const { hex, alpha } = this.color(e.color);
    const sd = this.num(e.blur / 2, 3);
    const region: [string, string][] = [
      ['x', '-50%'],
      ['y', '-50%'],
      ['width', '200%'],
      ['height', '200%'],
      ['color-interpolation-filters', 'sRGB'],
    ];
    const flood = x('feFlood', [
      ['flood-color', hex],
      ['flood-opacity', this.num(alpha, 3)],
    ]);
    const kids = inner
      ? [
          x('feOffset', [
            ['in', 'SourceAlpha'],
            ['dx', this.num(e.x)],
            ['dy', this.num(e.y)],
            ['result', 'o'],
          ]),
          x('feGaussianBlur', [
            ['in', 'o'],
            ['stdDeviation', sd],
            ['result', 'b'],
          ]),
          x('feComposite', [
            ['in', 'SourceAlpha'],
            ['in2', 'b'],
            ['operator', 'arithmetic'],
            ['k2', '1'],
            ['k3', '-1'],
            ['result', 'i'],
          ]),
          flood,
          x('feComposite', [
            ['in2', 'i'],
            ['operator', 'in'],
          ]),
        ]
      : [
          x('feGaussianBlur', [
            ['in', 'SourceAlpha'],
            ['stdDeviation', sd],
          ]),
          x('feOffset', [
            ['dx', this.num(e.x)],
            ['dy', this.num(e.y)],
            ['result', 'o'],
          ]),
          flood,
          x('feComposite', [
            ['in2', 'o'],
            ['operator', 'in'],
          ]),
        ];
    this.defs.push(x('filter', [['id', id], ...region], kids));
    return id;
  }

  strokeProps(it: StrokeItem, width: number): Props {
    return [
      ...this.paint(it.paint, 'stroke', it.opacity),
      ['stroke-width', this.num(width, Math.max(this.o.decimals, 2))],
      ...(it.cap !== 'butt' ? ([['stroke-linecap', it.cap]] as Props) : []),
      ...(it.join !== 'miter' ? ([['stroke-linejoin', it.join]] as Props) : []),
      ...(it.join === 'miter' && it.miter !== 4
        ? ([['stroke-miterlimit', this.num(it.miter)]] as Props)
        : []),
      ...(it.dash.length ? ([['stroke-dasharray', it.dash.map((d) => this.num(d)).join(' ')]] as Props) : []),
      ...(it.dash.length && it.dashOffset ? ([['stroke-dashoffset', this.num(it.dashOffset)]] as Props) : []),
    ];
  }

  /** The appearance stack of a shape-like node as a list of elements in its local space. */
  stack(n: SceneNode, make: () => XNode, subpaths: Subpath[] | null, evenOdd: boolean): XNode[] {
    const els: XNode[] = [];
    const items = n.appearance.items;
    const closed = subpaths ? subpaths.some((s) => s.closed) : false;
    // Common case: one fill under one plain stroke → a single element, exactly how SVG paints.
    const vis = items.filter((i) => i.visible);
    const simpleFill = (i: AppearanceItem | undefined) => i?.kind === 'fill' && i.blend === 'normal';
    const simpleStroke = (i: AppearanceItem | undefined) =>
      i?.kind === 'stroke' &&
      i.blend === 'normal' &&
      (!closed || i.align === 'center') &&
      !i.profile?.length &&
      !i.arrowStart &&
      !i.arrowEnd;
    if (
      vis.length === 0 ||
      (vis.length === 1 && (simpleFill(vis[0]) || simpleStroke(vis[0]))) ||
      (vis.length === 2 && simpleFill(vis[0]) && simpleStroke(vis[1]))
    ) {
      const f = vis.find((i) => i.kind === 'fill');
      const st = vis.find((i) => i.kind === 'stroke');
      const props: Props =
        f && f.kind === 'fill' ? this.paint(f.paint, 'fill', f.opacity) : [['fill', 'none']];
      if (st && st.kind === 'stroke' && st.width > 0) props.push(...this.strokeProps(st, st.width));
      return [this.style(make(), props)];
    }
    for (const it of items) {
      if (it.kind !== 'effect' || !it.visible || it.effect.type !== 'dropShadow') continue;
      const id = this.shadowFilter(it.effect, false);
      const el = this.style(make(), [['fill', '#000']]);
      el.attrs.push(['filter', `url(#${id})`]);
      els.push(el);
    }
    for (const it of items) {
      if (!it.visible) continue;
      if (it.kind === 'fill') {
        els.push(
          this.style(make(), [...this.paint(it.paint, 'fill', it.opacity), ...this.blendProps(it.blend)]),
        );
      } else if (it.kind === 'stroke') {
        if (it.width <= 0) continue;
        const paintFill = (sp: Subpath[]) =>
          this.style(x('path', [['d', toPathData(sp, this.o.decimals)]]), [
            ...this.paint(it.paint, 'fill', it.opacity),
            ...this.blendProps(it.blend),
          ]);
        if (it.profile && it.profile.length && subpaths) {
          els.push(paintFill(profileOutline(subpaths, it.width, it.profile)));
        } else {
          const align = closed ? it.align : 'center';
          const width = align === 'center' ? it.width : it.width * 2;
          const props: Props = [
            ['fill', 'none'],
            ...this.strokeProps(it, width),
            ...this.blendProps(it.blend),
          ];
          const el = this.style(make(), props);
          if (align === 'inside') {
            const id = this.defId('clip');
            const clipEl = make();
            if (evenOdd) clipEl.attrs.push(['clip-rule', 'evenodd']);
            this.defs.push(x('clipPath', [['id', id]], [clipEl]));
            els.push(x('g', [['clip-path', `url(#${id})`]], [el]));
          } else if (align === 'outside') {
            const id = this.defId('mask');
            const b = (subpaths && subpathsBounds(subpaths)) || { x: 0, y: 0, width: 0, height: 0 };
            const pad = width * Math.max(it.miter, 2) + 2;
            const r = [b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2].map((v) => this.num(v));
            const hole = make();
            hole.attrs.push(['fill', '#000']);
            this.defs.push(
              x(
                'mask',
                [
                  ['id', id],
                  ['maskUnits', 'userSpaceOnUse'],
                  ['x', r[0]],
                  ['y', r[1]],
                  ['width', r[2]],
                  ['height', r[3]],
                ],
                [
                  x('rect', [
                    ['x', r[0]],
                    ['y', r[1]],
                    ['width', r[2]],
                    ['height', r[3]],
                    ['fill', '#fff'],
                  ]),
                  hole,
                ],
              ),
            );
            els.push(x('g', [['mask', `url(#${id})`]], [el]));
          } else els.push(el);
        }
        if ((it.arrowStart || it.arrowEnd) && subpaths) els.push(paintFill(arrowHeads(subpaths, it)));
      } else if (it.effect.type === 'innerShadow') {
        const id = this.shadowFilter(it.effect, true);
        const el = this.style(make(), [['fill', '#000']]);
        el.attrs.push(['filter', `url(#${id})`]);
        els.push(el);
      }
    }
    return els;
  }

  blurFilter(n: SceneNode): string | null {
    for (const it of n.appearance.items) {
      if (it.kind === 'effect' && it.visible && it.effect.type === 'blur' && it.effect.radius > 0) {
        const id = this.defId('blur');
        this.defs.push(
          x(
            'filter',
            [
              ['id', id],
              ['x', '-50%'],
              ['y', '-50%'],
              ['width', '200%'],
              ['height', '200%'],
            ],
            [x('feGaussianBlur', [['stdDeviation', this.num(it.effect.radius, 3)]])],
          ),
        );
        return id;
      }
    }
    return null;
  }

  image(n: ImageNode): XNode | null {
    const linked =
      /^(https?:|file:|\.{0,2}\/)/i.test(n.asset) ||
      (!n.asset.startsWith('assets/') && /\.\w{3,4}$/.test(n.asset));
    const src = this.doc.assets[n.asset] ?? (linked ? n.asset : undefined);
    if (!src) {
      this.warn('Missing images were left out.');
      return null;
    }
    const img = (w: number, h: number) =>
      x('image', [
        ['width', this.num(w)],
        ['height', this.num(h)],
        ['preserveAspectRatio', 'none'],
        ['href', src],
      ]);
    if (n.crop) {
      const decoded = dataUrlToBytes(src);
      const size = decoded ? readImageSize(decoded.bytes) : null;
      if (size) {
        const c = n.crop;
        return x(
          'svg',
          [
            ['width', this.num(n.width)],
            ['height', this.num(n.height)],
            ['viewBox', [c.x, c.y, c.width, c.height].map((v) => this.num(v)).join(' ')],
            ['preserveAspectRatio', 'none'],
            ['overflow', 'hidden'],
          ],
          [img(size.width, size.height)],
        );
      }
    }
    return img(n.width, n.height);
  }

  node(n: SceneNode, depth = 0): XNode | null {
    if (!n.visible || depth > 64) return null;
    let content: XNode[] = [];
    let leaf = true;
    const wrapper: [string, string | undefined][] = [];
    switch (n.type) {
      case 'group':
        leaf = false;
        content = n.children.map((c) => this.node(c, depth + 1)).filter((e): e is XNode => e !== null);
        break;
      case 'clipGroup': {
        leaf = false;
        const id = this.defId('clip');
        const c = n.clip;
        const clipEl =
          c.type === 'text'
            ? this.textElement(c)()
            : this.geometry(c, nodeSubpaths(c, this.doc), isEvenOdd(c), false)();
        const t = this.matrix(c.transform);
        if (t) clipEl.attrs.push(['transform', t]);
        if (isEvenOdd(c)) clipEl.attrs.push(['clip-rule', 'evenodd']);
        this.defs.push(x('clipPath', [['id', id]], [clipEl]));
        wrapper.push(['clip-path', `url(#${id})`]);
        content = n.children.map((k) => this.node(k, depth + 1)).filter((e): e is XNode => e !== null);
        break;
      }
      case 'instance': {
        leaf = false;
        const sym = this.doc.symbols.find((s) => s.id === n.symbol);
        const el = sym ? this.node(sym.root, depth + 1) : null;
        if (el) content = [el];
        break;
      }
      case 'image': {
        // A rectangle with an appearance stack; the bitmap sits between fills and strokes (render/paint.ts).
        const el = this.image(n);
        if (!el) break;
        const { below, above } = imageLayers(n);
        const rect = imageRect(n);
        const layer = (items: AppearanceItem[]) => {
          if (!items.some((i) => i.visible)) return [];
          const part = { ...n, appearance: { items } } as SceneNode;
          return this.stack(part, this.geometry(part, rect, false, items.length > 1), rect, false);
        };
        content = [...layer(below), el, ...layer(above)];
        break;
      }
      case 'text': {
        const font = this.o.text === 'outlines' ? this.fonts.get(fontKey(n.runs[0].font))?.font : null;
        if (font) {
          const sp = textOutlines(n, font);
          content = this.stack(n, this.geometry(n, sp, false, true), sp, false);
        } else {
          if (this.o.text === 'outlines') this.warn('Text stayed as text where its font was unavailable.');
          content = this.stack(n, this.textElement(n), null, false);
        }
        break;
      }
      default: {
        const sp = nodeSubpaths(n, this.doc);
        const evenOdd = isEvenOdd(n);
        content = this.stack(n, this.geometry(n, sp, evenOdd, n.appearance.items.length > 1), sp, evenOdd);
      }
    }
    if (!content.length && leaf) return null;
    const blur = this.blurFilter(n);
    const id = this.nameId(n.name);
    const props: Props = [
      ...(n.opacity < 0.9995 ? ([['opacity', this.num(n.opacity, 3)]] as Props) : []),
      ...this.blendProps(n.blend),
      ...(n.type === 'group' && n.isolated ? ([['isolation', 'isolate']] as Props) : []),
    ];
    const t = this.matrix(n.transform);
    const single = content.length === 1 ? content[0] : null;
    const canMerge =
      leaf &&
      single &&
      !single.attrs.some(
        ([k]) =>
          k === 'transform' ||
          k === 'id' ||
          (blur && k === 'filter') ||
          k === 'opacity' ||
          k === 'clip-path' ||
          k === 'mask',
      );
    const target = canMerge ? single! : x('g', [], content);
    if (id) target.attrs.unshift(['id', id]);
    if (t) target.attrs.push(['transform', t]);
    for (const [k, v] of wrapper) if (v) target.attrs.push([k, v]);
    if (blur) target.attrs.push(['filter', `url(#${blur})`]);
    if (props.length) this.style(target, props);
    return target;
  }

  background(rect: Rect, color: Color): XNode {
    const { hex, alpha } = this.color(color);
    return this.style(
      x('rect', [
        ['x', rect.x ? this.num(rect.x) : undefined],
        ['y', rect.y ? this.num(rect.y) : undefined],
        ['width', this.num(rect.width)],
        ['height', this.num(rect.height)],
      ]),
      [['fill', hex], ...(alpha < 0.9995 ? ([['fill-opacity', this.num(alpha, 3)]] as Props) : [])],
    );
  }

  document(
    body: XNode[],
    view: Rect,
    size: { width: string; height: string } | null,
    title: string | null,
  ): string {
    const kids: XNode[] = [];
    if (title && !this.o.minify) kids.push(x('title', [], [title]));
    if (this.classes.size) {
      const css = [...this.classes].map(([decl, cls]) => `.${cls}{${decl}}`).join(this.o.minify ? '' : '\n');
      kids.push(x('style', [], [css]));
    }
    if (this.defs.length) kids.push(x('defs', [], this.defs));
    kids.push(...body);
    const root = x(
      'svg',
      [
        ['xmlns', 'http://www.w3.org/2000/svg'],
        ['version', '1.1'],
        ['width', size?.width],
        ['height', size?.height],
        ['viewBox', [view.x, view.y, view.width, view.height].map((v) => this.num(v)).join(' ')],
      ],
      kids,
    );
    const head = this.o.minify ? '' : '<?xml version="1.0" encoding="UTF-8"?>\n';
    return head + serialize(root, !this.o.minify) + (this.o.minify ? '' : '\n');
  }
}

export type BuildSvgOptions = Partial<SvgExportOptions> & {
  /** Size unit for width/height: 'px' (default) or 'pt' (printing). */
  sizeUnit?: 'px' | 'pt';
  fonts?: Map<string, LoadedFont>;
  warn?: (message: string) => void;
  name?: string;
};

function artboardGroup(
  w: SvgWriter,
  ab: Artboard,
  ox: number,
  oy: number,
  background: boolean,
  wrap: boolean,
): XNode[] {
  const kids: XNode[] = [];
  if (background && ab.background)
    kids.push(w.background({ x: 0, y: 0, width: ab.width, height: ab.height }, ab.background));
  for (const c of ab.children) {
    const el = w.node(c);
    if (el) kids.push(el);
  }
  if (!wrap) return kids;
  const g = x('g', [], kids);
  const id = w.nameId(ab.name);
  if (id) g.attrs.push(['id', id]);
  if (ox || oy) g.attrs.push(['transform', `translate(${w.num(ox)} ${w.num(oy)})`]);
  return [g];
}

/** Build the SVG text for a scope (synchronous; pass fonts for outlined text). */
export function buildSvg(
  doc: CurvsDocument,
  scope: ExportScope,
  ctx: Pick<ExportContext, 'activeArtboard' | 'name'>,
  options: BuildSvgOptions = {},
): string {
  const o: SvgExportOptions = { ...SVG_DEFAULTS, ...options };
  const w = new SvgWriter(doc, o, options.fonts ?? new Map(), options.warn ?? (() => undefined));
  const unit = options.sizeUnit === 'pt' ? 'pt' : '';
  const sizeOf = (r: Rect) =>
    o.responsive ? null : { width: w.num(r.width) + unit, height: w.num(r.height) + unit };
  if (scope.kind === 'all' && doc.artboards.length > 1) {
    let r: Rect | null = null;
    for (const ab of doc.artboards)
      r = unionRect(r, { x: ab.x, y: ab.y, width: ab.width, height: ab.height });
    const view = r!;
    const body = doc.artboards.flatMap((ab) =>
      artboardGroup(w, ab, ab.x - view.x, ab.y - view.y, o.background, true),
    );
    return w.document(
      body,
      { x: 0, y: 0, width: view.width, height: view.height },
      sizeOf(view),
      options.name ?? ctx.name,
    );
  }
  if (scope.kind !== 'selection') {
    const id = scope.kind === 'artboard' ? scope.id : ctx.activeArtboard;
    const ab = doc.artboards.find((a) => a.id === id) ?? doc.artboards[0];
    const view = { x: 0, y: 0, width: ab.width, height: ab.height };
    return w.document(
      artboardGroup(w, ab, 0, 0, o.background, false),
      view,
      sizeOf(view),
      options.name ?? ab.name,
    );
  }
  const page = pagesForScope(doc, scope, ctx, false)[0];
  const body: XNode[] = [];
  for (const r of page?.roots ?? []) {
    const el = w.node(r.node);
    if (!el) continue;
    const t = w.matrix(r.m);
    body.push(t ? x('g', [['transform', t]], [el]) : el);
  }
  const view = { x: 0, y: 0, width: page?.width ?? 1, height: page?.height ?? 1 };
  return w.document(body, view, sizeOf(view), options.name ?? ctx.name);
}

function textNodesIn(doc: CurvsDocument): TextNode[] {
  const out: TextNode[] = [];
  const visit = (n: SceneNode) => {
    if (n.type === 'text') out.push(n);
    if (n.type === 'clipGroup') visit(n.clip);
    if (n.type === 'group' || n.type === 'clipGroup') n.children.forEach(visit);
  };
  doc.artboards.forEach((ab) => ab.children.forEach(visit));
  doc.symbols.forEach((s) => visit(s.root));
  return out;
}

export async function exportSvgString(
  doc: CurvsDocument,
  scope: ExportScope,
  opts: Partial<SvgExportOptions>,
  ctx: ExportContext,
): Promise<string> {
  const fonts = opts.text === 'outlines' ? await loadFonts(textNodesIn(doc)) : new Map<string, LoadedFont>();
  return buildSvg(doc, scope, ctx, { ...opts, fonts, warn: ctx.warn });
}

/** Standalone SVG of one artboard with width/height in points (used for printing). Text stays as text. */
export function artboardToSvgString(
  doc: CurvsDocument,
  artboardId: string,
  opts: BuildSvgOptions = {},
): string {
  return buildSvg(
    doc,
    { kind: 'artboard', id: artboardId },
    { activeArtboard: artboardId, name: '' },
    {
      background: true,
      layerIds: false,
      ...opts,
      responsive: false,
      sizeUnit: 'pt',
    },
  );
}

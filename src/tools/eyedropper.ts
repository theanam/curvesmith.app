/* Eyedropper: samples the rendered pixel under the cursor (images, gradients, anything on canvas), with a
   magnifying loupe. Click: copy a vector object's whole appearance onto the selection, or apply the picked
   color to the selection's fill (stroke when the stroke swatch has focus). With nothing to apply to, the
   color becomes the toolbar's default. ⇧-click always picks the color only. */
import type { Draft } from 'immer';
import type { CurvsDocument, FillItem, SceneNode, SrgbColor, StrokeItem, Vec } from '../core/types';
import type { PixelSample, Tool } from './types';
import { clone, locate, makeFill, makeStroke } from '../core/document';
import { hitTest } from '../render/hittest';
import { getState, mutate, setState } from '../state/store';
import { colorToHex } from '../core/color';
import { newId } from '../core/id';
import { drawSelectionOutlines } from './common';
import { OVERLAY, roundRect } from '../render/overlay';
import { toast } from '../ui/toast';

/** Pixels shown in the loupe (odd, so one sits in the center) and their on-screen size. */
export const LOUPE_PIXELS = 11;
const ZOOM = 10;
const LOUPE = LOUPE_PIXELS * ZOOM;

let loupe: { screen: Vec; sample: PixelSample } | null = null;

const canApplyColor = (n: SceneNode) =>
  n.type !== 'image' && n.type !== 'group' && n.type !== 'clipGroup' && n.type !== 'instance';

/** Apply a picked color to the fill (or stroke) of each target, adding the item when missing. */
export function applyPickedColor(ids: string[], color: SrgbColor, focus: 'fill' | 'stroke') {
  mutate(focus === 'fill' ? 'Pick fill color' : 'Pick stroke color', (d) => {
    for (const id of ids) {
      const l = locate(d as unknown as CurvsDocument, id);
      if (!l || !canApplyColor(l.node as SceneNode)) continue;
      const items = (l.node as Draft<SceneNode>).appearance.items;
      const item = items.find((i) => i.kind === focus) as Draft<FillItem | StrokeItem> | undefined;
      if (item) item.paint = { type: 'solid', color } as never;
      else if (focus === 'fill') items.unshift(makeFill(color) as never);
      else items.push(makeStroke(color, 1) as never);
    }
  });
}

export const eyedropperTool: Tool = {
  cursor: 'crosshair',

  move(e, api) {
    const sample = api.sample(e.screen, LOUPE_PIXELS);
    loupe = sample ? { screen: e.screen, sample } : null;
    api.render();
  },

  up(e, api) {
    const hit = hitTest(api.doc, e.world, api.px(3), { deep: true });
    const targets = api.od.selection.filter((id) => id !== hit?.node.id);
    const focus = getState().defaults.focus;

    // Clicking a vector object copies its whole appearance onto the selection (Illustrator style).
    if (!e.shift && hit && hit.node.type !== 'image' && hit.node.appearance.items.length && targets.length) {
      const appearance = clone(hit.node.appearance);
      mutate('Copy appearance', (d) => {
        for (const id of targets) {
          const l = locate(d as unknown as CurvsDocument, id);
          if (!l || !canApplyColor(l.node as SceneNode)) continue;
          const ap = clone(appearance);
          ap.items.forEach((i) => (i.id = newId('ap')));
          (l.node as Draft<SceneNode>).appearance = ap as never;
        }
      });
      return;
    }

    const picked = api.sample(e.screen, 1);
    if (!picked) {
      toast('That pixel can’t be read. Images linked from other sites block color picking.');
      return;
    }
    const color: SrgbColor = { ...picked.color, a: picked.color.a || 1 };
    const colorTargets = targets.filter((id) => {
      const n = locate(api.doc, id)?.node;
      return n && canApplyColor(n);
    });
    if (colorTargets.length) {
      applyPickedColor(colorTargets, color, focus);
      return;
    }

    // Nothing to recolor (for example the picked image itself is selected): the color becomes the default.
    setState({ defaults: { ...getState().defaults, [focus]: color } });
    toast(`${focus === 'fill' ? 'Fill' : 'Stroke'} color set to #${colorToHex(color)}`);
  },

  leave(api) {
    loupe = null;
    api.render();
  },

  overlay(ctx, api) {
    drawSelectionOutlines(ctx, api, api.od.selection, 1);
    if (loupe) drawLoupe(ctx, loupe.screen, loupe.sample);
  },

  cancel() {
    loupe = null;
  },
};

let scratch: HTMLCanvasElement | null = null;

/** Circular magnifier above-right of the cursor: magnified pixels, the center pixel boxed, the hex below. */
export function drawLoupe(ctx: CanvasRenderingContext2D, at: Vec, sample: PixelSample) {
  const W = ctx.canvas.width / (window.devicePixelRatio || 1);
  const gap = 18;
  let x = at[0] + gap;
  let y = at[1] - gap - LOUPE;
  if (x + LOUPE > W - 4) x = at[0] - gap - LOUPE;
  if (y < 4) y = at[1] + gap;
  const r = LOUPE / 2;
  const cx = x + r;
  const cy = y + r;

  scratch ??= document.createElement('canvas');
  scratch.width = sample.size;
  scratch.height = sample.size;
  const sctx = scratch.getContext('2d');
  if (!sctx) return;
  sctx.putImageData(new ImageData(new Uint8ClampedArray(sample.data), sample.size, sample.size), 0, 0);

  ctx.save();
  // Shadow and outer ring.
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.fillStyle = OVERLAY.ink;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  // The ring shows the picked color.
  const c = sample.color;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${c.r * 255}, ${c.g * 255}, ${c.b * 255})`;
  ctx.fill();
  // Magnified pixels, crisp.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, LOUPE, LOUPE);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, x, y, LOUPE, LOUPE);
  // Pixel grid.
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < LOUPE_PIXELS; i++) {
    ctx.moveTo(x + i * ZOOM + 0.5, y);
    ctx.lineTo(x + i * ZOOM + 0.5, y + LOUPE);
    ctx.moveTo(x, y + i * ZOOM + 0.5);
    ctx.lineTo(x + LOUPE, y + i * ZOOM + 0.5);
  }
  ctx.stroke();
  ctx.restore();
  // Center pixel: white box with an ink outline, readable on any color.
  const px = x + Math.floor(LOUPE_PIXELS / 2) * ZOOM;
  const py = y + Math.floor(LOUPE_PIXELS / 2) * ZOOM;
  ctx.lineWidth = 1;
  ctx.strokeStyle = OVERLAY.ink;
  ctx.strokeRect(px - 0.5, py - 0.5, ZOOM + 1, ZOOM + 1);
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(px + 0.5, py + 0.5, ZOOM - 1, ZOOM - 1);
  // Hex label.
  const label = `#${colorToHex(c)}`;
  ctx.font = '600 11px "Geist Mono", ui-monospace, monospace';
  const tw = ctx.measureText(label).width + 14;
  const ly = cy + r + 12;
  ctx.fillStyle = OVERLAY.hudBg;
  roundRect(ctx, cx - tw / 2, ly, tw, 20, 10);
  ctx.fill();
  ctx.fillStyle = OVERLAY.hudFg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(label, cx, ly + 10);
  ctx.restore();
}

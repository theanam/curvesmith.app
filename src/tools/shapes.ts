import type { SceneNode } from '../core/types';
import type { Tool, ToolApi, ToolPointer } from './types';
import { makeEllipse, makeRect, makeStar, clone } from '../core/document';
import { invert, multiply } from '../core/matrix';
import {
  beginGesture,
  cancelGesture,
  endGesture,
  getState,
  setUi,
  updateGesture,
  select,
} from '../state/store';
import { targetContainer } from '../state/actions';
import { hitTest } from '../render/hittest';
import { artboardRelative, drawHover, drawSelectionOutlines, fmt, hudXY, newShapeAppearance } from './common';
import {
  beginShapeWidget,
  dragShapeWidget,
  drawShapeWidgets,
  endShapeWidget,
  shapeWidgetActive,
  shapeWidgetAt,
} from './shapeHandles';

type Kind = 'rect' | 'ellipse' | 'star';

function makeShapeTool(kind: Kind): Tool {
  let drawing: { id: string } | null = null;
  let last: ToolPointer | null = null;

  const build = (e: ToolPointer, api: ToolApi): { node: SceneNode; w: number; h: number } => {
    const a = api.snap(e.downWorld, []).point;
    let b = api.snap(e.world, drawing ? [drawing.id] : []).point;
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    if (e.shift || kind === 'star') {
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * s;
      dy = Math.sign(dy || 1) * s;
      b = [a[0] + dx, a[1] + dy];
    }
    const fromCenter = e.alt || kind === 'star';
    const x0 = fromCenter ? a[0] - Math.abs(dx) : Math.min(a[0], b[0]);
    const y0 = fromCenter ? a[1] - Math.abs(dy) : Math.min(a[1], b[1]);
    const w = fromCenter ? Math.abs(dx) * 2 : Math.abs(dx);
    const h = fromCenter ? Math.abs(dy) * 2 : Math.abs(dy);
    const ap = newShapeAppearance();
    let node: SceneNode;
    if (kind === 'rect') node = makeRect(x0, y0, w, h, ap);
    else if (kind === 'ellipse') node = makeEllipse(x0 + w / 2, y0 + h / 2, w / 2, h / 2, ap);
    else {
      const ui = getState().ui;
      node = makeStar(a[0], a[1], Math.hypot(dx, dy) / Math.SQRT2, ui.starPoints, ui.starPolygon, ap);
      // Point the first tip toward the cursor when not constrained.
      if (!e.shift) {
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2 - Math.PI / 4;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        node.transform = [c, s, -s, c, a[0], a[1]];
      }
    }
    return { node, w, h };
  };

  const preview = (e: ToolPointer, api: ToolApi) => {
    const { node, w, h } = build(e, api);
    if (drawing) node.id = drawing.id;
    const od = api.od;
    const artboardId = api.artboardAt(e.downWorld);
    updateGesture((d) => {
      const t = targetContainer(d, artboardId, od.isolation);
      const n = clone(node);
      n.transform = multiply(invert(t.world), n.transform);
      t.list.push(n as never);
    });
    const unit = api.doc.units;
    api.overlay.hud = {
      at: e.screen,
      lines: [hudXY(artboardRelative(api, e.world), unit), `${fmt(w, unit)} × ${fmt(h, unit)} ${unit}`],
    };
  };

  return {
    cursor: 'crosshair',
    down(e, api) {
      const w = shapeWidgetAt(api, e.screen);
      if (w) {
        beginShapeWidget(api, w);
        return;
      }
      drawing = null;
      last = e;
      beginGesture();
    },
    move(e, api) {
      if (shapeWidgetActive()) {
        dragShapeWidget(e, api);
        api.render();
        return;
      }
      if (!e.dragging) {
        const s = api.snap(e.world, []);
        api.overlay.guides = s.guides;
        api.overlay.cursor = shapeWidgetAt(api, e.screen) ? 'pointer' : null;
        const hit = hitTest(api.doc, e.world, api.px(3), { isolation: api.od.isolation });
        api.overlay.hoverId = hit?.node.id ?? null;
        api.render();
        return;
      }
      if (!e.moved) return;
      last = e;
      if (!drawing) drawing = { id: build(e, api).node.id };
      preview(e, api);
      api.render();
    },
    up(e, api) {
      if (shapeWidgetActive()) {
        endShapeWidget(api);
        api.render();
        return;
      }
      api.overlay.hud = null;
      api.overlay.guides = [];
      if (!drawing || !e.moved) {
        cancelGesture();
        // A click selects whatever is under the cursor so its widgets can be used.
        const hit = hitTest(api.doc, e.world, api.px(3), { isolation: api.od.isolation });
        select(hit ? [hit.node.id] : []);
        drawing = null;
        api.render();
        return;
      }
      const id = drawing.id;
      drawing = null;
      endGesture(
        kind === 'rect'
          ? 'Rectangle'
          : kind === 'ellipse'
            ? 'Ellipse'
            : getState().ui.starPolygon
              ? 'Polygon'
              : 'Star',
        [id],
      );
      api.render();
    },
    key(e, api) {
      if (kind === 'star' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const ui = getState().ui;
        setUi({ starPoints: Math.max(3, Math.min(64, ui.starPoints + (e.key === 'ArrowUp' ? 1 : -1))) });
        if (drawing && last) {
          preview(last, api);
          api.render();
        }
        return true;
      }
      if (e.key === 'Escape' && drawing) {
        cancelGesture();
        drawing = null;
        api.overlay.hud = null;
        api.render();
        return true;
      }
      return false;
    },
    overlay(ctx, api) {
      drawHover(ctx, api);
      if (!drawing) {
        drawSelectionOutlines(ctx, api, api.od.selection, 1);
        drawShapeWidgets(ctx, api);
      }
    },
    cancel() {
      if (drawing) cancelGesture();
      drawing = null;
    },
  };
}

export const rectTool = makeShapeTool('rect');
export const ellipseTool = makeShapeTool('ellipse');
export const starTool = makeShapeTool('star');

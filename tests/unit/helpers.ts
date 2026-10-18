import { getState, newDocument, resetStore, setView, activeDoc } from '../../src/state/store';
import { createToolApi, sharedOverlay } from '../../src/tools/api';
import type { ToolApi, ToolPointer } from '../../src/tools/types';
import type { Tool } from '../../src/tools/types';
import type { Vec } from '../../src/core/types';

/** Fresh store with one 400×300 pt document, viewed at 100% with the artboard at the origin. */
export function freshDoc() {
  resetStore();
  newDocument({ name: 'Test', width: 400, height: 300, units: 'pt' });
  setView({ zoom: 1, panX: 0, panY: 0 });
  getState().snapping.objects = false;
  getState().snapping.guides = false;
  getState().snapping.nodes = false;
  getState().snapping.angles = false;
  return activeDoc()!;
}

const overlay = sharedOverlay();
const canvas = document.createElement('canvas');

let sampler: ToolApi['sample'] = () => null;
/** Pretend the canvas shows this color everywhere (jsdom has no canvas to read). */
export function setSampledColor(color: { r: number; g: number; b: number; a?: number } | null) {
  sampler = (_screen, size = 1) =>
    color
      ? {
          color: { space: 'srgb', r: color.r, g: color.g, b: color.b, a: color.a ?? 1 },
          data: new Uint8ClampedArray(size * size * 4),
          size,
        }
      : null;
}

export function api(): ToolApi {
  return createToolApi(
    canvas,
    overlay,
    () => undefined,
    (p, n) => sampler(p, n),
  )!;
}

const ptr = (world: Vec, down: Vec, o: Partial<ToolPointer> = {}): ToolPointer => ({
  world,
  screen: world,
  shift: false,
  alt: false,
  mod: false,
  button: 0,
  pressure: 0.5,
  dragging: true,
  downWorld: down,
  downScreen: down,
  moved: Math.hypot(world[0] - down[0], world[1] - down[1]) > 3,
  clickCount: 1,
  ...o,
});

/** Drive a tool through down → moves → up in world coordinates (zoom 1, so world = screen). */
export function drag(tool: Tool, from: Vec, to: Vec, o: Partial<ToolPointer> = {}, steps = 4) {
  tool.down?.(ptr(from, from, o), api());
  for (let i = 1; i <= steps; i++) {
    const p: Vec = [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps];
    tool.move?.(ptr(p, from, o), api());
  }
  tool.up?.(ptr(to, from, { ...o, dragging: false }), api());
}

export function click(tool: Tool, at: Vec, o: Partial<ToolPointer> = {}) {
  tool.down?.(ptr(at, at, o), api());
  tool.up?.(ptr(at, at, { ...o, dragging: false, moved: false }), api());
}

export const doc = () => activeDoc()!.doc;
export const children = () => doc().artboards[0].children;

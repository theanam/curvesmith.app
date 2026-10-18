/* Hooks for automated browsers (Playwright e2e tests and the screenshot script). Only installed under WebDriver or in dev. */
import { getState, setState, select, setNodeSelection, setTool, openDocument } from './state/store';
import { locate, worldMatrix, allNodes } from './core/document';
import { apply } from './core/matrix';
import { nodeSubpaths } from './core/geometry/node';
import { toScreen } from './render/viewport';
import { SAMPLES } from './samples';
import type { ToolId } from './tools/ids';
import { worldBounds } from './core/geometry/node';

function hostOffset(): [number, number] {
  const r = (document.querySelector('[data-canvas-host]') as HTMLElement | null)?.getBoundingClientRect();
  return [r?.left ?? 0, r?.top ?? 0];
}

export function installAutomation() {
  const api = {
    getState,
    setState,
    select,
    setTool: (t: ToolId) => setTool(t),
    setNodeSelection,
    openSample(id: string) {
      const s = SAMPLES.find((x) => x.id === id)!;
      return openDocument(s.make(), { name: s.name, saved: false });
    },
    /** Node id by layer name in the active document. */
    idByName(name: string) {
      const od = getState().docs.find((d) => d.key === getState().activeKey);
      return od ? (allNodes(od.doc).find((n) => n.name === name)?.id ?? null) : null;
    },
    /** Client (page) coordinates of a path node. */
    nodePoint(id: string, sp: number, i: number): [number, number] | null {
      const od = getState().docs.find((d) => d.key === getState().activeKey);
      if (!od?.view) return null;
      const loc = locate(od.doc, id);
      if (!loc) return null;
      const n = nodeSubpaths(loc.node, od.doc)[sp]?.nodes[i];
      if (!n) return null;
      const s = toScreen(od.view, apply(worldMatrix(loc), [n.x, n.y]));
      const [ox, oy] = hostOffset();
      return [s[0] + ox, s[1] + oy];
    },
    /** Client coordinates of the center of a node's bounds. */
    centerOf(id: string): [number, number] | null {
      const od = getState().docs.find((d) => d.key === getState().activeKey);
      if (!od?.view) return null;
      const loc = locate(od.doc, id);
      const b = loc && worldBounds(loc, od.doc);
      if (!b) return null;
      const s = toScreen(od.view, [b.x + b.width / 2, b.y + b.height / 2]);
      const [ox, oy] = hostOffset();
      return [s[0] + ox, s[1] + oy];
    },
    /** Client coordinates of a world point. */
    worldToClient(x: number, y: number): [number, number] | null {
      const od = getState().docs.find((d) => d.key === getState().activeKey);
      if (!od?.view) return null;
      const s = toScreen(od.view, [x, y]);
      const [ox, oy] = hostOffset();
      return [s[0] + ox, s[1] + oy];
    },
    activeDoc() {
      return getState().docs.find((d) => d.key === getState().activeKey) ?? null;
    },
  };
  (window as unknown as { __curvesmith: typeof api }).__curvesmith = api;
}

import toolsJson from './tools.json';

export type ToolId =
  | 'move'
  | 'node'
  | 'pen'
  | 'pencil'
  | 'scissors'
  | 'builder'
  | 'rect'
  | 'ellipse'
  | 'star'
  | 'text'
  | 'gradient'
  | 'eyedropper'
  | 'hand'
  | 'zoom';

export type ToolDef = {
  id: ToolId;
  label: string;
  shortcut: string;
  groupStart: boolean;
  hint: string | null;
  icon: { viewBox: string; d: string };
};

export const TOOLS = toolsJson.tools as ToolDef[];
export const toolDef = (id: ToolId) => TOOLS.find((t) => t.id === id)!;

/** Single-key tool shortcuts. Shape builder is Shift+M, Star is '*' (also 8 on most layouts with Shift). */
export function toolForKey(e: Pick<KeyboardEvent, 'key' | 'shiftKey'>): ToolId | null {
  const k = e.key.toLowerCase();
  if (e.key === '*') return 'star';
  if (e.shiftKey && k === 'm') return 'builder';
  if (e.shiftKey) return null;
  const map: Record<string, ToolId> = {
    v: 'move',
    a: 'node',
    p: 'pen',
    n: 'pencil',
    c: 'scissors',
    m: 'rect',
    l: 'ellipse',
    t: 'text',
    g: 'gradient',
    i: 'eyedropper',
    h: 'hand',
    z: 'zoom',
  };
  return map[k] ?? null;
}

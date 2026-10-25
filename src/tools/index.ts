import type { ToolId } from './ids';
import type { Tool } from './types';
import { moveTool } from './move';
import { nodeTool } from './node';
import { penTool } from './pen';
import { pencilTool } from './pencil';
import { scissorsTool } from './scissors';
import { builderTool } from './builder';
import { ellipseTool, rectTool, starTool } from './shapes';
import { gradientTool, handTool, textTool, zoomTool } from './misc';
import { eyedropperTool } from './eyedropper';
import { cropTool } from './crop';
import type { EditorState } from '../state/store';

export const TOOL_IMPLS: Record<ToolId, Tool> = {
  move: moveTool,
  node: nodeTool,
  pen: penTool,
  pencil: pencilTool,
  scissors: scissorsTool,
  builder: builderTool,
  rect: rectTool,
  ellipse: ellipseTool,
  star: starTool,
  text: textTool,
  gradient: gradientTool,
  eyedropper: eyedropperTool,
  hand: handTool,
  zoom: zoomTool,
};

/** The tool that gets canvas input: a spring-loaded tool, then image crop editing, then the chosen tool. */
export function activeToolImpl(s: Pick<EditorState, 'springTool' | 'tool' | 'croppingImage'>): Tool {
  if (s.springTool) return TOOL_IMPLS[s.springTool];
  return s.croppingImage ? cropTool : TOOL_IMPLS[s.tool];
}

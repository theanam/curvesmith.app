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

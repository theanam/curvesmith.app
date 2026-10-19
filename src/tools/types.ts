import type { CurvsDocument, Matrix, SrgbColor, Vec } from '../core/types';
import type { OpenDoc, ViewState } from '../state/store';
import type { SmartGuide, SnapCandidates } from '../core/snapping';
import type { Rect } from '../core/geometry/bezier';

export type ToolPointer = {
  world: Vec;
  screen: Vec;
  shift: boolean;
  alt: boolean;
  /** ⌘ on macOS, Ctrl elsewhere. */
  mod: boolean;
  button: number;
  pressure: number;
  /** True between down and up. */
  dragging: boolean;
  /** World position at pointer down. */
  downWorld: Vec;
  downScreen: Vec;
  /** The pointer moved past the drag threshold since down. */
  moved: boolean;
  clickCount: number;
};

export type Hud = { at: Vec; lines: string[] } | null;

/** Transient on-canvas state. Lives outside React so pointer moves never re-render the UI. */
export type Overlay = {
  guides: SmartGuide[];
  hud: Hud;
  /** Screen-space marquee. */
  marquee: Rect | null;
  /** Extra screen-space drawing by the active tool. */
  draw: ((ctx: CanvasRenderingContext2D, api: ToolApi) => void) | null;
  hoverId: string | null;
  cursor: string | null;
};

export type ToolApi = {
  od: OpenDoc;
  doc: CurvsDocument;
  view: ViewState;
  toScreen(p: Vec): Vec;
  toWorld(p: Vec): Vec;
  /** World units for a screen distance in CSS pixels. */
  px(n: number): number;
  overlay: Overlay;
  render(): void;
  /** Snapping candidates in world space, excluding the given node ids. */
  snapCandidates(exclude: string[], includeNodes?: boolean): SnapCandidates;
  /** Snap a world point using current snapping settings. */
  snap(p: Vec, exclude?: string[]): { point: Vec; guides: SmartGuide[] };
  worldMatrixOf(id: string): Matrix | null;
  /** Artboard under a world point, or the active one. */
  artboardAt(p: Vec): string;
  canvas: HTMLCanvasElement;
  /**
   * Rendered pixels around a screen point (device pixels, `size`×`size`, centered), read from the
   * document canvas so overlays never get picked. Null when no canvas is available.
   */
  sample(screen: Vec, size?: number): PixelSample | null;
};

export type PixelSample = { color: SrgbColor; data: Uint8ClampedArray; size: number };

export interface Tool {
  cursor?: string;
  down?(e: ToolPointer, api: ToolApi): void;
  move?(e: ToolPointer, api: ToolApi): void;
  up?(e: ToolPointer, api: ToolApi): void;
  dblclick?(e: ToolPointer, api: ToolApi): void;
  /** A second finger landed mid-press: undo just this press and keep any work in progress. Falls back to cancel. */
  abortPress?(api: ToolApi): void;
  /** Return true when the key was handled. */
  key?(e: KeyboardEvent, api: ToolApi): boolean;
  keyUp?(e: KeyboardEvent, api: ToolApi): boolean;
  /** Draw screen-space overlays for this tool (selection handles, previews). */
  overlay?(ctx: CanvasRenderingContext2D, api: ToolApi): void;
  /** The pointer left the canvas. */
  leave?(api: ToolApi): void;
  /** Called when switching away or pressing Escape. */
  cancel?(api: ToolApi): void;
}

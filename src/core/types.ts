/* The Curvesmith document model. Mirrors docs/CURVS_FORMAT.md (document.json).
   Geometry is always stored in points (1/72 in). Node coordinates are artboard-relative. */

export type Unit = 'pt' | 'px' | 'mm' | 'cm' | 'in' | 'pc';

export type Vec = [number, number];
/** Affine matrix [a, b, c, d, e, f] — x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Matrix = [number, number, number, number, number, number];

/** Document grid: major lines every `spacing` pt, each split into `subdivisions`. */
export type GridSettings = { spacing: number; subdivisions: number; style: 'lines' | 'dots' };

/** Document color mode. */
export type ColorMode = 'srgb' | 'cmyk';

export type SrgbColor = { space: 'srgb'; r: number; g: number; b: number; a: number };
export type P3Color = { space: 'display-p3'; r: number; g: number; b: number; a: number };
export type CmykColor = { space: 'cmyk'; c: number; m: number; y: number; k: number; a: number };
export type SpotColor = { space: 'spot'; name: string; fallback: SrgbColor; a: number };
export type SwatchRef = { swatch: string };
export type Color = SrgbColor | P3Color | CmykColor | SpotColor | SwatchRef;

export type GradientStop = { offset: number; color: Color };
export type Paint =
  | { type: 'solid'; color: Color }
  | { type: 'linear' | 'radial' | 'conic'; stops: GradientStop[]; from: Vec; to: Vec };

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export type FillItem = {
  kind: 'fill';
  id: string;
  visible: boolean;
  paint: Paint;
  opacity: number;
  blend: BlendMode;
};

export type ArrowKind = 'arrow' | 'triangle' | 'circle' | 'square' | 'bar';

export type StrokeItem = {
  kind: 'stroke';
  id: string;
  visible: boolean;
  paint: Paint;
  opacity: number;
  blend: BlendMode;
  width: number;
  align: 'inside' | 'center' | 'outside';
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  miter: number;
  dash: number[];
  dashOffset: number;
  /** Width profile: [t (0–1 along path), scale (0–1)] pairs. Null means uniform. */
  profile: [number, number][] | null;
  arrowStart: ArrowKind | null;
  arrowEnd: ArrowKind | null;
};

export type Effect =
  | { type: 'dropShadow' | 'innerShadow'; x: number; y: number; blur: number; color: Color }
  | { type: 'blur'; radius: number };

export type EffectItem = { kind: 'effect'; id: string; visible: boolean; effect: Effect };

export type AppearanceItem = FillItem | StrokeItem | EffectItem;
export type Appearance = { items: AppearanceItem[] };

export type NodeKind = 'sharp' | 'smooth' | 'symmetric' | 'auto';
/** A path node. Handles are absolute (in the node's local space); null = no handle. */
export type PathNode = { x: number; y: number; in: Vec | null; out: Vec | null; kind: NodeKind };
export type Subpath = { closed: boolean; nodes: PathNode[] };

export type CornerKind = 'round' | 'chamfer' | 'inset';
export type Corner = { radius: number; kind: CornerKind };

type Base = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: BlendMode;
  transform: Matrix;
  appearance: Appearance;
  /** Unknown keys from newer writers are kept here and written back. */
  extra?: Record<string, unknown>;
};

export type GroupNode = Base & { type: 'group'; children: SceneNode[]; isolated?: boolean };
export type PathShape = Base & { type: 'path'; subpaths: Subpath[]; fillRule: 'nonzero' | 'evenodd' };
export type RectNode = Base & {
  type: 'rect';
  width: number;
  height: number;
  corners: [Corner, Corner, Corner, Corner];
};
export type EllipseNode = Base & {
  type: 'ellipse';
  rx: number;
  ry: number;
  /** Arc angles in degrees, 0 = 3 o'clock, clockwise. Full ellipse when equal or absent. */
  arcStart?: number;
  arcEnd?: number;
  pie?: boolean;
};
export type StarNode = Base & {
  type: 'star';
  points: number;
  outerRadius: number;
  innerRatio: number;
  rounding: number;
  polygon: boolean;
};

export type FontRef = { family: string; weight: number; style: 'normal' | 'italic' };
export type TextRun = {
  text: string;
  font: FontRef;
  size: number;
  tracking: number;
  /** Line height as a multiple of size. */
  leading: number;
  features: Record<string, boolean>;
};
export type TextNode = Base & {
  type: 'text';
  mode: 'point' | 'area' | 'onPath';
  pathRef?: string;
  box?: { width: number; height: number };
  runs: TextRun[];
  paragraph: { align: 'left' | 'center' | 'right' | 'justify'; indent: number };
};
export type ImageNode = Base & {
  type: 'image';
  asset: string;
  width: number;
  height: number;
  crop?: { x: number; y: number; width: number; height: number };
};
/** Parametric shape from the Shapes tool, generated inside its box (0,0)–(width,height). */
export type ShapeNode = Base & {
  type: 'shape';
  kind: import('./geometry/multishape').ShapeKind;
  width: number;
  height: number;
  params: Record<string, number | boolean>;
};
export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';
export type BooleanNode = Base & { type: 'boolean'; op: BooleanOp; children: SceneNode[] };
export type InstanceNode = Base & { type: 'instance'; symbol: string; overrides: Record<string, unknown> };
export type ClipGroupNode = Base & { type: 'clipGroup'; clip: SceneNode; children: SceneNode[] };

export type SceneNode =
  | GroupNode
  | PathShape
  | RectNode
  | EllipseNode
  | StarNode
  | ShapeNode
  | TextNode
  | ImageNode
  | BooleanNode
  | InstanceNode
  | ClipGroupNode;

export type ContainerNode = GroupNode | BooleanNode | ClipGroupNode;

export type Guide = { axis: 'x' | 'y'; pos: number };

export type Artboard = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  background: Color | null;
  guides: Guide[];
  children: SceneNode[];
};

export type Swatch = { id: string; name: string; color: Exclude<Color, SwatchRef>; global: boolean };
export type Style = { id: string; name: string; appearance: Appearance };
export type SymbolDef = { id: string; name: string; root: SceneNode };
export type FontEntry = { family: string; style: string; file?: string };

export type CurvsDocument = {
  id: string;
  units: Unit;
  /** Layout grid; missing means the default for the document's units. */
  grid?: GridSettings;
  /** RGB documents keep screen colors; CMYK documents keep ink values and export DeviceCMYK. */
  colorProfile: ColorMode;
  swatches: Swatch[];
  styles: Style[];
  symbols: SymbolDef[];
  fonts: FontEntry[];
  artboards: Artboard[];
  view?: { artboard: string; zoom: number; cx: number; cy: number };
  /** Embedded asset bytes as data URLs, keyed by "assets/<sha256>.<ext>". Not part of document.json. */
  assets: Record<string, string>;
  extra: Record<string, unknown>;
};

export type ImportReport = {
  format: string;
  warnings: string[];
  /** Short counts, e.g. { 'effects flattened': 3 }. */
  notes: Record<string, number>;
};

export type ExportScope =
  { kind: 'selection'; ids: string[] } | { kind: 'artboard'; id: string } | { kind: 'all' };

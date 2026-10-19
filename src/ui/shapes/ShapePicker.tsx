import * as P from '@radix-ui/react-popover';
import { useMemo, useState, type ReactNode } from 'react';
import { SHAPES, SHAPE_GROUPS, shapeDef, type ShapeToolKind } from '../../core/shapeCatalog';
import { defaultParams, isMultiShape } from '../../core/shapeCatalog';
import { shapeSubpaths } from '../../core/geometry/multishape';
import { starSubpaths } from '../../core/geometry/shapes';
import { toPathData } from '../../core/geometry/pathdata';
import { transformSubpath } from '../../core/geometry/bezier';
import { getState, setTool, setUi } from '../../state/store';
import { Icon } from '../icons';
import './shapes.css';

/** Glyph proportions for shapes that read better outside a square. */
const ASPECT: Partial<Record<ShapeToolKind, [number, number]>> = {
  arrow: [20, 13],
  chevron: [18, 16],
  parallelogram: [20, 13],
  trapezoid: [20, 14],
  segment: [20, 16],
  calloutRect: [20, 17],
  calloutEllipse: [20, 17],
  gem: [20, 16],
  shield: [16, 20],
  tear: [14, 20],
  bolt: [14, 20],
  arc: [20, 12],
};

const glyphCache = new Map<ShapeToolKind, string>();

/** Path data for a 24×24 glyph, drawn from the shape's real geometry with default parameters. */
export function glyphPath(kind: ShapeToolKind): string {
  const hit = glyphCache.get(kind);
  if (hit) return hit;
  let d: string;
  if (!isMultiShape(kind)) {
    const sp = starSubpaths({
      points: kind === 'polygon' ? 6 : 5,
      outerRadius: 10,
      innerRatio: 0.48,
      rounding: 0,
      polygon: kind === 'polygon',
    });
    d = toPathData(
      sp.map((s) => transformSubpath(s, [1, 0, 0, 1, 12, 12.5])),
      2,
    );
  } else {
    const [w, h] = ASPECT[kind] ?? [20, 20];
    const sp = shapeSubpaths(kind, w, h, defaultParams(kind));
    d = toPathData(
      sp.map((s) => transformSubpath(s, [1, 0, 0, 1, (24 - w) / 2, (24 - h) / 2])),
      2,
    );
  }
  glyphCache.set(kind, d);
  return d;
}

export function ShapeGlyph({ kind, size = 20 }: { kind: ShapeToolKind; size?: number }) {
  const open = !isMultiShape(kind) ? false : !!shapeDef(kind).open;
  return (
    <svg className="icon shape-glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path
        d={glyphPath(kind)}
        fillRule="evenodd"
        fill={open ? 'none' : 'currentColor'}
        fillOpacity={open ? undefined : 0.18}
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Choose a shape for the Shapes tool (and switch to it). */
export function chooseShape(kind: ShapeToolKind) {
  setUi({
    shapeKind: kind,
    starPolygon: kind === 'polygon' ? true : kind === 'star' ? false : getState().ui.starPolygon,
  });
  setTool('star');
}

/** The grouped list shown in the toolbar flyout and the tool options bar. */
export function ShapeList({ value, onPick }: { value: ShapeToolKind; onPick(kind: ShapeToolKind): void }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const groups = useMemo(
    () =>
      SHAPE_GROUPS.map((g) => ({
        g,
        items: SHAPES.filter((s) => s.group === g && (!query || s.label.toLowerCase().includes(query))),
      })).filter((x) => x.items.length),
    [query],
  );
  return (
    <div className="shape-list">
      <label className="shape-search">
        <Icon name="search" size={14} />
        <input
          autoFocus
          placeholder={`Search ${SHAPES.length} shapes`}
          aria-label="Search shapes"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && groups[0] && onPick(groups[0].items[0].kind)}
        />
      </label>
      <div className="shape-scroll" role="listbox" aria-label="Shapes">
        {groups.map(({ g, items }) => (
          <div key={g} role="group" aria-label={g}>
            <div className="shape-group">{g}</div>
            <div className="shape-grid">
              {items.map((s) => (
                <button
                  key={s.kind}
                  role="option"
                  aria-selected={s.kind === value}
                  className="shape-item"
                  onClick={() => onPick(s.kind)}
                  data-shape={s.kind}
                >
                  <ShapeGlyph kind={s.kind} size={22} />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {!groups.length && (
          <div className="muted" style={{ padding: 12 }}>
            No shapes match.
          </div>
        )}
      </div>
    </div>
  );
}

/** Popover wrapper around ShapeList, anchored to `children`. */
export function ShapePopover({
  open,
  onOpenChange,
  children,
  side = 'right',
  align = 'start',
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  children: ReactNode;
  side?: 'right' | 'bottom';
  align?: 'start' | 'center';
}) {
  const value = getState().ui.shapeKind;
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Anchor asChild>{children}</P.Anchor>
      <P.Portal>
        <P.Content
          className="popover shape-popover"
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={10}
          aria-label="Shapes"
        >
          <ShapeList
            value={value}
            onPick={(k) => {
              chooseShape(k);
              onOpenChange(false);
            }}
          />
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

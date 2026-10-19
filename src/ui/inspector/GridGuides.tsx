import type { Draft } from 'immer';
import type { CurvsDocument, GridSettings } from '../../core/types';
import { gridOf } from '../../core/grid';
import { fromPt, toPt } from '../../core/units';
import { addGuide, clearGuides, removeGuide, setGuidePos } from '../../state/guides';
import { getState, mutate, setState, setUi, useEditor, type OpenDoc } from '../../state/store';
import { NumberField } from '../controls/NumberField';
import { Segmented } from '../controls/Segmented';
import { Tip } from '../controls/Tooltip';
import { Icon } from '../icons';

const SUBDIVISIONS = [1, 2, 3, 4, 5, 6, 8, 10, 12];

function editGrid(patch: Partial<GridSettings>) {
  mutate(
    'Grid',
    (d) => {
      (d as Draft<CurvsDocument>).grid = { ...gridOf(d as CurvsDocument), ...patch };
    },
    undefined,
    { coalesce: 700 },
  );
}

/** Show, spacing, subdivisions, style and snapping for the document grid. */
export function GridControls({ od }: { od: OpenDoc }) {
  const show = useEditor((s) => s.ui.showGrid);
  const snap = useEditor((s) => s.snapping.grid);
  const g = gridOf(od.doc);
  const unit = od.doc.units;
  return (
    <>
      <div className="grid2">
        <NumberField
          label="Every"
          ariaLabel="Grid spacing"
          value={fromPt(g.spacing, unit)}
          unit={unit}
          mathUnit={unit}
          min={0.01}
          onChange={(v) => v > 0 && editGrid({ spacing: toPt(v, unit) })}
        />
        <NumberField
          label="Split"
          ariaLabel="Grid subdivisions"
          value={g.subdivisions}
          decimals={0}
          min={1}
          max={12}
          options={SUBDIVISIONS}
          onChange={(v) => editGrid({ subdivisions: Math.max(1, Math.round(v)) })}
        />
      </div>
      <Segmented<GridSettings['style']>
        label="Grid style"
        value={g.style}
        onChange={(style) => editGrid({ style })}
        options={[
          { value: 'lines', label: 'Lines' },
          { value: 'dots', label: 'Dots' },
        ]}
      />
      <div className="row grid-checks">
        <label className="check">
          <input type="checkbox" checked={show} onChange={(e) => setUi({ showGrid: e.target.checked })} />
          Show grid
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={snap}
            onChange={(e) => setState({ snapping: { ...getState().snapping, grid: e.target.checked } })}
          />
          Snap to grid
        </label>
      </div>
    </>
  );
}

/** Grid settings as an inspector section. */
export function GridSection({ od }: { od: OpenDoc }) {
  const show = useEditor((s) => s.ui.showGrid);
  return (
    <section className="insp-section">
      <div className="insp-head">
        <h3>Grid</h3>
        <div className="actions">
          <Tip label={show ? 'Hide grid' : 'Show grid'} shortcut="Mod+'">
            <button
              className="icon-btn sm"
              aria-label={show ? 'Hide grid' : 'Show grid'}
              aria-pressed={show}
              onClick={() => setUi({ showGrid: !show })}
            >
              <Icon name={show ? 'eye' : 'eyeOff'} size={14} />
            </button>
          </Tip>
        </div>
      </div>
      <GridControls od={od} />
    </section>
  );
}

/** The active artboard's guides with exact positions, plus add, lock and clear. */
export function GuidesSection({ od }: { od: OpenDoc }) {
  const show = useEditor((s) => s.ui.guides);
  const locked = useEditor((s) => s.ui.lockGuides);
  const ab = od.doc.artboards.find((a) => a.id === od.activeArtboard) ?? od.doc.artboards[0];
  if (!ab) return null;
  const unit = od.doc.units;
  return (
    <section className="insp-section">
      <div className="insp-head">
        <h3>Guides</h3>
        <div className="actions">
          <Tip label={show ? 'Hide guides' : 'Show guides'} shortcut="Mod+;">
            <button
              className="icon-btn sm"
              aria-label={show ? 'Hide guides' : 'Show guides'}
              aria-pressed={show}
              onClick={() => setUi({ guides: !show })}
            >
              <Icon name={show ? 'eye' : 'eyeOff'} size={14} />
            </button>
          </Tip>
          <Tip label={locked ? 'Unlock guides' : 'Lock guides'} shortcut="Mod+Alt+;">
            <button
              className="icon-btn sm"
              aria-label={locked ? 'Unlock guides' : 'Lock guides'}
              aria-pressed={locked}
              onClick={() => setUi({ lockGuides: !locked })}
            >
              <Icon name={locked ? 'lock' : 'unlock'} size={14} />
            </button>
          </Tip>
          <Tip label="Clear guides">
            <button
              className="icon-btn sm"
              aria-label="Clear guides"
              disabled={!ab.guides.length}
              onClick={() => clearGuides()}
            >
              <Icon name="trash" size={14} />
            </button>
          </Tip>
        </div>
      </div>
      {ab.guides.map((g, i) => (
        <div key={i} className="guide-row">
          <NumberField
            label={g.axis === 'x' ? 'X' : 'Y'}
            ariaLabel={`${g.axis === 'x' ? 'Vertical' : 'Horizontal'} guide ${i + 1}`}
            value={fromPt(g.pos, unit)}
            unit={unit}
            mathUnit={unit}
            onChange={(v) => setGuidePos({ artboard: ab.id, index: i }, toPt(v, unit))}
          />
          <Tip label="Delete guide">
            <button
              className="icon-btn sm"
              aria-label={`Delete guide ${i + 1}`}
              onClick={() => removeGuide({ artboard: ab.id, index: i })}
            >
              <Icon name="minus" size={14} />
            </button>
          </Tip>
        </div>
      ))}
      <div className="grid2">
        <button className="small-btn" onClick={() => addGuide('x')}>
          <Icon name="plus" size={13} /> Vertical
        </button>
        <button className="small-btn" onClick={() => addGuide('y')}>
          <Icon name="plus" size={13} /> Horizontal
        </button>
      </div>
      {!ab.guides.length && <div className="muted doc-stats">Or drag one out of a ruler.</div>}
    </section>
  );
}

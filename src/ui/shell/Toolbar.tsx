import { Fragment } from 'react';
import { TOOLS } from '../../tools/ids';
import { getState, setState, setTool, useEditor } from '../../state/store';
import { Icon } from '../icons';
import { Tip } from '../controls/Tooltip';
import { cssColor } from '../../core/color';
import { ColorPopover } from '../inspector/ColorPicker';
import { INK } from '../../core/document';

/** Fill/stroke swatch pair: X swaps focus, ⇧X swaps colors, D resets. */
function SwatchPair() {
  const d = useEditor((s) => s.defaults);
  const set = (patch: Partial<typeof d>) => setState({ defaults: { ...getState().defaults, ...patch } });
  return (
    <div className="swatch-pair" role="group" aria-label="Fill and stroke">
      <ColorPopover value={d.fill} allowNone onChange={(c) => set({ fill: c, focus: 'fill' })} side="right">
        <button
          className={`fill-sw ${d.focus === 'fill' ? 'focused' : ''} ${d.fill ? '' : 'none'}`}
          style={{ background: d.fill ? cssColor(d.fill) : 'var(--panel)' }}
          aria-label="Fill color"
          onFocus={() => set({ focus: 'fill' })}
        />
      </ColorPopover>
      <ColorPopover
        value={d.stroke}
        allowNone
        onChange={(c) => set({ stroke: c, focus: 'stroke' })}
        side="right"
      >
        <button
          className={`stroke-sw ${d.focus === 'stroke' ? 'focused' : ''} ${d.stroke ? '' : 'none'}`}
          style={{ ['--sw-color' as string]: d.stroke ? cssColor(d.stroke) : 'transparent' }}
          aria-label="Stroke color"
          onFocus={() => set({ focus: 'stroke' })}
        />
      </ColorPopover>
      <Tip label="Swap fill and stroke" shortcut="Shift+X" side="right">
        <button className="sw-mini swap" aria-label="Swap fill and stroke" onClick={swapColors}>
          <svg
            viewBox="0 0 12 12"
            width="11"
            height="11"
            aria-hidden
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2.5 4.5V4A1.5 1.5 0 0 1 4 2.5h5.5M7.5 1l2 1.5-2 1.5M9.5 7.5V8A1.5 1.5 0 0 1 8 9.5H2.5M4.5 11l-2-1.5 2-1.5" />
          </svg>
        </button>
      </Tip>
      <Tip label="Default colors" shortcut="D" side="right">
        <button className="sw-mini reset" aria-label="Default colors" onClick={resetColors}>
          <span className="mini-stroke" />
          <span className="mini-fill" />
        </button>
      </Tip>
    </div>
  );
}

export function swapFocus() {
  const d = getState().defaults;
  setState({ defaults: { ...d, focus: d.focus === 'fill' ? 'stroke' : 'fill' } });
}
export function swapColors() {
  const d = getState().defaults;
  setState({ defaults: { ...d, fill: d.stroke, stroke: d.fill } });
}
export function resetColors() {
  setState({
    defaults: {
      ...getState().defaults,
      fill: { space: 'srgb', r: 1, g: 1, b: 1, a: 1 },
      stroke: INK,
      strokeWidth: 1,
    },
  });
}

/** Tools split into their groups (tools.json `groupStart`), each laid out two per row. */
const GROUPS = TOOLS.reduce<(typeof TOOLS)[]>((groups, t) => {
  if (t.groupStart || !groups.length) groups.push([]);
  groups[groups.length - 1].push(t);
  return groups;
}, []);

export function Toolbar() {
  const tool = useEditor((s) => s.springTool ?? s.tool);
  return (
    <aside className="toolbar" aria-label="Tools">
      {GROUPS.map((group, gi) => (
        <Fragment key={group[0].id}>
          {gi > 0 && <div className="tool-sep" />}
          <div className="tool-group" role="group" aria-label={`${group.map((t) => t.label).join(', ')}`}>
            {group.map((t) => (
              <Tip key={t.id} label={t.label} shortcut={t.shortcut} side="right">
                <button
                  className="tool-btn"
                  aria-label={`${t.label} (${t.shortcut})`}
                  aria-pressed={tool === t.id}
                  onClick={() => setTool(t.id)}
                  data-tool={t.id}
                >
                  <Icon name={`tool-${t.id}`} size={20} />
                </button>
              </Tip>
            ))}
          </div>
        </Fragment>
      ))}
      <SwatchPair />
    </aside>
  );
}

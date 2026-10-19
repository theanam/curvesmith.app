import { IS_MAC } from '../../state/commands';
import { toggleModifier, useInput } from '../../state/input';
import { useActiveDoc } from '../../state/store';
import { Tip } from '../controls/Tooltip';
import { Icon } from '../icons';

/** Send a key through the app's normal keyboard handling (tools first, then commands). */
const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

/**
 * On-screen keys for touch screens: ⇧, ⌥ and ⌘ latch on until tapped again and apply to every canvas
 * gesture, so constrain, erase, duplicate and the like work without a keyboard.
 */
export function TouchBar() {
  const input = useInput();
  const od = useActiveDoc();
  if (!input.touch) return null;
  const mods = [
    { key: 'shift', glyph: '⇧', label: 'Shift' },
    { key: 'alt', glyph: IS_MAC ? '⌥' : 'Alt', label: IS_MAC ? 'Option' : 'Alt' },
    { key: 'mod', glyph: IS_MAC ? '⌘' : 'Ctrl', label: IS_MAC ? 'Command' : 'Ctrl' },
  ] as const;
  return (
    <div className="touch-bar" role="toolbar" aria-label="Touch keys" data-touch-bar>
      {mods.map((m) => (
        <Tip key={m.key} label={`${m.label} (stays on until tapped again)`} side="top">
          <button
            className="touch-key"
            aria-label={m.label}
            aria-pressed={input[m.key]}
            onClick={() => toggleModifier(m.key)}
          >
            {m.glyph}
          </button>
        </Tip>
      ))}
      <span className="touch-sep" />
      <Tip label="Delete" side="top">
        <button
          className="touch-key"
          aria-label="Delete"
          disabled={!od?.selection.length && !od?.nodeSelection.length}
          onClick={() => press('Backspace')}
        >
          <Icon name="trash" size={17} />
        </button>
      </Tip>
      <Tip label="Done (Esc)" side="top">
        <button className="touch-key" aria-label="Done" onClick={() => press('Escape')}>
          <Icon name="check" size={17} stroke={2} />
        </button>
      </Tip>
    </div>
  );
}

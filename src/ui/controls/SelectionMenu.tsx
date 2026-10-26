/* Right-click menu for the canvas and the Layers panel, built from the command registry. Shows only
   what applies to the selection (or, on an empty canvas, to the canvas). */
import * as M from '@radix-ui/react-dropdown-menu';
import { create } from 'zustand';
import type { Vec } from '../../core/types';
import { locate } from '../../core/document';
import { command, formatShortcut, isEnabled, run } from '../../state/commands';
import { activeDoc } from '../../state/store';
import { Icon } from '../icons';

type Entry = string | '-' | { label: string; items: string[] };

const PATHLIKE = new Set(['path', 'rect', 'ellipse', 'star', 'shape', 'boolean']);

function entriesFor(types: Set<string>): Entry[] {
  if (!types.size)
    return [
      'edit.paste',
      'edit.pasteInPlace',
      'edit.selectAll',
      '-',
      'file.place',
      '-',
      'view.fit',
      'view.fitAll',
      'view.actual',
      '-',
      'view.rulers',
      'view.guides',
      'view.grid',
      'view.outline',
    ];
  const only = (t: string) => types.size === 1 && types.has(t);
  const any = (pred: (t: string) => boolean) => [...types].some(pred);
  return [
    'edit.cut',
    'edit.copy',
    'edit.paste',
    'edit.pasteInPlace',
    'edit.duplicate',
    'edit.delete',
    '-',
    ...(only('image') ? ['object.cropImage', 'object.resetCrop', 'object.traceImage', '-'] : []),
    ...(only('text') ? ['type.outlines', '-'] : []),
    'object.group',
    ...(any((t) => t === 'group' || t === 'clipGroup') ? ['object.ungroup'] : []),
    { label: 'Arrange', items: ['object.front', 'object.forward', 'object.backward', 'object.back'] },
    {
      label: 'Align',
      items: [
        'object.alignLeft',
        'object.alignHCenter',
        'object.alignRight',
        'object.alignTop',
        'object.alignVCenter',
        'object.alignBottom',
        'object.distributeH',
        'object.distributeV',
      ],
    },
    {
      label: 'Combine',
      items: [
        'object.union',
        'object.subtract',
        'object.intersect',
        'object.exclude',
        'object.divide',
        'object.expand',
        'object.release',
      ],
    },
    ...(any((t) => PATHLIKE.has(t))
      ? [
          {
            label: 'Path',
            items: [
              'object.join',
              'object.simplify',
              'object.reverse',
              'object.outlineStroke',
              'object.compound',
              'object.releaseCompoundPath',
            ],
          },
        ]
      : []),
    'object.clip',
    '-',
    'object.flipH',
    'object.flipV',
    'object.transformAgain',
    '-',
    'object.symbol',
    'object.lock',
    '-',
    'view.fitSelection',
  ];
}

/** Drop disabled commands, empty submenus and doubled, leading or trailing separators. */
function visible(entries: Entry[]): Entry[] {
  const kept = entries
    .map((e) => (typeof e === 'object' ? { ...e, items: e.items.filter((id) => isEnabled(command(id))) } : e))
    .filter((e) => (typeof e === 'object' ? e.items.length > 0 : e === '-' || isEnabled(command(e))));
  return kept.filter((e, i) => e !== '-' || (i > 0 && i < kept.length - 1 && kept[i - 1] !== '-'));
}

function Item({ id }: { id: string }) {
  const c = command(id);
  const checked = c.checked?.();
  return (
    <M.Item className="menu-item" onSelect={() => void run(id)}>
      {c.checked && (
        <span className="menu-check" aria-hidden>
          {checked && <Icon name="check" size={13} stroke={2} />}
        </span>
      )}
      {c.title}
      {c.shortcut && <span className="kbd-hint">{formatShortcut(c.shortcut)}</span>}
    </M.Item>
  );
}

type Extra = { label: string; onSelect(): void };
const useMenu = create<{ at: Vec | null; extras: Extra[] }>(() => ({ at: null, extras: [] }));

/** Open the menu at a client point, with optional extra items on top (such as Rename in Layers). */
export function openSelectionMenu(at: Vec, extras: Extra[] = []) {
  useMenu.setState({ at, extras });
}

/** Mounted once; shows while opened by `openSelectionMenu`. */
export function SelectionMenu() {
  const { at, extras } = useMenu();
  const onClose = () => useMenu.setState({ at: null, extras: [] });
  if (!at) return null;
  const od = activeDoc();
  const types = new Set(
    (od?.selection ?? []).map((id) => (od ? locate(od.doc, id)?.node.type : undefined) ?? ''),
  );
  types.delete('');
  const entries = visible(entriesFor(types));
  return (
    <M.Root open onOpenChange={(o) => !o && onClose()}>
      <M.Trigger asChild>
        <span aria-hidden style={{ position: 'fixed', left: at[0], top: at[1], width: 0, height: 0 }} />
      </M.Trigger>
      <M.Portal>
        <M.Content
          className="menu-content"
          aria-label="Object menu"
          align="start"
          side="bottom"
          sideOffset={2}
          collisionPadding={8}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {extras.map((x) => (
            // Run after the menu closes, so whatever it focuses (a rename field) keeps the focus.
            <M.Item key={x.label} className="menu-item" onSelect={() => setTimeout(x.onSelect)}>
              {x.label}
            </M.Item>
          ))}
          {extras.length > 0 && entries.length > 0 && <M.Separator className="menu-sep" />}
          {entries.map((e, i) =>
            e === '-' ? (
              <M.Separator key={i} className="menu-sep" />
            ) : typeof e === 'object' ? (
              <M.Sub key={e.label}>
                <M.SubTrigger className="menu-item">
                  {e.label}
                  <Icon name="chevronRight" size={13} style={{ marginLeft: 'auto' }} />
                </M.SubTrigger>
                <M.Portal>
                  <M.SubContent className="menu-content" sideOffset={4} alignOffset={-4}>
                    {e.items.map((id) => (
                      <Item key={id} id={id} />
                    ))}
                  </M.SubContent>
                </M.Portal>
              </M.Sub>
            ) : (
              <Item key={e} id={e} />
            ),
          )}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

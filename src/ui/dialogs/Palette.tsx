import { Command } from 'cmdk';
import * as D from '@radix-ui/react-dialog';
import { useMemo } from 'react';
import { COMMANDS, formatShortcut, isEnabled, run } from '../../state/commands';
import { closeDialog, getState, select, setActiveArtboard, setState, useEditor } from '../../state/store';
import { allNodes, locate, typeLabel } from '../../core/document';
import { Icon, type IconName } from '../icons';
import { NodeIcon } from '../inspector/Design';
import { toolDef } from '../../tools/ids';
import { colorToHex, resolveColor } from '../../core/color';
import { listRecent, openRecent, type RecentEntry } from '../../state/files';
import { useEffect, useState } from 'react';
import './palette.css';

const CAT_ICON: Record<string, IconName> = {
  File: 'file',
  Edit: 'command',
  Object: 'boolean',
  Type: 'text',
  View: 'eye',
  Help: 'help',
  Tool: 'tool-move',
};

/** ⌘K: tools, menu commands, layers by name, swatches, recent files. Every entry shows its shortcut. */
export function Palette() {
  const open = useEditor((s) => s.dialog === 'palette');
  const od = useEditor((s) => s.docs.find((d) => d.key === s.activeKey));
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  useEffect(() => {
    if (open) void listRecent().then(setRecent);
  }, [open]);
  const layers = useMemo(() => (od ? allNodes(od.doc).slice(0, 400) : []), [od]);
  return (
    <D.Root open={open} onOpenChange={(o) => !o && closeDialog()}>
      <D.Portal>
        <D.Overlay className="dialog-overlay" />
        <D.Content className="palette" aria-label="Command palette">
          <D.Title className="sr-only">Search</D.Title>
          <D.Description className="sr-only">Search tools, actions, layers, colors and files</D.Description>
          <Command label="Command palette" loop>
            <div className="palette-input">
              <Icon name="search" size={16} />
              <Command.Input autoFocus placeholder="Search tools, actions, layers…" />
            </div>
            <Command.List>
              <Command.Empty>Nothing found.</Command.Empty>
              {(['Tool', 'File', 'Edit', 'Object', 'Type', 'View', 'Help'] as const).map((cat) => {
                const items = COMMANDS.filter((c) => c.category === cat && isEnabled(c));
                if (!items.length) return null;
                return (
                  <Command.Group key={cat} heading={cat === 'Tool' ? 'Tools' : cat}>
                    {items.map((c) => (
                      <Command.Item
                        key={c.id}
                        value={`${c.title} ${c.keywords ?? ''} ${cat}`}
                        onSelect={() => void run(c.id)}
                      >
                        <Icon
                          name={cat === 'Tool' ? (`tool-${c.id.slice(5)}` as IconName) : CAT_ICON[cat]}
                          size={16}
                        />
                        <span>{c.title}</span>
                        {c.category === 'Tool' ? (
                          <span className="kbd">{toolDef(c.id.slice(5) as never).shortcut}</span>
                        ) : (
                          c.shortcut && <span className="kbd">{formatShortcut(c.shortcut)}</span>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                );
              })}
              {od && layers.length > 0 && (
                <Command.Group heading="Layers">
                  {layers.map((n) => (
                    <Command.Item
                      key={n.id}
                      value={`layer ${n.name} ${typeLabel[n.type]} ${n.id}`}
                      onSelect={() => {
                        const loc = locate(od.doc, n.id);
                        if (loc) setActiveArtboard(loc.artboard.id);
                        select([n.id]);
                        closeDialog();
                      }}
                    >
                      <NodeIcon n={n} size={16} />
                      <span>{n.name}</span>
                      <span className="muted small">{typeLabel[n.type]}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {od && od.doc.swatches.length > 0 && (
                <Command.Group heading="Colors">
                  {od.doc.swatches.map((sw) => (
                    <Command.Item
                      key={sw.id}
                      value={`color swatch ${sw.name}`}
                      onSelect={() => {
                        setState({
                          defaults: {
                            ...getState().defaults,
                            fill: sw.global ? { swatch: sw.id } : sw.color,
                          },
                        });
                        closeDialog();
                      }}
                    >
                      <span
                        className="pal-swatch"
                        style={{ background: `#${colorToHex(resolveColor(sw.color))}` }}
                      />
                      <span>{sw.name}</span>
                      <span className="muted small mono">#{colorToHex(resolveColor(sw.color))}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {recent.length > 0 && (
                <Command.Group heading="Recent files">
                  {recent.slice(0, 8).map((r) => (
                    <Command.Item
                      key={r.id}
                      value={`recent file ${r.name}`}
                      onSelect={() => {
                        closeDialog();
                        void openRecent(r);
                      }}
                    >
                      <Icon name="file" size={16} />
                      <span>{r.name}</span>
                      <span className="muted small">{r.ext}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

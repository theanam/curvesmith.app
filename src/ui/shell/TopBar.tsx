import * as M from '@radix-ui/react-dropdown-menu';
import * as P from '@radix-ui/react-popover';
import {
  MENUS,
  command,
  cycleTheme,
  formatShortcut,
  isEnabled,
  requestClose,
  run,
} from '../../state/commands';
import {
  isDirty,
  jumpHistory,
  openDialog,
  setActive,
  setState,
  setUi,
  undo,
  redo,
  useEditor,
} from '../../state/store';
import { Icon, Mark } from '../icons';
import { Tip } from '../controls/Tooltip';

function Menus() {
  // Re-render menus when the document/selection changes so enabled states are fresh.
  useEditor((s) => s.docs.find((d) => d.key === s.activeKey)?.selection);
  return (
    <nav className="menus" aria-label="Menus">
      {MENUS.map((m) => (
        <M.Root key={m.label} modal={false}>
          <M.Trigger className="menu-trigger">{m.label}</M.Trigger>
          <M.Portal>
            <M.Content className="menu-content" align="start" sideOffset={4}>
              {m.items.map((id, i) =>
                id === '-' ? (
                  <M.Separator key={i} className="menu-sep" />
                ) : (
                  <M.Item
                    key={id}
                    className="menu-item"
                    disabled={!isEnabled(command(id))}
                    onSelect={() => void run(id)}
                  >
                    {command(id).title}
                    {command(id).shortcut && (
                      <span className="kbd-hint">{formatShortcut(command(id).shortcut!)}</span>
                    )}
                  </M.Item>
                ),
              )}
            </M.Content>
          </M.Portal>
        </M.Root>
      ))}
    </nav>
  );
}

function Tabs() {
  const docs = useEditor((s) => s.docs);
  const active = useEditor((s) => s.activeKey);
  return (
    <div className="tabs" role="tablist" aria-label="Open documents">
      {docs.map((d) => (
        <div
          key={d.key}
          role="tab"
          tabIndex={0}
          aria-selected={d.key === active}
          className="doc-tab"
          onClick={() => setActive(d.key)}
          onKeyDown={(e) => e.key === 'Enter' && setActive(d.key)}
          onAuxClick={(e) => {
            if (e.button === 1) requestClose(d.key);
          }}
          title={`${d.name}${d.ext}`}
        >
          <span className="name">{d.name}</span>
          <span className="ext">{d.ext}</span>
          {isDirty(d) && <span className="dot" title="Unsaved changes" />}
          <button
            className="close"
            aria-label={`Close ${d.name}`}
            onClick={(e) => {
              e.stopPropagation();
              requestClose(d.key);
            }}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      <Tip label="New document" shortcut="Mod+N">
        <button
          className="icon-btn"
          aria-label="New document"
          onClick={() => openDialog('customSize')}
          style={{ color: 'var(--muted)' }}
        >
          <Icon name="plus" />
        </button>
      </Tip>
    </div>
  );
}

function HistoryButton() {
  const od = useEditor((s) => s.docs.find((d) => d.key === s.activeKey));
  const open = useEditor((s) => s.ui.historyOpen);
  const past = od?.history.past ?? [];
  const future = od?.history.future ?? [];
  const entries = [
    ...past.map((e, i) => ({ e, i: i + 1, done: true })),
    ...future.map((e, i) => ({ e, i: past.length + i + 1, done: false })),
  ];
  return (
    <P.Root open={open} onOpenChange={(o) => setUi({ historyOpen: o })}>
      <Tip label="History">
        <P.Trigger asChild>
          <button className="icon-btn" aria-label="History" disabled={!od}>
            <Icon name="history" size={17} stroke={1.7} />
          </button>
        </P.Trigger>
      </Tip>
      <P.Portal>
        <P.Content
          className="popover"
          align="end"
          sideOffset={6}
          style={{ width: 260, maxHeight: 420, overflow: 'auto', padding: 6 }}
        >
          <div className="muted" style={{ padding: '6px 10px', fontSize: 'var(--text-sm)' }}>
            History
          </div>
          <button
            className={`menu-item ${past.length === 0 ? 'current' : ''}`}
            style={{
              width: '100%',
              border: 0,
              background: past.length === 0 ? 'var(--accent-soft)' : 'transparent',
            }}
            onClick={() => jumpHistory(0)}
          >
            Opened
          </button>
          {entries.map(({ e, i, done }) => (
            <button
              key={i}
              className="menu-item"
              style={{
                width: '100%',
                border: 0,
                background: i === past.length ? 'var(--accent-soft)' : 'transparent',
                opacity: done ? 1 : 0.5,
              }}
              onClick={() => jumpHistory(i)}
            >
              {e.label}
              <span className="kbd-hint">
                {new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </button>
          ))}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

export function TopBar() {
  const theme = useEditor((s) => s.theme);
  const canUndo = useEditor((s) => !!s.docs.find((d) => d.key === s.activeKey)?.history.past.length);
  const canRedo = useEditor((s) => !!s.docs.find((d) => d.key === s.activeKey)?.history.future.length);
  const hasDoc = useEditor((s) => !!s.activeKey);
  const themeLabel =
    theme === 'light'
      ? 'Switch to dark mode'
      : theme === 'dark'
        ? 'Follow system theme'
        : 'Switch to light mode';
  return (
    <header className="topbar">
      <Tip label="Start screen">
        <button
          className="mark"
          aria-label="Curvesmith start screen"
          onClick={() => setState({ route: 'home', homeSection: 'home' })}
        >
          <Mark size={26} />
        </button>
      </Tip>
      <Menus />
      <div className="sep-v hide-sm" style={{ margin: '0 6px', height: 22 }} />
      <Tabs />
      <div style={{ flex: 1 }} className="spacer-sm" />
      <button
        className="search-btn"
        onClick={() => openDialog('palette')}
        aria-label="Search tools, actions, layers"
      >
        <Icon name="search" size={15} stroke={1.8} />
        <span>Search tools, actions, layers</span>
        <kbd className="mono" style={{ fontSize: 11 }}>
          {formatShortcut('Mod+K')}
        </kbd>
      </button>
      <div style={{ flex: 1 }} />
      <Tip label="Undo" shortcut="Mod+Z">
        <button className="icon-btn hide-sm" aria-label="Undo" disabled={!canUndo} onClick={undo}>
          <Icon name="undo" size={17} stroke={1.7} />
        </button>
      </Tip>
      <Tip label="Redo" shortcut="Mod+Shift+Z">
        <button className="icon-btn hide-sm" aria-label="Redo" disabled={!canRedo} onClick={redo}>
          <Icon name="redo" size={17} stroke={1.7} />
        </button>
      </Tip>
      <span className="hide-sm">
        <HistoryButton />
      </span>
      <Tip label={themeLabel}>
        <button className="icon-btn" aria-label={themeLabel} onClick={cycleTheme}>
          <Icon
            name={theme === 'light' ? 'moon' : theme === 'dark' ? 'system' : 'sun'}
            size={17}
            stroke={1.7}
          />
        </button>
      </Tip>
      <Tip label="Export" shortcut="Mod+Shift+E">
        <button
          className="btn btn-primary"
          style={{ marginLeft: 4, padding: '0 14px' }}
          disabled={!hasDoc}
          onClick={() => openDialog('export')}
        >
          <Icon name="export" size={15} stroke={2} />
          Export
        </button>
      </Tip>
    </header>
  );
}

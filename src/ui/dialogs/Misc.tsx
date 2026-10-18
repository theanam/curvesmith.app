import {
  closeDialog,
  closeDocument,
  getState,
  setState,
  useEditor,
  DEFAULT_UI,
  setUi,
} from '../../state/store';
import { Dialog } from '../controls/Dialog';
import { COMMANDS, formatShortcut } from '../../state/commands';
import { TOOLS } from '../../tools/ids';
import { saveDocument } from '../../state/files';
import { Segmented } from '../controls/Segmented';
import { lsSet } from '../../state/storage';

export function ShortcutsDialog() {
  const open = useEditor((s) => s.dialog === 'shortcuts');
  const groups = ['File', 'Edit', 'Object', 'Type', 'View', 'Help'] as const;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDialog()} title="Keyboard shortcuts" width={760}>
      <div className="shortcut-cols">
        <div>
          <h4>Tools</h4>
          {TOOLS.map((t) => (
            <div key={t.id} className="sc-row">
              <span>{t.label}</span>
              <span className="kbd">{t.shortcut}</span>
            </div>
          ))}
          <div className="sc-row">
            <span>Finish, then back to Move</span>
            <span className="kbd">Esc</span>
          </div>
          <div className="sc-row">
            <span>Pan (any tool)</span>
            <span className="kbd">Space</span>
          </div>
          <div className="sc-row">
            <span>Swap fill and stroke focus</span>
            <span className="kbd">X</span>
          </div>
          <div className="sc-row">
            <span>Swap fill and stroke colors</span>
            <span className="kbd">{formatShortcut('Shift+X')}</span>
          </div>
          <div className="sc-row">
            <span>Default colors</span>
            <span className="kbd">D</span>
          </div>
          <div className="sc-row">
            <span>Nudge (×10 with ⇧)</span>
            <span className="kbd">← ↑ → ↓</span>
          </div>
        </div>
        {groups.map((g) => {
          const items = COMMANDS.filter((c) => c.category === g && c.shortcut);
          if (!items.length) return null;
          return (
            <div key={g}>
              <h4>{g}</h4>
              {items.map((c) => (
                <div key={c.id} className="sc-row">
                  <span>{c.title}</span>
                  <span className="kbd">{formatShortcut(c.shortcut!)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

export function ImportReportDialog() {
  const open = useEditor((s) => s.dialog === 'importReport');
  const od = useEditor((s) => s.docs.find((d) => d.key === s.activeKey));
  const r = od?.importReport;
  return (
    <Dialog
      open={open && !!r}
      onOpenChange={(o) => !o && closeDialog()}
      title="Import report"
      width={460}
      footer={
        <button className="btn btn-primary" onClick={closeDialog}>
          OK
        </button>
      }
    >
      {r && (
        <>
          <p className="dialog-desc">
            Opened{' '}
            <strong>
              {od?.name}
              {od?.ext}
            </strong>{' '}
            ({r.format.toUpperCase()}). Some content changed on the way in:
          </p>
          <ul className="report-list">
            {Object.entries(r.notes).map(([k, n]) => (
              <li key={k}>
                <span className="mono">{n}</span> {k}
              </li>
            ))}
            {r.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}

export function CloseConfirmDialog() {
  const open = useEditor((s) => s.dialog === 'closeConfirm');
  const key = useEditor((s) => s.closingKey);
  const od = useEditor((s) => s.docs.find((d) => d.key === s.closingKey));
  const done = () => {
    setState({ closingKey: null });
    closeDialog();
  };
  return (
    <Dialog
      open={open && !!od}
      onOpenChange={(o) => !o && done()}
      title="Save changes?"
      width={440}
      footer={
        <>
          <button
            className="btn"
            style={{ marginRight: 'auto' }}
            onClick={() => {
              if (key) closeDocument(key);
              done();
            }}
          >
            Don’t save
          </button>
          <button className="btn" onClick={done}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              if (!key) return;
              setState({ activeKey: key });
              const ok = await saveDocument(false);
              if (ok) closeDocument(key);
              done();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <p className="dialog-desc">
        <strong>{od?.name}</strong> has changes that are not saved to a file. A copy stays in Files on this
        device.
      </p>
    </Dialog>
  );
}

export function PreferencesDialog() {
  const open = useEditor((s) => s.dialog === 'preferences');
  const theme = useEditor((s) => s.theme);
  const snapping = useEditor((s) => s.snapping);
  const ui = useEditor((s) => s.ui);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDialog()} title="Preferences" width={480}>
      <div className="pref-row">
        <span>Theme</span>
        <Segmented
          label="Theme"
          value={theme}
          onChange={(t) => setState({ theme: t })}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
        />
      </div>
      <div className="pref-row">
        <span>Snapping</span>
        <div className="row" style={{ flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' }}>
          {(Object.keys(snapping) as (keyof typeof snapping)[]).map((k) => (
            <button
              key={k}
              className="chip"
              aria-pressed={snapping[k]}
              onClick={() => setState({ snapping: { ...snapping, [k]: !snapping[k] } })}
            >
              {k === 'pixel' ? 'Pixel grid' : k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <label className="pref-row check">
        <span>Rulers</span>
        <input type="checkbox" checked={ui.rulers} onChange={(e) => setUi({ rulers: e.target.checked })} />
      </label>
      <label className="pref-row check">
        <span>Show all node handles</span>
        <input
          type="checkbox"
          checked={ui.showAllHandles}
          onChange={(e) => setUi({ showAllHandles: e.target.checked })}
        />
      </label>
      <div className="pref-row">
        <span>Layout</span>
        <button
          className="btn"
          onClick={() => {
            setState({ ui: { ...DEFAULT_UI } });
          }}
        >
          Reset panels
        </button>
      </div>
      <div className="pref-row">
        <span>First-run tour</span>
        <button
          className="btn"
          onClick={() => {
            lsSet('curvesmith.tour', null);
            setState({ dialog: 'tour' });
          }}
        >
          Show again
        </button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Preferences are stored in this browser. {getState().docs.length} document
        {getState().docs.length === 1 ? '' : 's'} open.
      </p>
    </Dialog>
  );
}

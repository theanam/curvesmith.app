import { useState } from 'react';
import { closeDialog, useEditor } from '../../state/store';
import { Dialog } from '../controls/Dialog';
import { createFromPreset, PRESETS, userPresets, type Preset } from '../home/Home';
import { UNITS, toPt, fromPt } from '../../core/units';
import type { Unit } from '../../core/types';
import { lsSet } from '../../state/storage';
import { Icon } from '../icons';
import { Tip } from '../controls/Tooltip';

export function NewDocumentDialog() {
  const open = useEditor((s) => s.dialog === 'customSize');
  const [name, setName] = useState('Untitled');
  const [unit, setUnit] = useState<Unit>('mm');
  const [w, setW] = useState('210');
  const [h, setH] = useState('297');
  const [mine, setMine] = useState<Preset[]>(userPresets);
  const W = parseFloat(w);
  const H = parseFloat(h);
  const valid = W > 0 && H > 0 && toPt(W, unit) <= 200000 && toPt(H, unit) <= 200000;
  const changeUnit = (u: Unit) => {
    if (W > 0) setW(String(Math.round(fromPt(toPt(W, unit), u) * 100) / 100));
    if (H > 0) setH(String(Math.round(fromPt(toPt(H, unit), u) * 100) / 100));
    setUnit(u);
  };
  const pick = (p: Preset) => {
    setUnit(p.unit);
    setW(String(p.w));
    setH(String(p.h));
    setName(p.name);
  };
  const create = () => {
    if (!valid) return;
    createFromPreset({ name: name.trim() || 'Untitled', w: W, h: H, unit });
    closeDialog();
  };
  const savePreset = () => {
    const p: Preset = {
      id: `u${Date.now()}`,
      name: name.trim() || `${W} × ${H} ${unit}`,
      w: W,
      h: H,
      unit,
      label: `${W} × ${H} ${unit}`,
    };
    const next = [...mine, p];
    setMine(next);
    lsSet('curvesmith.presets', next);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && closeDialog()}
      title="New document"
      width={520}
      footer={
        <>
          <Tip label="Save as preset">
            <button
              className="btn btn-ghost"
              style={{ marginRight: 'auto' }}
              onClick={savePreset}
              disabled={!valid}
              aria-label="Save as preset"
            >
              <Icon name="pin" /> Save preset
            </button>
          </Tip>
          <button className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={create} disabled={!valid}>
            Create
          </button>
        </>
      }
    >
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {[...PRESETS, ...mine].map((p) => (
          <button
            key={p.id}
            className="chip"
            aria-pressed={p.w === W && p.h === H && p.unit === unit}
            onClick={() => pick(p)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <label className="field">
          <span className="label">Name</span>
          <input
            aria-label="Document name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ fontFamily: 'var(--font-ui)' }}
            autoFocus
          />
        </label>
        <div className="row">
          <label className="field" style={{ flex: 1 }}>
            <span className="label">W</span>
            <input aria-label="Width" inputMode="decimal" value={w} onChange={(e) => setW(e.target.value)} />
          </label>
          <Tip label="Swap">
            <button
              type="button"
              className="icon-btn sm"
              aria-label="Swap width and height"
              onClick={() => (setW(h), setH(w))}
            >
              <Icon name="swap" size={14} />
            </button>
          </Tip>
          <label className="field" style={{ flex: 1 }}>
            <span className="label">H</span>
            <input aria-label="Height" inputMode="decimal" value={h} onChange={(e) => setH(e.target.value)} />
          </label>
          <label className="field" style={{ width: 80 }}>
            <select aria-label="Units" value={unit} onChange={(e) => changeUnit(e.target.value as Unit)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

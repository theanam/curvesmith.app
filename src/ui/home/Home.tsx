import { useEffect, useMemo, useState } from 'react';
import {
  newDocument,
  openDialog,
  openDocument,
  setState,
  useEditor,
  type HomeSection,
} from '../../state/store';
import {
  deleteAutosave,
  listAutosaves,
  listRecent,
  openAutosave,
  openFile,
  openFiles,
  openRecent,
  removeRecent,
  type AutosaveEntry,
  type RecentEntry,
} from '../../state/files';
import { formatShortcut, REPO_URL } from '../../state/commands';
import { isDarkTheme } from '../../state/prefs';
import { GitHubMark, Icon, Mark, type IconName } from '../icons';
import { toPt } from '../../core/units';
import type { Unit } from '../../core/types';
import { SAMPLES } from '../../samples';
import { navigate } from '../router';
import { Tip } from '../controls/Tooltip';
import { lsGet } from '../../state/storage';
import './home.css';

export type Preset = {
  id: string;
  name: string;
  w: number;
  h: number;
  unit: Unit;
  label: string;
  radius?: boolean;
};

export const PRESETS: Preset[] = [
  { id: 'a4', name: 'A4', w: 210, h: 297, unit: 'mm', label: '210 × 297 mm' },
  { id: 'letter', name: 'US Letter', w: 8.5, h: 11, unit: 'in', label: '8.5 × 11 in' },
  { id: 'social', name: 'Social square', w: 1080, h: 1080, unit: 'px', label: '1080 × 1080 px' },
  { id: 'icon', name: 'App icon', w: 1024, h: 1024, unit: 'px', label: '1024 × 1024 px', radius: true },
  { id: 'slides', name: 'Presentation', w: 1920, h: 1080, unit: 'px', label: '1920 × 1080 px' },
];

export function createFromPreset(p: { name: string; w: number; h: number; unit: Unit }) {
  newDocument({
    name: p.name === 'Custom size' ? 'Untitled' : p.name,
    width: toPt(p.w, p.unit),
    height: toPt(p.h, p.unit),
    units: p.unit,
  });
}

export const userPresets = (): Preset[] => lsGet<Preset[]>('curvesmith.presets', []);

const FORMATS = [
  '.curvs',
  '.ai',
  '.svg',
  '.svgz',
  '.pdf',
  '.eps',
  '.cdr',
  '.dxf',
  '.emf / .wmf',
  '.png / .jpg to trace',
];

function ago(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function PresetThumb({ p }: { p: Preset }) {
  const ratio = p.w / p.h;
  const h = ratio >= 1 ? 50 / ratio : 70;
  const w = ratio >= 1 ? Math.min(84, 50 * ratio) : 70 * ratio;
  const box = ratio >= 1 ? { width: w, height: Math.min(h, 60) } : { width: w, height: h };
  return (
    <div className="preset-thumb">
      <div className="preset-paper" style={{ ...box, borderRadius: p.radius ? 12 : 1 }} />
    </div>
  );
}

function FileCard({
  title,
  meta,
  thumb,
  onOpen,
  onRemove,
}: {
  title: string;
  meta: string;
  thumb: string | null;
  onOpen(): void;
  onRemove?(): void;
}) {
  return (
    <div className="file-card">
      <button className="file-open" onClick={onOpen} aria-label={`Open ${title}`}>
        <div className="file-thumb">
          {thumb ? <img src={thumb} alt="" /> : <Icon name="file" size={28} />}
        </div>
        <div className="file-meta">
          <strong>{title}</strong>
          <span>{meta}</span>
        </div>
      </button>
      {onRemove && (
        <Tip label="Remove">
          <button className="icon-btn sm file-remove" aria-label={`Remove ${title}`} onClick={onRemove}>
            <Icon name="close" size={13} />
          </button>
        </Tip>
      )}
    </div>
  );
}

function useStoredFiles() {
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [saved, setSaved] = useState<AutosaveEntry[]>([]);
  useEffect(() => {
    const load = () => {
      void listRecent().then(setRecent);
      void listAutosaves().then(setSaved);
    };
    load();
    window.addEventListener('curvesmith:recent', load);
    return () => window.removeEventListener('curvesmith:recent', load);
  }, []);
  return { recent, saved };
}

function DropZone() {
  const [over, setOver] = useState(false);
  return (
    <section
      className={`dropzone ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        [...e.dataTransfer.files].forEach((f) => void openFile(f));
      }}
      aria-label="Drop files to open"
    >
      <div className="drop-icon">
        <Icon name="upload" size={22} stroke={1.8} />
      </div>
      <div className="drop-text">
        <strong>Drop any vector file here to open it</strong>
        <div className="chips">
          {FORMATS.map((f, i) => (
            <span key={f} className={`fmt ${i === 0 ? 'native' : ''}`}>
              {f}
            </span>
          ))}
        </div>
        <span className="muted">Files open locally in your browser. Nothing is uploaded.</span>
      </div>
      <button className="btn btn-lg browse" onClick={() => void openFiles()}>
        Browse files
      </button>
    </section>
  );
}

export function Home() {
  const section = useEditor((s) => s.homeSection);
  const theme = useEditor((s) => s.theme);
  const dark = theme === 'dark' || (theme === 'system' && isDarkTheme());
  const docs = useEditor((s) => s.docs);
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const { recent, saved } = useStoredFiles();
  const query = q.trim().toLowerCase();
  const presets = useMemo(() => [...PRESETS, ...userPresets()], []);
  const filteredPresets = presets.filter((p) => !query || p.name.toLowerCase().includes(query));
  const filteredRecent = recent.filter((r) => !query || r.name.toLowerCase().includes(query));
  const nav: { id: HomeSection; label: string; icon: IconName }[] = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'files', label: 'Files on this device', icon: 'folder' },
    { id: 'libraries', label: 'Libraries', icon: 'libraries' },
  ];

  return (
    <div className="home">
      <aside className="home-side">
        <div className="home-logo">
          <Mark size={30} />
          <img src="/brand/wordmark-ink.svg" alt="curvesmith" className="wm wm-light" height={20} />
          <img src="/brand/wordmark-paper.svg" alt="" aria-hidden className="wm wm-dark" height={20} />
        </div>
        <nav aria-label="Start screen">
          {nav.map((n) => (
            <button
              key={n.id}
              className="side-item"
              aria-current={section === n.id ? 'page' : undefined}
              onClick={() => setState({ homeSection: n.id })}
            >
              <Icon name={n.icon} size={17} />
              {n.label}
            </button>
          ))}
          {docs.length > 0 && (
            <button className="side-item" onClick={() => setState({ route: 'editor' })}>
              <Icon name="arrowRight" size={17} />
              Back to editor
            </button>
          )}
        </nav>
        <div style={{ flex: 1 }} />
        <button className="side-item" onClick={() => setState({ theme: dark ? 'light' : 'dark' })}>
          <Icon name={dark ? 'sun' : 'moon'} size={17} />
          {dark ? 'Light mode' : 'Dark mode'}
        </button>
        <button className="side-item" onClick={() => openDialog('preferences')}>
          <Icon name="settings" size={17} />
          Preferences
        </button>
        <div className="side-foot">
          <Tip label="Help">
            <button className="icon-btn" aria-label="Help" onClick={() => navigate('help')}>
              <Icon name="help" size={17} />
            </button>
          </Tip>
          <Tip label="About">
            <button className="icon-btn" aria-label="About" onClick={() => navigate('about')}>
              <Icon name="info" size={17} />
            </button>
          </Tip>
          <Tip label="Take the tour">
            <button className="icon-btn" aria-label="Take the tour" onClick={() => openDialog('tour')}>
              <Icon name="tour" size={17} />
            </button>
          </Tip>
          <Tip label="Source on GitHub">
            <a
              className="icon-btn"
              aria-label="Source on GitHub"
              href={REPO_URL}
              target="_blank"
              rel="noopener"
            >
              <GitHubMark size={17} />
            </a>
          </Tip>
        </div>
      </aside>
      <main className="home-main">
        <header className="home-head">
          <h1>
            {section === 'home'
              ? 'Start something'
              : section === 'files'
                ? 'Files on this device'
                : 'Libraries'}
          </h1>
          <label className="home-search">
            <Icon name="search" size={15} />
            <input
              placeholder="Search files and templates"
              aria-label="Search files and templates"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="kbd">{formatShortcut('Mod+K')}</span>
          </label>
        </header>

        {section === 'home' && (
          <>
            <h2>New document</h2>
            <div className="presets">
              {filteredPresets.map((p) => (
                <button key={p.id} className="preset" onClick={() => createFromPreset(p)} data-preset={p.id}>
                  <PresetThumb p={p} />
                  <strong>{p.name}</strong>
                  <span className="mono muted">{p.label}</span>
                </button>
              ))}
              <button className="preset custom" onClick={() => openDialog('customSize')}>
                <div className="preset-thumb plain">
                  <Icon name="plus" size={22} stroke={1.4} />
                </div>
                <strong>Custom size</strong>
                <span className="mono muted">mm · in · px · pt</span>
              </button>
            </div>
            <DropZone />
            <div className="section-head">
              <h2>Recent</h2>
              {filteredRecent.length > 4 && (
                <button className="link-btn" onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'Show less' : 'Show all'}
                </button>
              )}
            </div>
            {filteredRecent.length ? (
              <div className="file-grid">
                {(showAll ? filteredRecent : filteredRecent.slice(0, 4)).map((r) => (
                  <FileCard
                    key={r.id}
                    title={r.name}
                    meta={`${r.ext} · edited ${ago(r.modified)}`}
                    thumb={r.thumbnail}
                    onOpen={() => void openRecent(r)}
                    onRemove={() => void removeRecent(r.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-files">
                <span className="muted">Files you open or save appear here.</span>
                <button className="btn" onClick={() => setState({ homeSection: 'libraries' })}>
                  <Icon name="libraries" /> Open a sample
                </button>
              </div>
            )}
          </>
        )}

        {section === 'files' && (
          <>
            <p className="muted lede">Autosaved copies live in this browser, with their full undo history.</p>
            {saved.length ? (
              <div className="file-grid">
                {saved
                  .filter((s) => !query || s.name.toLowerCase().includes(query))
                  .map((s) => (
                    <FileCard
                      key={s.id}
                      title={s.name}
                      meta={`${s.ext} · saved ${ago(s.modified)}`}
                      thumb={s.thumbnail}
                      onOpen={() => void openAutosave(s.id)}
                      onRemove={() => void deleteAutosave(s.id)}
                    />
                  ))}
              </div>
            ) : (
              <span className="muted">Nothing saved yet.</span>
            )}
          </>
        )}

        {section === 'libraries' && (
          <>
            <h2>Starter files</h2>
            <div className="file-grid">
              {SAMPLES.filter((s) => !query || s.name.toLowerCase().includes(query)).map((s) => (
                <SampleCard key={s.id} sample={s} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function SampleCard({ sample }: { sample: (typeof SAMPLES)[number] }) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void import('../../render/raster').then(async (m) => {
      const blob = await m.renderThumbnail(sample.make(), 360);
      if (blob && alive) setThumb(URL.createObjectURL(blob));
    });
    return () => {
      alive = false;
    };
  }, [sample]);
  return (
    <FileCard
      title={sample.name}
      meta={sample.desc}
      thumb={thumb}
      onOpen={() => {
        const doc = sample.make();
        openDocument(doc, { name: sample.name, saved: false });
        void import('../../fonts/loader').then((m) => m.ensureDocumentFonts(doc));
      }}
    />
  );
}

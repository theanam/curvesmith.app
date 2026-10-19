import type { ReactNode } from 'react';
import { TOOLS } from '../../tools/ids';
import { CONTACT_EMAIL, ISSUES_URL, REPO_URL, formatShortcut } from '../../state/commands';
import { back } from '../router';
import { GitHubMark, Icon, Mark, type IconName } from '../icons';
import { openDialog } from '../../state/store';
import './pages.css';

declare const __APP_VERSION__: string | undefined;

function PageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="page">
      <header className="page-top">
        <button className="btn btn-ghost" onClick={back}>
          <Icon name="arrowLeft" /> Back to app
        </button>
        <div style={{ flex: 1 }} />
        <a className="btn btn-ghost" href={REPO_URL} target="_blank" rel="noopener">
          <GitHubMark /> GitHub
        </a>
      </header>
      <main className="page-main">
        <div className="page-brand">
          <Mark size={40} />
          <h1>{title}</h1>
        </div>
        {children}
      </main>
    </div>
  );
}

function Contact() {
  return (
    <div className="contact-cards">
      <a className="contact-card" href={`${ISSUES_URL}/new/choose`} target="_blank" rel="noopener">
        <Icon name="bug" size={20} />
        <div>
          <strong>Report a bug or request a feature</strong>
          <span>GitHub issue tracker</span>
        </div>
        <Icon name="external" size={15} />
      </a>
      <a className="contact-card" href={`mailto:${CONTACT_EMAIL}`}>
        <Icon name="mail" size={20} />
        <div>
          <strong>Everything else</strong>
          <span>{CONTACT_EMAIL}</span>
        </div>
        <Icon name="external" size={15} />
      </a>
    </div>
  );
}

const FORMATS: [string, string, string, string][] = [
  ['.curvs', 'Yes', 'Yes', 'Native. Lossless, with embedded images.'],
  ['SVG / SVGZ', 'Yes', 'Yes', 'Paths, shapes, groups, gradients, text, clip paths.'],
  ['PDF', 'Yes', 'Yes', 'Vector pages; one artboard per page.'],
  [
    'AI',
    'PDF-compatible files',
    'PDF-based',
    'Illustrator opens it. Illustrator-only editing data is not included.',
  ],
  ['EPS', 'Later', 'Yes', 'PostScript level 3.'],
  ['DXF', 'Yes', 'Yes', 'For CAD, laser and vinyl cutters.'],
  ['EMF', 'Later', 'Yes', 'For Microsoft Office.'],
  ['PNG / JPG / WebP', 'As images', 'Yes', 'Exports at 1×, 2×, 3× or a custom size.'],
  ['CDR', 'Later', 'No', 'No public writer exists. Use PDF or SVG.'],
];

export function HelpPage() {
  const sections: { icon: IconName; title: string; body: ReactNode }[] = [
    {
      icon: 'zap',
      title: 'Getting started',
      body: (
        <ul>
          <li>Pick a size on the start screen, or drop a file anywhere to open it.</li>
          <li>
            Draw with the tools on the left. The bar under the menus shows options and modifier keys for the
            active tool.
          </li>
          <li>
            Press <span className="kbd">{formatShortcut('Mod+K')}</span> to search every tool, command, layer
            and color.
          </li>
          <li>
            <span className="kbd">Esc</span> finishes what the tool is doing. Press it again to return to the
            Move tool.
          </li>
          <li>
            Save with <span className="kbd">{formatShortcut('Mod+S')}</span>. Work is also autosaved to this
            device every 30 seconds.
          </li>
        </ul>
      ),
    },
    {
      icon: 'command',
      title: 'Numbers',
      body: (
        <ul>
          <li>Fields accept math: 120/3, +12, *2, 50%, 10mm, 2in.</li>
          <li>Click or hold the arrows beside a field to step it. Hold ⇧ for big steps, ⌥ for fine steps.</li>
          <li>Fields with a fixed range, like opacity, have a dropdown of presets.</li>
          <li>↑ and ↓ in a field step the value.</li>
        </ul>
      ),
    },
    {
      icon: 'boolean',
      title: 'Combining shapes',
      body: (
        <ul>
          <li>
            Union, Subtract, Intersect and Exclude stay live: edit the parts any time, then Expand when you
            want a plain path.
          </li>
          <li>Divide splits overlaps into separate pieces.</li>
          <li>
            The Shape builder (⇧M) merges regions you drag across, even between groups. ⌥-drag erases regions;
            ⌥-drag along the line between two regions removes just that line.
          </li>
          <li>
            The Shapes tool (*) draws 28 editable shapes. Click it again to pick one; edit its settings in the
            inspector.
          </li>
        </ul>
      ),
    },
    {
      icon: 'wand',
      title: 'Image Trace',
      body: (
        <ul>
          <li>Select a placed image and choose Trace image in the inspector or the Object menu.</li>
          <li>Start from a preset, then tune colors, smoothness and corners while the preview updates.</li>
          <li>
            On-device AI can cut out the subject or upscale small images first. The models download once and
            run on your computer.
          </li>
        </ul>
      ),
    },
    {
      icon: 'palette',
      title: 'Colors and styles',
      body: (
        <ul>
          <li>Each object has an appearance stack: any number of fills, strokes and effects.</li>
          <li>Global colors in Assets update every object that uses them.</li>
          <li>
            Choose RGB or CMYK under Document. Print sizes start in CMYK: colors keep exact ink values and
            PDF, AI and EPS export CMYK.
          </li>
          <li>Strokes support inside/outside alignment, dashes, arrowheads and width profiles.</li>
        </ul>
      ),
    },
    {
      icon: 'pin',
      title: 'Tablets and pens',
      body: (
        <ul>
          <li>One finger or a pen uses the current tool. Two fingers pan; pinch to zoom.</li>
          <li>Double-tap where you would double-click.</li>
          <li>
            The touch keys at the bottom left stand in for ⇧, ⌥ and ⌘: tap one to keep it on, tap again to
            release it. Done works like Esc.
          </li>
        </ul>
      ),
    },
    {
      icon: 'shield',
      title: 'Your files',
      body: (
        <ul>
          <li>Files open and save locally. Nothing is uploaded.</li>
          <li>In Chrome and Edge, Save writes straight back to the file. Other browsers download a copy.</li>
          <li>Autosaved copies with full undo history are under Files on this device.</li>
        </ul>
      ),
    },
  ];
  return (
    <PageShell title="Help">
      <p className="page-lede">
        Curvesmith is a vector editor that runs in your browser. Here is the short version of everything.
      </p>
      <div className="help-grid">
        {sections.map((s) => (
          <section key={s.title} className="help-card">
            <h2>
              <Icon name={s.icon} size={18} /> {s.title}
            </h2>
            {s.body}
          </section>
        ))}
      </div>
      <h2 className="page-h2">Tools</h2>
      <div className="tool-table">
        {TOOLS.map((t) => (
          <div key={t.id} className="tool-row">
            <span className="tool-ic">
              <Icon name={`tool-${t.id}`} size={20} />
            </span>
            <strong>{t.label}</strong>
            <span className="kbd">{t.shortcut}</span>
            <span className="muted">
              {t.hint ?? 'Edit nodes and handles · Convert, Break, Join, Add node, Simplify in the bar above'}
            </span>
          </div>
        ))}
      </div>
      <div className="row" style={{ margin: '12px 0 0', gap: 8 }}>
        <button className="btn" onClick={() => openDialog('shortcuts')}>
          <Icon name="keyboard" /> All keyboard shortcuts
        </button>
        <button className="btn" onClick={() => openDialog('tour')}>
          <Icon name="tour" /> Take the tour
        </button>
      </div>
      <h2 className="page-h2">File formats</h2>
      <table className="fmt-table">
        <thead>
          <tr>
            <th>Format</th>
            <th>Open</th>
            <th>Export</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {FORMATS.map((f) => (
            <tr key={f[0]}>
              <td className="mono">{f[0]}</td>
              <td>{f[1]}</td>
              <td>{f[2]}</td>
              <td className="muted">{f[3]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        Whenever a file opens with changes (a substituted font, a dropped filter), an import report lists
        them.
      </p>
      <h2 className="page-h2">Get in touch</h2>
      <Contact />
    </PageShell>
  );
}

export function AboutPage() {
  return (
    <PageShell title="About">
      <p className="page-lede">
        <strong>Shape every curve.</strong> Curvesmith is a professional vector editor that opens in a browser
        tab. No install, no account, and your files stay on your machine.
      </p>
      <div className="about-grid">
        <section className="help-card">
          <h2>
            <Icon name="shield" size={18} /> Private by design
          </h2>
          <p>
            Documents are processed in your browser and saved to your disk or this browser’s storage. The
            curvesmith.app site counts visits with Google Analytics; your drawings are never part of that.
          </p>
        </section>
        <section className="help-card">
          <h2>
            <GitHubMark size={18} /> Open source
          </h2>
          <p>
            MIT licensed and developed in the open on{' '}
            <a href={REPO_URL} target="_blank" rel="noopener">
              GitHub
            </a>
            . Contributions and ideas are welcome.
          </p>
        </section>
        <section className="help-card">
          <h2>
            <Icon name="layers" size={18} /> Built with
          </h2>
          <p>
            React, Zustand and Immer · Skia PathOps for booleans · pdf-lib and opentype.js · fflate · Radix UI
            and cmdk · ONNX Runtime Web with U²-Netp (Apache-2.0) and Real-ESRGAN (BSD-3-Clause) for on-device
            AI. Bricolage Grotesque, Geist and Geist Mono under the SIL Open Font License; document fonts from
            Google Fonts.
          </p>
        </section>
      </div>
      <p className="muted mono" style={{ fontSize: 12 }}>
        Version {typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'}
      </p>
      <h2 className="page-h2">Get in touch</h2>
      <Contact />
    </PageShell>
  );
}

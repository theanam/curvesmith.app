import * as D from '@radix-ui/react-dialog';
import { useEffect, useState, type ReactNode } from 'react';
import { lsSet } from '../../state/storage';
import { formatShortcut } from '../../state/commands';
import { Icon, Mark } from '../icons';
import { ShapeGlyph } from '../shapes/ShapePicker';
import './tour.css';

export const TOUR_KEY = 'curvesmith.tour';
export const markTourSeen = () => lsSet(TOUR_KEY, 'seen-v1');

type Slide = { kicker: string; title: string; points: ReactNode[]; visual: ReactNode };

const shot = (name: string, alt: string) => (
  <img className="tour-shot" src={`/tour/${name}.png`} alt={alt} loading="eager" />
);
const K = ({ k }: { k: string }) => <span className="kbd">{k.includes('+') ? formatShortcut(k) : k}</span>;

/* ---- Animated illustrations (pure SVG + CSS, respect reduced motion) ---- */

function PenArt() {
  return (
    <svg viewBox="0 0 480 280" className="tour-art" aria-hidden>
      <rect width="480" height="280" rx="14" className="art-bg" />
      <path className="draw" d="M60 200 C 120 60, 210 60, 250 150 S 380 250, 420 90" />
      <g className="handles">
        <line x1="250" y1="150" x2="210" y2="60" />
        <line x1="250" y1="150" x2="290" y2="240" />
        <circle cx="210" cy="60" r="5" />
        <circle cx="290" cy="240" r="5" />
      </g>
      <rect x="55" y="195" width="10" height="10" className="anchor" />
      <rect x="244" y="144" width="12" height="12" className="anchor sel" />
      <rect x="415" y="85" width="10" height="10" className="anchor" />
      <g className="hud" transform="translate(268 160)">
        <rect width="150" height="40" rx="7" />
        <text x="10" y="17">
          X 250.0 Y 150.0
        </text>
        <text x="10" y="32" className="acc">
          Handle 98.5 pt · 66.0°
        </text>
      </g>
    </svg>
  );
}

function BooleanArt() {
  return (
    <svg viewBox="0 0 480 280" className="tour-art" aria-hidden>
      <rect width="480" height="280" rx="14" className="art-bg" />
      <g className="bool">
        <circle cx="190" cy="140" r="78" className="a" />
        <circle cx="290" cy="140" r="78" className="b" />
      </g>
      <g className="ops">
        {['Union', 'Subtract', 'Intersect', 'Divide'].map((l, i) => (
          <g key={l} transform={`translate(${42 + i * 102} 236)`}>
            <rect width="92" height="26" rx="6" className={i === 0 ? 'on' : ''} />
            <text x="46" y="17">
              {l}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function AppearanceArt() {
  return (
    <svg viewBox="0 0 480 280" className="tour-art" aria-hidden>
      <rect width="480" height="280" rx="14" className="art-bg" />
      <defs>
        <linearGradient id="tg" x1="0" x2="1">
          <stop offset="0" stopColor="#F0843A" />
          <stop offset="1" stopColor="#E5484D" />
        </linearGradient>
        <filter id="ts" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#1A1820" floodOpacity="0.3" />
        </filter>
      </defs>
      <rect x="60" y="60" width="150" height="150" rx="34" fill="url(#tg)" filter="url(#ts)" />
      <rect
        x="60"
        y="60"
        width="150"
        height="150"
        rx="34"
        fill="none"
        stroke="#1A1820"
        strokeWidth="6"
        strokeDasharray="14 10"
        className="dash"
      />
      <path d="M260 200 C 300 60, 360 60, 420 120" fill="none" stroke="#2B5F6B" strokeWidth="2" />
      <path
        className="profile"
        d="M260 200 C 300 60, 360 60, 420 120"
        fill="none"
        stroke="#2B5F6B"
        strokeLinecap="round"
        strokeWidth="18"
      />
      <path d="M420 120 l-20 -18 l4 18 l-4 18z" fill="#2B5F6B" transform="rotate(30 420 120)" />
    </svg>
  );
}

function ShapesArt() {
  const kinds = [
    'triangle',
    'doubleStar',
    'cog',
    'heart',
    'calloutEllipse',
    'donut',
    'crescent',
    'arrow',
    'cloud',
    'flower',
    'shield',
    'spiral',
  ] as const;
  return (
    <div className="shapes-art" aria-hidden>
      {kinds.map((k, i) => (
        <span key={k} className="shape-tile" style={{ animationDelay: `${i * 0.07}s` }}>
          <ShapeGlyph kind={k} size={40} />
        </span>
      ))}
    </div>
  );
}

/** Pixels on the left become clean curves on the right. */
function TraceArt() {
  const leaf = (x: number, y: number) =>
    Math.hypot(x - 63, y - 140) < 100 && Math.hypot(x - 187, y - 140) < 100;
  const sun = (x: number, y: number) => Math.hypot(x - 165, y - 88) < 30;
  const cells: { x: number; y: number; c: string }[] = [];
  for (let y = 48; y < 232; y += 8)
    for (let x = 30; x < 230; x += 8) {
      const c = leaf(x + 4, y + 4) ? '#16c75b' : sun(x + 4, y + 4) ? '#f5b62b' : null;
      if (c) cells.push({ x, y, c });
    }
  const lens = 'M125 61.5A100 100 0 0 1 125 218.5A100 100 0 0 1 125 61.5z';
  return (
    <svg viewBox="0 0 480 280" className="tour-art trace-art" aria-hidden>
      <rect width="480" height="280" rx="14" className="art-bg" />
      {cells.map((p) => (
        <rect
          key={`${p.x},${p.y}`}
          x={p.x}
          y={p.y}
          width="8"
          height="8"
          fill={p.c}
          className="px"
          style={{ animationDelay: `${(p.x - 30) * 0.004}s` }}
        />
      ))}
      <path d="M232 140h18m-6-6l6 6-6 6" className="arrow" />
      <g transform="translate(230 0)">
        <circle cx="165" cy="88" r="30" fill="#f5b62b" className="vec-fill" />
        <path d={lens} fill="#16c75b" className="vec-fill" />
        <circle cx="165" cy="88" r="30" className="draw" style={{ strokeWidth: 2 }} />
        <path d={lens} className="draw" style={{ strokeWidth: 2 }} />
        <g className="handles">
          {[
            [125, 61.5],
            [125, 218.5],
            [195, 88],
            [165, 58],
          ].map(([x, y]) => (
            <circle key={`${x},${y}`} cx={x} cy={y} r="4" />
          ))}
        </g>
      </g>
    </svg>
  );
}

function NumbersArt() {
  return (
    <svg viewBox="0 0 480 280" className="tour-art" aria-hidden>
      <rect width="480" height="280" rx="14" className="art-bg" />
      {[
        ['W', '120/3', '40 mm'],
        ['H', '+12', '62 mm'],
        ['X', '50%', '105 mm'],
        ['∠', '15°', '15°'],
      ].map(([l, typed, res], i) => (
        <g
          key={l}
          transform={`translate(${70} ${50 + i * 50})`}
          className="num-row"
          style={{ animationDelay: `${i * 0.6}s` }}
        >
          <rect width="340" height="36" rx="7" className="field" />
          <text x="14" y="23" className="lbl">
            {l}
          </text>
          <text x="44" y="23" className="typed">
            {typed}
          </text>
          <text x="326" y="23" className="res" textAnchor="end">
            {res}
          </text>
        </g>
      ))}
    </svg>
  );
}

function PrivacyArt() {
  return (
    <svg viewBox="0 0 480 280" className="tour-art" aria-hidden>
      <rect width="480" height="280" rx="14" className="art-bg" />
      <rect x="120" y="50" width="240" height="160" rx="12" className="laptop" />
      <rect x="90" y="210" width="300" height="14" rx="7" className="laptop" />
      <path d="M240 86 l44 16 v30 c0 26 -20 42 -44 50 c-24 -8 -44 -24 -44 -50 v-30z" className="shield" />
      <path d="M222 132 l12 12 l24 -26" className="tick" />
      <text x="240" y="258" textAnchor="middle" className="cap">
        Files open and save on this device
      </text>
    </svg>
  );
}

function KeysArt() {
  const keys = [formatShortcut('Mod+K'), 'V', 'A', 'P', 'M', 'L', 'T', 'Space'];
  return (
    <div className="keys-art" aria-hidden>
      <Mark size={64} />
      <div className="keycaps">
        {keys.map((k, i) => (
          <span key={k} className="keycap" style={{ animationDelay: `${i * 0.12}s` }}>
            {k}
          </span>
        ))}
      </div>
    </div>
  );
}

const SLIDES: Slide[] = [
  {
    kicker: 'Welcome',
    title: 'Shape every curve.',
    points: [
      <>A professional vector editor that opens in a browser tab.</>,
      <>No install, no account. Your files stay on your device.</>,
      <>This quick tour shows the highlights. Skip it any time.</>,
    ],
    visual: shot('editor', 'The Curvesmith editor with a poster open'),
  },
  {
    kicker: 'Pen and Node tools',
    title: 'Draw Béziers with confidence',
    points: [
      <>
        <K k="P" /> Click for corners, drag for curves, ⌥ breaks a handle, Space moves the anchor.
      </>,
      <>
        <K k="A" /> Convert nodes to Sharp, Smooth, Symmetric or Auto. Bend a segment by dragging it.
      </>,
      <>The HUD shows coordinates, handle length and angle while you work.</>,
    ],
    visual: <PenArt />,
  },
  {
    kicker: 'Live booleans',
    title: 'Combine shapes and keep editing',
    points: [
      <>Union, Subtract, Intersect and Exclude stay live. Expand only when you want to.</>,
      <>
        <K k="⇧M" /> Shape builder: drag across regions to merge them, ⌥-drag to erase.
      </>,
      <>Scissors cuts paths; drag a line to slice through everything.</>,
    ],
    visual: <BooleanArt />,
  },
  {
    kicker: 'Smart guides',
    title: 'The canvas tells you what is happening',
    points: [
      <>Snap to edges, centers, nodes, guides and the pixel grid. Guides say what they snapped to.</>,
      <>Drag out of a ruler to add a guide.</>,
      <>Double-click a group to edit inside it.</>,
    ],
    visual: shot('node-tool', 'Editing a wave with the Node tool, showing handles and a smart guide'),
  },
  {
    kicker: 'Shapes',
    title: 'Twenty-eight editable shapes',
    points: [
      <>
        <K k="*" /> Click the Shapes tool again for hearts, cogs, callouts, clouds, arrows, spirals and more.
      </>,
      <>Every shape keeps its own settings: teeth, petals, tail position, hole size, sweep.</>,
      <>Change a shape into another one any time without losing its size or style.</>,
    ],
    visual: <ShapesArt />,
  },
  {
    kicker: 'Image Trace',
    title: 'Turn pictures into vectors',
    points: [
      <>
        Select a placed image and choose Trace image. Presets for logos, illustrations, photos and line art.
      </>,
      <>Tune colors, smoothness and corners with a live preview. Corners stay crisp, curves stay smooth.</>,
      <>On-device AI cuts out the subject or upscales small images first. Nothing leaves your computer.</>,
    ],
    visual: <TraceArt />,
  },
  {
    kicker: 'Appearance',
    title: 'Stack fills, strokes and effects',
    points: [
      <>Any number of fills and strokes per object, with gradients and blend modes.</>,
      <>Strokes: inside or outside alignment, dashes, arrowheads and width profiles.</>,
      <>Drop shadows, inner shadows and blur. Rectangles keep live corner radii.</>,
      <>
        <K k="I" /> The Eyedropper’s magnifier picks exact colors, even from photos.
      </>,
    ],
    visual: <AppearanceArt />,
  },
  {
    kicker: 'Assets',
    title: 'Global colors, symbols and styles',
    points: [
      <>Edit a global color once and every object using it updates.</>,
      <>Symbols: place instances that follow the master.</>,
      <>Save an appearance as a style and reuse it.</>,
    ],
    visual: shot('assets', 'The Assets tab with document colors and symbols'),
  },
  {
    kicker: 'Typography',
    title: 'Every Google Font, with previews',
    points: [
      <>Search nearly 2,000 families by name or category.</>,
      <>OpenType features, tracking and leading. Point text or area text.</>,
      <>Create outlines whenever you need paths.</>,
    ],
    visual: shot('fonts', 'The font picker showing font previews by category'),
  },
  {
    kicker: 'Command palette',
    title: `Press ${formatShortcut('Mod+K')} for anything`,
    points: [
      <>Tools, commands, layers by name, colors and recent files in one search.</>,
      <>Every entry shows its shortcut, so the palette teaches you as you go.</>,
    ],
    visual: shot('palette', 'The command palette searching for union'),
  },
  {
    kicker: 'Numbers',
    title: 'Fields that do math',
    points: [
      <>Type 120/3, +12, 50% or 10mm in any field.</>,
      <>Step with the arrows beside a field, or pick a preset. ⇧ for coarse steps, ⌥ for fine.</>,
    ],
    visual: <NumbersArt />,
  },
  {
    kicker: 'Export',
    title: 'SVG, PDF, AI, EPS, DXF, EMF, PNG, JPG, WebP',
    points: [
      <>Live preview, presets per format, and Export again in one keystroke.</>,
      <>Print sends true vector pages to the printer.</>,
      <>Opens SVG, PDF, AI, DXF and images too, with an honest import report.</>,
    ],
    visual: shot('export', 'The export dialog with SVG options'),
  },
  {
    kicker: 'Local-first',
    title: 'Private, and it works offline',
    points: [
      <>Saves straight to your files where the browser allows; downloads elsewhere.</>,
      <>Autosave keeps a copy with full undo history under Files on this device.</>,
      <>Install it as an app and open .curvs and .svg files from your desktop.</>,
    ],
    visual: <PrivacyArt />,
  },
  {
    kicker: 'Ready',
    title: 'You are all set',
    points: [
      <>
        Press <K k="Mod+K" /> whenever you look for something, or open Help from the menu.
      </>,
      <>Start from a preset, or drop any vector file on the window.</>,
    ],
    visual: <KeysArt />,
  },
];

export function Tour({ onClose }: { onClose(): void }) {
  const [i, setI] = useState(0);
  const last = i === SLIDES.length - 1;
  const close = () => {
    markTourSeen();
    onClose();
  };
  useEffect(() => {
    // Preload the next screenshot.
    const next = SLIDES[i + 1]?.visual as { props?: { src?: string } } | undefined;
    if (next?.props?.src) new Image().src = next.props.src;
  }, [i]);
  const s = SLIDES[i];
  return (
    <D.Root open onOpenChange={(o) => !o && close()}>
      <D.Portal>
        <D.Overlay className="dialog-overlay tour-overlay" />
        <D.Content
          className="tour"
          aria-describedby="tour-points"
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' && !last) setI(i + 1);
            if (e.key === 'ArrowLeft' && i > 0) setI(i - 1);
          }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (document.querySelector('.tour .btn-primary') as HTMLElement | null)?.focus();
          }}
        >
          <div className="tour-visual" key={i}>
            {s.visual}
          </div>
          <div className="tour-text">
            <div className="tour-kicker">
              {s.kicker} <span className="mono">{`${i + 1} / ${SLIDES.length}`}</span>
            </div>
            <D.Title className="tour-title">{s.title}</D.Title>
            <ul id="tour-points" className="tour-points">
              {s.points.map((p, k) => (
                <li key={k}>{p}</li>
              ))}
            </ul>
            <div className="tour-dots" role="tablist" aria-label="Tour steps">
              {SLIDES.map((sl, k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={k === i}
                  aria-label={`${k + 1}: ${sl.kicker}`}
                  onClick={() => setI(k)}
                />
              ))}
            </div>
            <div className="tour-foot">
              {!last && (
                <button className="btn btn-ghost" onClick={close}>
                  Skip
                </button>
              )}
              {i > 0 && (
                <button className="btn" onClick={() => setI(i - 1)} aria-label="Previous">
                  <Icon name="arrowLeft" />
                </button>
              )}
              <button className="btn btn-primary" onClick={() => (last ? close() : setI(i + 1))}>
                {last ? 'Get started' : 'Next'}
                {!last && <Icon name="arrowRight" />}
              </button>
            </div>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

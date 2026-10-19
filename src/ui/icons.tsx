import type { CSSProperties } from 'react';
import { TOOLS } from '../tools/ids';

/* 24px viewBox, 1.6 stroke, currentColor, round caps and joins (the tools.json style). */
export const ICONS = {
  undo: 'M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2',
  redo: 'M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h2',
  history: 'M12 3a9 9 0 1 0 9 9M12 7v5l3 2M21 3v5h-5',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  system: 'M3 5h18v11H3zM8 20h8M12 16v4',
  export: 'M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  download: 'M12 3v12M7 10l5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M20 20l-4.8-4.8',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  eyeOff:
    'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.9 3.8M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-2',
  alignLeft: 'M4 3v18M8 7h12v4H8zM8 14h7v4H8z',
  alignHCenter: 'M12 3v18M5 7h14v4H5zM8 14h8v4H8z',
  alignRight: 'M20 3v18M4 7h12v4H4zM9 14h7v4H9z',
  alignTop: 'M3 4h18M7 8h4v12H7zM14 8h4v7h-4z',
  alignVCenter: 'M3 12h18M7 5h4v14H7zM14 8h4v8h-4z',
  alignBottom: 'M3 20h18M7 4h4v12H7zM14 9h4v7h-4z',
  distributeH: 'M4 3v18M20 3v18M10 7h4v10h-4z',
  distributeV: 'M3 4h18M3 20h18M7 10h10v4H7z',
  flipH: 'M12 3v18M9 6L3 18h6zM15 6l6 12h-6z',
  flipV: 'M3 12h18M6 9L18 3v6zM6 15l12 6v-6z',
  artboard: 'M4 4h16v16H4zM4 8h16',
  text: 'M5 7V4h14v3M12 4v16M9 20h6',
  group: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  path: 'M3 17c3-8 6 4 9-4s6 0 9-6',
  ellipse: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16',
  rect: 'M4 6h16v12H4z',
  shapes:
    'M7 3l4.5 7.5h-9zM17 3a3.75 3.75 0 1 0 0 7.5a3.75 3.75 0 1 0 0-7.5M3 14h7.5v7H3zM17 13.5l4 3.75-4 3.75-4-3.75z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9a1 1 0 1 0 0.01 0',
  boolean: 'M9 4a5 5 0 1 0 0 10a5 5 0 1 0 0-10M15 10a5 5 0 1 0 0 10a5 5 0 1 0 0-10',
  symbol: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  clip: 'M4 4h10v10H4zM10 10h10v10H10z',
  home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  libraries: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  settings:
    'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  help: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 11v6M12 7.5h.01',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  check: 'M5 12l5 5L20 7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  bug: 'M9 7a3 3 0 0 1 6 0M8 9h8v6a4 4 0 0 1-8 0zM4 13h4M16 13h4M5 8l3 2M19 8l-3 2M5 19l3-2M19 19l-3-2',
  tour: 'M4 5h16v11H4zM9 20h6M12 16v4M10 8.5v4l3.5-2z',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  eyedropper:
    'M2 22l1-1h3l9-9M3 21v-3l9-9M15 6l3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4z',
  swap: 'M7 4v12M3 12l4 4 4-4M17 20V8M13 12l4-4 4 4',
  reset: 'M4 4h7v7H4zM13 13h7v7h-7z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  unlink:
    'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7M4 4l16 16',
  fillIcon: 'M5 5h14v14H5z',
  strokeIcon: 'M5 5h14v14H5zM9 9h6v6H9z',
  effect:
    'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8',
  union: 'M9 4a5 5 0 0 0-1 9.9V15a5 5 0 1 0 9.9-1H20a5 5 0 1 0-9.9-1H9z',
  play: 'M8 5l11 7-11 7z',
  gradient: 'M4 4h16v16H4zM4 20L20 4',
  pin: 'M12 17v4M8 4h8l-1 6 3 3H6l3-3z',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  zap: 'M13 3L5 13h6l-1 8 8-10h-6z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  palette:
    'M12 3a9 9 0 0 0 0 18c1 0 1.5-.7 1.5-1.5 0-.9-.7-1.2-.7-2 0-.9.7-1.5 1.7-1.5H17a4 4 0 0 0 4-4c0-5-4-9-9-9zM7.5 11h.01M10 7.5h.01M15 7.5h.01',
  command: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z',
  ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  wand: 'M4 20L16 8M14 4v2M20 10h-2M18 4l-1.5 1.5M19 15l-1-1M9 5l1 1',
} as const;

export type IconName = keyof typeof ICONS | `tool-${string}`;

export function iconPath(name: IconName): string {
  if (name.startsWith('tool-')) return TOOLS.find((t) => t.id === name.slice(5))?.icon.d ?? '';
  return ICONS[name as keyof typeof ICONS];
}

export function Icon({
  name,
  size = 16,
  stroke = 1.6,
  style,
  className,
  title,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
  style?: CSSProperties;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      style={style}
    >
      {title && <title>{title}</title>}
      <path d={iconPath(name)} />
    </svg>
  );
}

/** GitHub mark (brand glyph; filled, from GitHub's logo guidelines). */
export function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** The Curvesmith mark (from brand/svg/mark-primary.svg). */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="15" fill="#1A1820" />
      <path
        d="M45 21C39 13.5 22 13 17.5 27C13 41 26 53 41 47"
        stroke="#16C75B"
        strokeWidth="7.5"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M37 11L53 31" stroke="#F6F4EF" strokeWidth="2" />
      <circle cx="37" cy="11" r="3" fill="#F6F4EF" />
      <circle cx="53" cy="31" r="3" fill="#F6F4EF" />
      <rect x="41" y="17" width="8" height="8" fill="#1A1820" stroke="#F6F4EF" strokeWidth="2" />
    </svg>
  );
}

export function Wordmark({ height = 22 }: { height?: number }) {
  return <img src="/brand/wordmark-ink.svg" alt="curvesmith" height={height} className="wordmark" />;
}

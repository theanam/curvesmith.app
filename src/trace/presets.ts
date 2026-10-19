import type { TraceOptions } from './types';

export type TracePresetId = 'logo' | 'illustration' | 'photo' | 'gray' | 'lineart' | 'silhouette';

export type TracePreset = { id: TracePresetId; label: string; options: TraceOptions };

const base: TraceOptions = {
  mode: 'color',
  colors: 8,
  threshold: -1,
  speckle: 12,
  smoothness: 40,
  corners: 55,
  stacked: true,
  ignoreBackground: false,
  denoise: 0,
};

export const TRACE_PRESETS: TracePreset[] = [
  { id: 'logo', label: 'Logo', options: { ...base, colors: 6, speckle: 10, smoothness: 30, corners: 70 } },
  {
    id: 'illustration',
    label: 'Illustration',
    options: { ...base, colors: 16, speckle: 16, smoothness: 45, corners: 50 },
  },
  {
    id: 'photo',
    label: 'Photo',
    options: { ...base, colors: 24, speckle: 30, smoothness: 55, corners: 30, denoise: 1 },
  },
  {
    id: 'gray',
    label: 'Grayscale',
    options: { ...base, mode: 'gray', colors: 6, speckle: 20, smoothness: 50, corners: 40, denoise: 1 },
  },
  {
    id: 'lineart',
    label: 'Line art',
    options: { ...base, mode: 'bw', speckle: 8, smoothness: 35, corners: 55 },
  },
  {
    id: 'silhouette',
    label: 'Silhouette',
    options: { ...base, mode: 'bw', threshold: 256, speckle: 40, smoothness: 60, corners: 40 },
  },
];

export const tracePreset = (id: TracePresetId) => TRACE_PRESETS.find((p) => p.id === id)!;

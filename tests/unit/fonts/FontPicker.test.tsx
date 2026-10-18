import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FontRef } from '../../../src/core/types';
import { CATALOG_ROWS } from './helpers';

const ensureFont = vi.fn(async () => undefined);
vi.mock('../../../src/fonts/loader', () => ({
  ensureFont,
  getFontBytes: async () => null,
  onFontLoaded: () => () => undefined,
}));

const { FontPicker, styleOptions, ROW_HEIGHT } = await import('../../../src/ui/fonts/FontPicker');

// Many rows so virtualisation matters.
const MANY = Array.from({ length: 300 }, (_, i) => [
  `zz-font-${i}`,
  `Zz Font ${String(i).padStart(3, '0')}`,
  'sans',
  [400],
  0,
]);
const ROWS = [...CATALOG_ROWS, ...MANY];

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(ROWS)));
});

beforeEach(() => {
  ensureFont.mockClear();
  localStorage.clear();
});
afterEach(cleanup);

const geist: FontRef = { family: 'Geist', weight: 500, style: 'normal' };

async function openPicker(value: FontRef = geist, extra: { documentFonts?: string[] } = {}) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<FontPicker value={value} onChange={onChange} {...extra} />);
  await user.click(screen.getByRole('button', { name: `Font family, ${value.family}` }));
  const input = await screen.findByRole('combobox', { name: 'Search fonts' });
  await waitFor(() =>
    expect(input).toHaveAttribute('placeholder', `Search ${(ROWS.length + 2).toLocaleString('en-US')} fonts`),
  );
  return { user, onChange, input };
}

const optionNames = () =>
  screen.getAllByRole('option').map((o) => o.querySelector('.cs-fp-name')!.textContent);

describe('FontPicker', () => {
  it('renders the trigger in the current face', () => {
    render(<FontPicker value={geist} onChange={() => undefined} />);
    const btn = screen.getByRole('button', { name: 'Font family, Geist' });
    expect(btn.querySelector('.cs-fp-value')).toHaveStyle({ fontFamily: '"Geist", var(--font-ui)' });
    expect(screen.getByRole('combobox', { name: 'Font style' })).toHaveTextContent('Medium');
  });

  it('opens with the search focused and renders only visible rows', async () => {
    const { input } = await openPicker();
    expect(input).toHaveFocus();
    const options = screen.getAllByRole('option');
    expect(options.length).toBeLessThan(30);
    expect(screen.getByRole('listbox').querySelector('.cs-fp-sizer')).toHaveStyle({
      height: `${(ROWS.length + 2) * ROW_HEIGHT}px`,
    });
    // Previews load for visible catalogue rows only, once each.
    const links = [...document.head.querySelectorAll('link[rel=stylesheet]')].map((l) =>
      l.getAttribute('href')!,
    );
    expect(links.some((h) => h.includes('family=Abel') && h.includes('&text=Abel'))).toBe(true);
    expect(links.some((h) => h.includes('Zz+Font+299'))).toBe(false);
    expect(new Set(links).size).toBe(links.length);
  });

  it('search ranks prefix matches first and Enter picks the first', async () => {
    const { user, input, onChange } = await openPicker();
    await user.type(input, 'ro');
    expect(optionNames().slice(0, 2)).toEqual(['Roboto', 'Roboto Mono']);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith({ family: 'Roboto', weight: 500, style: 'normal' });
    expect(ensureFont).toHaveBeenCalledWith({ family: 'Roboto', weight: 500, style: 'normal' });
    expect(screen.queryByRole('combobox', { name: 'Search fonts' })).toBeNull();
  });

  it('arrow keys move the highlight', async () => {
    const { user, input, onChange } = await openPicker();
    await user.type(input, 'ro');
    await user.keyboard('{ArrowDown}');
    const active = input.getAttribute('aria-activedescendant')!;
    expect(document.getElementById(active)).toHaveTextContent('Roboto Mono');
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');
    expect(onChange).toHaveBeenCalledWith({ family: 'Roboto Mono', weight: 500, style: 'normal' });
  });

  it('category chips filter the list', async () => {
    const { user } = await openPicker();
    const chips = screen.getByRole('group', { name: 'Font category' });
    expect(within(chips).queryByRole('button', { name: 'In this document' })).toBeNull();
    await user.click(within(chips).getByRole('button', { name: 'Serif' }));
    expect(within(chips).getByRole('button', { name: 'Serif' })).toHaveAttribute('aria-pressed', 'true');
    expect(optionNames()).toEqual(['Playfair Display', 'Noto Serif']);
    await user.click(within(chips).getByRole('button', { name: 'Handwriting' }));
    expect(optionNames()).toEqual(['Caveat']);
  });

  it('offers document fonts, including ones outside the catalogue', async () => {
    const { user } = await openPicker(geist, { documentFonts: ['Lobster', 'My Upload'] });
    await user.click(screen.getByRole('button', { name: 'In this document' }));
    expect(optionNames()).toEqual(['Lobster', 'My Upload']);
  });

  it('Escape closes the list', async () => {
    const { user } = await openPicker();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('combobox', { name: 'Search fonts' })).toBeNull();
  });

  it('clicking a row picks it, keeps italic where available, and remembers it as recent', async () => {
    const { user, input, onChange } = await openPicker({ family: 'Geist', weight: 700, style: 'italic' });
    await user.type(input, 'lob');
    await user.click(screen.getByRole('option', { name: /Lobster/ }));
    expect(onChange).toHaveBeenCalledWith({ family: 'Lobster', weight: 400, style: 'normal' });
    cleanup();
    const second = await openPicker();
    expect(optionNames()[0]).toBe('Lobster');
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Recent');
    await second.user.type(second.input, 'playfair');
    await second.user.keyboard('{Enter}');
    expect(second.onChange).toHaveBeenCalledWith({
      family: 'Playfair Display',
      weight: 500,
      style: 'normal',
    });
  });

  it('marks the current family as selected', async () => {
    await openPicker({ family: 'Inter', weight: 400, style: 'normal' });
    const selected = screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent('Inter');
  });
});

describe('styleOptions', () => {
  it('lists weights with italics where the family has them', () => {
    expect(
      styleOptions({ id: 'x', family: 'X', category: 'serif', weights: [400, 700], italic: true }).map(
        (o) => o.label,
      ),
    ).toEqual(['Regular', 'Italic', 'Bold', 'Bold Italic']);
    expect(
      styleOptions({ id: 'y', family: 'Y', category: 'sans', weights: [100, 900], italic: false }).map(
        (o) => o.label,
      ),
    ).toEqual(['Thin', 'Black']);
  });
});

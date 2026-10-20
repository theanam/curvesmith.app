import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FontRef } from '../../../src/core/types';
import { resetUserFontsForTests, userFaces } from '../../../src/fonts/user';
import { CATALOG_ROWS } from './helpers';

vi.mock('../../../src/fonts/loader', () => ({
  ensureFont: vi.fn(async () => undefined),
  getFontBytes: async () => null,
  onFontLoaded: () => () => undefined,
}));

const { FontPicker } = await import('../../../src/ui/fonts/FontPicker');
const GEIST = new Uint8Array(
  readFileSync(resolve(__dirname, '../../fixtures/fonts/geist-latin-400-normal.ttf')),
);

beforeAll(() => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(CATALOG_ROWS)));
});
afterEach(() => {
  cleanup();
  resetUserFontsForTests();
});

const value: FontRef = { family: 'Inter', weight: 400, style: 'normal' };

async function open() {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<FontPicker value={value} onChange={onChange} />);
  await user.click(screen.getByRole('button', { name: 'Font family, Inter' }));
  await screen.findByRole('combobox', { name: 'Search fonts' });
  return { user, onChange };
}

describe('Font picker: the user’s own fonts', () => {
  it('uploads a font, lists it under My fonts, and removes it', async () => {
    const { user, onChange } = await open();
    expect(screen.queryByRole('button', { name: 'My fonts' })).toBeNull();
    await user.upload(
      screen.getByLabelText('Font files'),
      new File([GEIST], 'Geist.ttf', { type: 'font/ttf' }),
    );
    await waitFor(() => expect(userFaces()).toHaveLength(1));
    await user.click(await screen.findByRole('button', { name: 'My fonts' }));
    const row = screen.getByRole('option', { name: /Geist/ });
    expect(row).toHaveTextContent('Uploaded');
    await user.click(row);
    expect(onChange).toHaveBeenCalledWith({ family: 'Geist', weight: 400, style: 'normal' });
  });

  it('removes an uploaded family from the list', async () => {
    const { user } = await open();
    await user.upload(screen.getByLabelText('Font files'), new File([GEIST], 'Geist.ttf'));
    await user.click(await screen.findByRole('button', { name: 'My fonts' }));
    await user.click(screen.getByRole('button', { name: 'Remove Geist from my fonts' }));
    await waitFor(() => expect(userFaces()).toHaveLength(0));
  });

  it('explains how to use installed fonts where the browser cannot list them', async () => {
    const { user, onChange } = await open();
    await user.click(screen.getByRole('button', { name: 'On this device' }));
    expect(screen.getByText(/keeps its font list private/)).toBeInTheDocument();
    await user.type(screen.getByRole('combobox', { name: 'Search fonts' }), 'Nopefont');
    await user.click(screen.getByRole('button', { name: 'Use “Nopefont” from this device' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

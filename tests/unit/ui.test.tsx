import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/ui/App';
import { ErrorBoundary } from '../../src/ui/ErrorBoundary';
import { Tour } from '../../src/ui/tour/Tour';
import { NumberField } from '../../src/ui/controls/NumberField';
import { getState, resetStore, select, mutate, setState } from '../../src/state/store';
import { lsGet } from '../../src/state/storage';
import { makeRect } from '../../src/core/document';
import { HelpPage, AboutPage } from '../../src/ui/pages/Pages';
import { freshDoc } from './helpers';

function Boom(): never {
  throw new Error('kaboom');
}

describe('UI', () => {
  beforeEach(() => resetStore());

  it('renders the start screen and creates a document from a preset', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Start something' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /A4/ }));
    expect(getState().route).toBe('editor');
    expect(screen.getByRole('toolbar', { name: 'Tool options' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move (V)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches tools with single-key shortcuts and opens the palette with Mod+K', async () => {
    freshDoc();
    render(<App />);
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP' });
    expect(getState().tool).toBe('pen');
    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(getState().dialog).toBe('palette');
  });

  it('shows the inspector for a selection and edits X with math', async () => {
    freshDoc();
    const r = makeRect(10, 10, 50, 50);
    mutate('Add', (d) => void d.artboards[0].children.push(r as never));
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    render(<App />);
    act(() => select([r.id]));
    const x = screen.getByRole('textbox', { name: 'X position' });
    await userEvent.click(x);
    await userEvent.clear(x);
    await userEvent.type(x, '100/4{Enter}');
    const n = getState().docs[0].doc.artboards[0].children[0];
    expect(n.transform[4]).toBe(25);
  });

  it('error boundary contains a crash to its region', () => {
    render(
      <div>
        <ErrorBoundary region="test panel">
          <Boom />
        </ErrorBoundary>
        <p>still here</p>
      </div>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('The test panel hit a problem.');
    expect(screen.getByText('still here')).toBeInTheDocument();
  });

  it('tour steps through slides and is remembered once closed', async () => {
    let closed = false;
    render(<Tour onClose={() => (closed = true)} />);
    expect(screen.getByText('Shape every curve.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('Draw Béziers with confidence')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(closed).toBe(true);
    expect(lsGet('curvesmith.tour', null)).toBe('seen-v1');
  });

  it('number field supports arrow stepping', async () => {
    let v = 10;
    render(<NumberField label="W" ariaLabel="Width" value={v} onChange={(n) => (v = n)} />);
    const input = screen.getByRole('textbox', { name: 'Width' });
    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true });
    expect(v).toBe(20);
  });

  it('help and about pages link to the issue tracker and email', () => {
    const { unmount } = render(<HelpPage />);
    expect(
      screen
        .getAllByRole('link')
        .some((a) => a.getAttribute('href')?.includes('github.com/theanam/curvesmith.app/issues')),
    ).toBe(true);
    expect(
      screen.getAllByRole('link').some((a) => a.getAttribute('href') === 'mailto:anam.ahmed.a@gmail.com'),
    ).toBe(true);
    unmount();
    render(<AboutPage />);
    expect(
      screen
        .getAllByRole('link')
        .some((a) => a.getAttribute('href') === 'https://github.com/theanam/curvesmith.app'),
    ).toBe(true);
  });

  it('export dialog lists formats in mockup order', async () => {
    freshDoc();
    render(<App />);
    act(() => setState({ dialog: 'export' }));
    const list = await screen.findByRole('navigation', { name: 'Formats' });
    const labels = [...list.querySelectorAll('.fmt-id')].map((n) => n.textContent);
    expect(labels).toEqual(['.curvs', 'SVG', 'PDF', 'AI', 'EPS', 'DXF', 'EMF', 'PNG', 'JPG', 'WebP']);
  });
});

describe('context bar', () => {
  it('text tool shows family, style, size and alignment inline', async () => {
    freshDoc();
    const { makeText } = await import('../../src/core/document');
    const t = makeText(10, 10, 'Hi');
    mutate('Add', (d) => void d.artboards[0].children.push(t as never), [t.id]);
    act(() => setState({ tool: 'text' }));
    render(<App />);
    const bar = screen.getByRole('toolbar', { name: 'Tool options' });
    expect(bar.querySelector('.ctx-font .cs-fp-trigger')).not.toBeNull();
    expect(bar.querySelector('.ctx-font-style')).not.toBeNull();
    // The stacked inspector picker would not fit the 40px bar.
    expect(bar.querySelector('.cs-fp')).toBeNull();
    expect(within(bar).getByRole('textbox', { name: 'Font size' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Align center' })).toBeInTheDocument();
  });
});

describe('fill and stroke widget', () => {
  it('swaps and resets the default colors', async () => {
    freshDoc();
    render(<App />);
    const before = getState().defaults;
    await userEvent.click(screen.getByRole('button', { name: 'Swap fill and stroke' }));
    expect(getState().defaults.fill).toEqual(before.stroke);
    expect(getState().defaults.stroke).toEqual(before.fill);
    await userEvent.click(screen.getByRole('button', { name: 'Default colors' }));
    expect(getState().defaults.fill).toMatchObject({ r: 1, g: 1, b: 1 });
    expect(getState().defaults.stroke).toMatchObject({ space: 'srgb' });
  });
});

describe('Escape', () => {
  it('finishes the tool first, then returns an idle tool to Move, then clears the selection', async () => {
    freshDoc();
    const r = makeRect(10, 10, 50, 50);
    mutate('Add', (d) => void d.artboards[0].children.push(r as never), [r.id]);
    render(<App />);
    act(() => setState({ tool: 'node' }));
    act(() => getState().docs[0] && setState({}));
    const { setNodeSelection } = await import('../../src/state/store');
    act(() => setNodeSelection([{ id: r.id, sp: 0, i: 0 }]));
    // 1st: the node tool clears its node selection and stays active.
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(getState().tool).toBe('node');
    expect(getState().docs[0].nodeSelection).toHaveLength(0);
    // 2nd: the idle tool hands back to Move, keeping the object selection.
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(getState().tool).toBe('move');
    expect(getState().docs[0].selection).toEqual([r.id]);
    // 3rd: on Move, Escape deselects.
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(getState().docs[0].selection).toEqual([]);
  });

  it('an idle drawing tool goes straight back to Move', () => {
    freshDoc();
    render(<App />);
    for (const k of ['p', 'm', 'l', 't', 'g', 'z']) {
      fireEvent.keyDown(window, { key: k, code: `Key${k.toUpperCase()}` });
      expect(getState().tool).not.toBe('move');
      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
      expect(getState().tool).toBe('move');
    }
  });
});

describe('document colors', () => {
  it('click applies a swatch to the selection; right-click opens the editor without applying', async () => {
    freshDoc();
    const r = makeRect(0, 0, 10, 10);
    mutate(
      'Add',
      (d) => {
        d.artboards[0].children.push(r as never);
        d.swatches.push({
          id: 'sw_t',
          name: 'Teal',
          color: { space: 'srgb', r: 0, g: 0.5, b: 0.5, a: 1 },
          global: true,
        } as never);
      },
      [r.id],
    );
    act(() => setState({ ui: { ...getState().ui, inspectorTab: 'assets' } }));
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    render(<App />);
    const fill = () =>
      getState().docs[0].doc.artboards[0].children[0].appearance.items.find((i) => i.kind === 'fill');
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Teal' }));
    expect(await screen.findByRole('textbox', { name: 'Swatch name' })).toBeInTheDocument();
    expect(fill() && fill()!.kind === 'fill' && 'swatch' in (fill()!.paint as { color: object }).color).toBe(
      false,
    );
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await userEvent.click(screen.getByRole('button', { name: 'Teal' }));
    expect((fill() as { paint: { color: { swatch?: string } } }).paint.color.swatch).toBe('sw_t');
  });
});

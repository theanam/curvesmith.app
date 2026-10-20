import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as T from '@radix-ui/react-tooltip';
import { makeRect, makeText } from '../../src/core/document';
import type { ImageNode } from '../../src/core/types';
import { activeDoc, mutate, select } from '../../src/state/store';
import { selectionBounds } from '../../src/core/transform';
import { DesignTab } from '../../src/ui/inspector/Design';
import { doc, freshDoc } from './helpers';

const image = (): ImageNode => ({
  id: 'nd_img',
  name: 'Photo',
  visible: true,
  locked: false,
  opacity: 1,
  blend: 'normal',
  transform: [1, 0, 0, 1, 10, 10],
  appearance: { items: [] },
  type: 'image',
  asset: 'assets/a.png',
  width: 200,
  height: 100,
});

function setWidth(v: string) {
  const w = screen.getByRole('textbox', { name: 'Width' });
  fireEvent.focus(w);
  fireEvent.change(w, { target: { value: v } });
  fireEvent.keyDown(w, { key: 'Enter' });
}

const lockButton = () => screen.getByRole('button', { name: 'Lock aspect ratio' });

describe('aspect ratio lock', () => {
  it('is on for images and text, off for shapes, and each remembers its own setting', () => {
    freshDoc();
    const img = image();
    const text = makeText(20, 150, 'Hello');
    const rect = makeRect(250, 10, 100, 50);
    mutate('Add', (d) => void d.artboards[0].children.push(img as never, text as never, rect as never));
    const ui = render(
      <T.Provider>
        <DesignTab />
      </T.Provider>,
    );

    act(() => select([img.id]));
    ui.rerender(
      <T.Provider>
        <DesignTab />
      </T.Provider>,
    );
    expect(lockButton()).toHaveAttribute('aria-pressed', 'true');
    setWidth('100');
    expect(selectionBounds(doc(), [img.id])).toMatchObject({ width: 100, height: 50 });

    act(() => select([text.id]));
    expect(lockButton()).toHaveAttribute('aria-pressed', 'true');

    act(() => select([rect.id]));
    expect(lockButton()).toHaveAttribute('aria-pressed', 'false');
    setWidth('200');
    expect(selectionBounds(doc(), [rect.id])).toMatchObject({ width: 200, height: 50 });

    // Unlocking for a shape does not unlock images.
    fireEvent.click(lockButton());
    expect(lockButton()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(lockButton());
    act(() => select([img.id]));
    expect(lockButton()).toHaveAttribute('aria-pressed', 'true');
  });
});

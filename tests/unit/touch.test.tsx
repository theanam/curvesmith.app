import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import * as T from '@radix-ui/react-tooltip';
import {
  getInput,
  markTouch,
  setPointerType,
  toggleModifier,
  toleranceScale,
  TOUCH_TOLERANCE,
  useInput,
} from '../../src/state/input';
import { TouchBar } from '../../src/ui/canvas/TouchBar';
import { builderTool } from '../../src/tools/builder';
import { penTool, penState } from '../../src/tools/pen';
import { makeRect } from '../../src/core/document';
import { mutate, select } from '../../src/state/store';
import { api, children, freshDoc } from './helpers';
import type { ToolPointer } from '../../src/tools/types';
import type { Vec } from '../../src/core/types';

const p = (world: Vec, dragging: boolean, alt = false): ToolPointer => ({
  world,
  screen: world,
  shift: false,
  alt,
  mod: false,
  button: 0,
  pressure: 0.5,
  dragging,
  downWorld: world,
  downScreen: world,
  moved: dragging,
  clickCount: 1,
});

beforeEach(() => {
  freshDoc();
  useInput.setState({ touch: false, shift: false, alt: false, mod: false });
  setPointerType('mouse');
});
afterEach(() => setPointerType('mouse'));

describe('touch input', () => {
  it('latches on-screen modifiers until tapped again', () => {
    toggleModifier('shift');
    expect(getInput().shift).toBe(true);
    toggleModifier('shift');
    expect(getInput().shift).toBe(false);
  });

  it('grows hit areas for fingers only', () => {
    expect(api().px(4)).toBe(4);
    setPointerType('touch');
    expect(toleranceScale()).toBe(TOUCH_TOLERANCE);
    expect(api().px(4)).toBe(4 * TOUCH_TOLERANCE);
    setPointerType('pen');
    expect(api().px(4)).toBe(4);
  });

  it('shows the touch keys once touch is used, and they reach the app keyboard handling', () => {
    const { rerender } = render(
      <T.Provider>
        <TouchBar />
      </T.Provider>,
    );
    expect(screen.queryByRole('toolbar', { name: 'Touch keys' })).toBeNull();
    markTouch();
    rerender(
      <T.Provider>
        <TouchBar />
      </T.Provider>,
    );
    const shift = screen.getByRole('button', { name: 'Shift' });
    fireEvent.click(shift);
    expect(shift).toHaveAttribute('aria-pressed', 'true');
    expect(getInput().shift).toBe(true);
    const keys: string[] = [];
    const on = (e: KeyboardEvent) => keys.push(e.key);
    window.addEventListener('keydown', on);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    window.removeEventListener('keydown', on);
    expect(keys).toEqual(['Escape']);
  });

  it('Shape builder picks up shapes when a finger lands, with no hover first', () => {
    const a = makeRect(0, 0, 100, 100);
    const b = makeRect(50, 0, 100, 100);
    mutate('Add', (d) => void d.artboards[0].children.push(a as never, b as never));
    select([]);
    builderTool.down!(p([25, 50], true), api());
    builderTool.move!(p([75, 50], true), api());
    builderTool.up!(p([75, 50], false), api());
    expect(children().filter((n) => n.type === 'path')).toHaveLength(2);
  });

  it('a pinch mid-path undoes only that press and keeps the path going', () => {
    const click = (w: Vec) => {
      penTool.down!(p(w, true), api());
      penTool.up!(p(w, false), api());
    };
    click([10, 10]);
    click([100, 10]);
    penTool.down!(p([200, 50], true), api());
    penTool.abortPress!(api());
    expect(penState().drawing).toBe(true);
    const path = children()[0];
    expect(path.type === 'path' && path.subpaths[0].nodes).toHaveLength(2);
    vi.restoreAllMocks();
  });
});

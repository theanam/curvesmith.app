import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as T from '@radix-ui/react-tooltip';
import { defaultGrid, gridLines, gridOf, gridPositions, gridStep } from '../../src/core/grid';
import { toPt } from '../../src/core/units';
import { addGuide, clearGuides, guideAt, removeGuide, setGuidePos } from '../../src/state/guides';
import { activeDoc, getState, setState, setUi, undo } from '../../src/state/store';
import { COMMANDS, run } from '../../src/state/commands';
import { moveTool } from '../../src/tools/move';
import { readCurvs, writeCurvs } from '../../src/formats/curvs';
import { StatusBar } from '../../src/ui/shell/StatusBar';
import { api, freshDoc } from './helpers';
import type { ToolPointer } from '../../src/tools/types';
import type { Vec } from '../../src/core/types';

const doc = () => activeDoc()!.doc;
const guides = () => doc().artboards[0].guides;
const p = (world: Vec, dragging: boolean, screen: Vec = world, moved = dragging): ToolPointer => ({
  world,
  screen,
  shift: false,
  alt: false,
  mod: false,
  button: 0,
  pressure: 0.5,
  dragging,
  downWorld: world,
  downScreen: screen,
  moved,
  clickCount: 1,
});

beforeEach(() => {
  freshDoc();
  setUi({ guides: true, lockGuides: false, showGrid: false });
});

describe('grid', () => {
  it('has a sensible default per unit', () => {
    expect(defaultGrid('mm')).toEqual({ spacing: toPt(10, 'mm'), subdivisions: 5, style: 'lines' });
    expect(defaultGrid('px')).toEqual({ spacing: 64, subdivisions: 8, style: 'lines' });
    expect(gridStep(defaultGrid('px'))).toBe(8);
    expect(gridOf({ units: 'pt' })).toEqual(defaultGrid('pt'));
  });

  it('lays lines from the artboard corner and stays under a line budget', () => {
    expect(gridPositions(20, 8)).toEqual([0, 8, 16]);
    expect(gridPositions(10000, 1, 100)).toEqual([]);
    const g = gridLines(
      { x: 100, y: 50, width: 16, height: 8 },
      { spacing: 8, subdivisions: 1, style: 'lines' },
    );
    expect(g).toEqual({ xs: [100, 108, 116], ys: [50, 58] });
  });

  it('snaps to the grid when grid snapping is on', () => {
    setState({
      snapping: { ...getState().snapping, objects: false, guides: false, nodes: false, grid: false },
    });
    expect(api().snap([13, 13]).point).toEqual([13, 13]);
    setState({ snapping: { ...getState().snapping, grid: true } });
    expect(api().snap([13, 13]).point).toEqual([16, 16]);
  });

  it('is saved with the document', async () => {
    const d = doc();
    d.grid = { spacing: 20, subdivisions: 4, style: 'dots' };
    const back = await readCurvs(await writeCurvs(d));
    expect(back.grid).toEqual({ spacing: 20, subdivisions: 4, style: 'dots' });
  });

  it('toggles from the View menu, which shows its state', () => {
    const cmd = COMMANDS.find((c) => c.id === 'view.grid')!;
    expect(cmd.checked!()).toBe(false);
    void run('view.grid');
    expect(getState().ui.showGrid).toBe(true);
    expect(cmd.checked!()).toBe(true);
    void run('view.snapGrid');
    expect(getState().snapping.grid).toBe(true);
  });
});

describe('guides', () => {
  it('adds, moves, deletes and clears guides as undoable steps', () => {
    addGuide('x');
    expect(guides()).toEqual([{ axis: 'x', pos: 200 }]);
    addGuide('y', 33.333);
    expect(guides()[1]).toEqual({ axis: 'y', pos: 33.33 });
    setGuidePos({ artboard: doc().artboards[0].id, index: 0 }, 120);
    expect(guides()[0].pos).toBe(120);
    removeGuide({ artboard: doc().artboards[0].id, index: 1 });
    expect(guides()).toHaveLength(1);
    undo();
    expect(guides()).toHaveLength(2);
    clearGuides();
    expect(guides()).toEqual([]);
  });

  it('finds the guide under the pointer', () => {
    addGuide('x', 100);
    expect(guideAt(doc(), [102, 500], 4)).toMatchObject({ index: 0, axis: 'x' });
    expect(guideAt(doc(), [110, 5], 4)).toBeNull();
  });

  it('the Move tool drags a guide, and dropping it off the canvas deletes it', () => {
    addGuide('x', 100);
    moveTool.down!(p([100, 50], true), api());
    moveTool.move!({ ...p([150, 60], true), downWorld: [100, 50], moved: true }, api());
    moveTool.up!(p([150, 60], false, [150, 60], true), api());
    expect(guides()[0].pos).toBe(150);
    moveTool.down!(p([150, 50], true), api());
    moveTool.move!({ ...p([10, 60], true, [-10, 60]), downWorld: [150, 50], moved: true }, api());
    moveTool.up!(p([10, 60], false, [-10, 60], true), api());
    expect(guides()).toEqual([]);
  });

  it('locked or hidden guides stay put', () => {
    addGuide('x', 100);
    setUi({ lockGuides: true });
    moveTool.down!(p([100, 50], true), api());
    moveTool.move!({ ...p([150, 50], true), downWorld: [100, 50], moved: true }, api());
    moveTool.up!(p([150, 50], false, [150, 50], true), api());
    expect(guides()[0].pos).toBe(100);
  });
});

describe('status bar', () => {
  const renderBar = () =>
    render(
      <T.Provider>
        <StatusBar />
      </T.Provider>,
    );

  it('changes the artboard size and units from the bottom bar', async () => {
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: 'Artboard size and units' }));
    const w = screen.getByRole('textbox', { name: 'Artboard width' });
    fireEvent.focus(w);
    fireEvent.change(w, { target: { value: '500' } });
    fireEvent.keyDown(w, { key: 'Enter' });
    expect(doc().artboards[0].width).toBe(500);
    fireEvent.change(screen.getByRole('combobox', { name: 'Document units' }), { target: { value: 'mm' } });
    expect(doc().units).toBe('mm');
  });

  it('switches color mode, adds an artboard, and saves from the bottom bar', async () => {
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: 'Color mode' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'CMYK · print' }));
    expect(doc().colorProfile).toBe('cmyk');
    await userEvent.click(screen.getByRole('button', { name: 'Switch artboard' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add artboard' }));
    expect(doc().artboards).toHaveLength(2);
    expect(activeDoc()!.activeArtboard).toBe(doc().artboards[1].id);
    expect(screen.getByRole('button', { name: /^Saved|Unsaved/ })).toBeInTheDocument();
  });

  it('shows and edits the grid from the bottom bar', async () => {
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: 'Grid settings' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show grid' }));
    expect(getState().ui.showGrid).toBe(true);
    await userEvent.click(screen.getByRole('radio', { name: 'Dots' }));
    expect(doc().grid?.style).toBe('dots');
  });
});

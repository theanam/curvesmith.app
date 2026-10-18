import { test, expect, newA4, state, mod } from './fixtures';

test('creates a document and draws with the pen', async ({ app: page }) => {
  await newA4(page);
  await page.keyboard.press('p');
  await page.mouse.click(500, 300);
  await page.mouse.move(600, 300);
  await page.mouse.down();
  await page.mouse.move(650, 260, { steps: 5 });
  await page.mouse.up();
  await page.mouse.click(700, 420);
  await page.keyboard.press('Enter');
  const nodes = await state<number>(page, 'od.doc.artboards[0].children[0].subpaths[0].nodes.length');
  expect(nodes).toBe(3);
  await expect(page.getByRole('treeitem', { name: /Path/ })).toBeVisible();
});

test('combines two shapes into a live union and undoes it', async ({ app: page }) => {
  await newA4(page);
  await page.keyboard.press('m');
  await page.mouse.move(450, 300);
  await page.mouse.down();
  await page.mouse.move(600, 450, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('l');
  await page.mouse.move(550, 380);
  await page.mouse.down();
  await page.mouse.move(700, 520, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press(`${mod}+a`);
  await page.getByRole('button', { name: 'Union', exact: true }).click();
  await expect.poll(() => state<string>(page, 'od.doc.artboards[0].children[0].type')).toBe('boolean');
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(() => state<number>(page, 'od.doc.artboards[0].children.length')).toBe(2);
});

test('exports SVG from the export dialog', async ({ app: page }) => {
  await newA4(page);
  await page.keyboard.press('m');
  await page.mouse.move(450, 300);
  await page.mouse.down();
  await page.mouse.move(600, 450, { steps: 4 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'SVG options' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export SVG' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('A4.svg');
  const text = await (await d.createReadStream()).toArray();
  const svg = Buffer.concat(text).toString('utf8');
  expect(svg).toContain('<svg');
  expect(svg).toMatch(/<(path|rect)/);
});

test('reload restores the autosaved document', async ({ app: page }) => {
  await newA4(page);
  await page.keyboard.press('l');
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(600, 400, { steps: 4 });
  await page.mouse.up();
  // Leaving the window autosaves; then reload.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { __curvesmith?: unknown }).__curvesmith);
  await expect
    .poll(() => state<number>(page, 'od ? od.doc.artboards[0].children.length : -1'), { timeout: 10_000 })
    .toBe(1);
  // Undo history came back too.
  expect(await state<number>(page, 'od.history.past.length')).toBe(1);
});

test('keyboard shortcuts drive tools, palette and zoom', async ({ app: page }) => {
  await newA4(page);
  for (const [k, tool] of [
    ['v', 'move'],
    ['a', 'node'],
    ['p', 'pen'],
    ['n', 'pencil'],
    ['t', 'text'],
    ['h', 'hand'],
    ['z', 'zoom'],
  ]) {
    await page.keyboard.press(k);
    await expect(page.locator(`[data-tool="${tool}"]`)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.keyboard.press(`${mod}+k`);
  await expect(page.getByPlaceholder('Search tools, actions, layers…')).toBeVisible();
  await page.keyboard.type('outline mode');
  await page.keyboard.press('Enter');
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { __curvesmith: { getState(): { ui: { outline: boolean } } } }
        ).__curvesmith.getState().ui.outline,
    ),
  ).toBe(true);
  await page.keyboard.press(`${mod}+1`);
  await expect(page.getByRole('button', { name: 'Zoom presets' })).toHaveText('100%');
});

test('help and about pages are reachable with GitHub and contact links', async ({ app: page }) => {
  await page.goto('/help');
  await expect(page.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /Report a bug/ })).toHaveAttribute(
    'href',
    /github\.com\/theanam\/curvesmith\.app\/issues/,
  );
  await expect(page.getByRole('link', { name: /anam\.ahmed\.a@gmail\.com/ })).toHaveAttribute(
    'href',
    'mailto:anam.ahmed.a@gmail.com',
  );
  await page.goto('/about');
  await expect(page.getByRole('heading', { name: 'About', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Back to app' }).click();
  await expect(page.getByRole('heading', { name: 'Start something' })).toBeVisible();
});

test('every tool options bar fits on one 40px row', async ({ app: page }) => {
  await newA4(page);
  // Text selected so the text bar shows its font controls.
  await page.keyboard.press('t');
  await page.mouse.click(500, 400);
  await page.keyboard.type('Hi');
  await page.keyboard.press('Escape');
  for (const k of ['v', 'a', 'p', 'n', 'c', 'Shift+M', 'm', 'l', '*', 't', 'g', 'i', 'h', 'z']) {
    await page.keyboard.press(k);
    const bar = page.locator('.contextbar');
    expect(await bar.evaluate((e) => e.getBoundingClientRect().height), k).toBe(40);
    // Nothing inside spills above or below the bar.
    const overflow = await bar.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return [...e.querySelectorAll('*')].some((c) => {
        const b = c.getBoundingClientRect();
        return b.height > 0 && (b.top < r.top - 0.5 || b.bottom > r.bottom + 0.5);
      });
    });
    expect(overflow, k).toBe(false);
  }
});

test('Escape finishes a path first, then returns to the Move tool', async ({ app: page }) => {
  await newA4(page);
  await page.keyboard.press('p');
  await page.mouse.click(500, 300);
  await page.mouse.click(600, 320);
  await page.keyboard.press('Escape');
  // The path is finished and the Pen stays active.
  await expect(page.locator('[data-tool="pen"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await state<number>(page, 'od.doc.artboards[0].children[0].subpaths[0].nodes.length')).toBe(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-tool="move"]')).toHaveAttribute('aria-pressed', 'true');
});

test('a /help deep link wins over a restored session', async ({ app: page }) => {
  await newA4(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(600);
  await page.goto('/help');
  await expect(page.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByRole('heading', { name: 'Help', level: 1 })).toBeVisible();
});

test('Escape in a popover closes it without deselecting', async ({ app: page }) => {
  await newA4(page);
  await page.keyboard.press('m');
  await page.mouse.move(450, 300);
  await page.mouse.down();
  await page.mouse.move(600, 450, { steps: 4 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Edit fill' }).click();
  await expect(page.locator('.cp')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cp')).toBeHidden();
  expect(await state<number>(page, 'od.selection.length')).toBe(1);
});

test('eyedropper picks colors from a placed image, with a loupe', async ({ app: page }) => {
  await newA4(page);
  // A 200×200 PNG, left half red.
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 200;
    const x = c.getContext('2d')!;
    x.fillStyle = '#e5484d';
    x.fillRect(0, 0, 100, 200);
    x.fillStyle = '#3b82f6';
    x.fillRect(100, 0, 100, 200);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
    const io = '/src/state/io.ts';
    const { placeFiles } = await import(/* @vite-ignore */ io);
    await placeFiles([new File([blob], 'swatch.png', { type: 'image/png' })]);
  });
  const center = await state<[number, number]>(
    page,
    'window.__curvesmith.centerOf(od.doc.artboards[0].children[0].id)',
  );
  // The placed image is selected: picking sets the default fill.
  await page.keyboard.press('i');
  await page.mouse.move(center[0] - 30, center[1]);
  await expect(page.locator('canvas[data-layer="overlay"]')).toBeVisible();
  await page.mouse.click(center[0] - 30, center[1]);
  await expect(page.getByText('Fill color set to #E5484D')).toBeVisible();
  // With a rectangle selected, the pick recolors it.
  await page.keyboard.press('m');
  await page.mouse.move(450, 700);
  await page.mouse.down();
  await page.mouse.move(520, 760, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.press('i');
  await page.mouse.click(center[0] + 30, center[1]);
  const fill = await state<{ r: number; g: number; b: number }>(
    page,
    "od.doc.artboards[0].children[1].appearance.items.find((i) => i.kind === 'fill').paint.color",
  );
  expect(Math.round(fill.b * 255)).toBe(0xf6);
});

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

test('the start screen does not scroll when its content fits, and scrolls at the window edge', async ({
  app: page,
}) => {
  await page.setViewportSize({ width: 1728, height: 820 });
  await page.evaluate(async () => {
    const storage = '/src/state/storage.ts';
    const { idbSet } = await import(/* @vite-ignore */ storage);
    for (let i = 0; i < 4; i++)
      await idbSet('recent', 'r' + i, {
        id: 'r' + i,
        name: 'File ' + i,
        ext: '.curvs',
        modified: Date.now(),
        thumbnail: null,
        handle: null,
      });
    window.dispatchEvent(new Event('curvesmith:recent'));
  });
  await expect(page.getByRole('button', { name: 'Open File 3' })).toBeVisible();
  const m = await page
    .locator('.home-main')
    .evaluate((e) => ({ overflow: e.scrollHeight - e.clientHeight, right: e.getBoundingClientRect().right }));
  expect(m.overflow).toBeLessThanOrEqual(0);
  expect(m.right).toBe(1728);
});

test('the toolbar Place image button places a picked image', async ({ app: page }) => {
  await newA4(page);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DwnwEIGBj+MzAwAAA4BwH/2hk1tQAAAABJRU5ErkJggg==',
    'base64',
  );
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Place image' }).click();
  await (await chooser).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png });
  await expect.poll(() => state<string>(page, 'od.doc.artboards[0].children[0]?.type')).toBe('image');
});

test('a stroke on a placed image is drawn around the photo', async ({ app: page }) => {
  await newA4(page);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DwnwEIGBj+MzAwAAA4BwH/2hk1tQAAAABJRU5ErkJggg==',
    'base64',
  );
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Place image' }).click();
  await (await chooser).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png });
  await expect.poll(() => state<string>(page, 'od.doc.artboards[0].children[0]?.type')).toBe('image');
  // Add a thick stroke, outside the photo.
  await page.getByRole('button', { name: 'Add fill, stroke or effect' }).click();
  await page.getByRole('menuitem', { name: 'Stroke' }).click();
  await page.getByRole('button', { name: 'Edit stroke' }).click();
  const weight = page.getByRole('textbox', { name: 'Stroke weight' });
  await weight.fill('20');
  await weight.press('Enter');
  await page.getByRole('radio', { name: 'Outside' }).click();
  await page.keyboard.press('Escape');
  // Read the canvas just outside the image's left edge: it must show the stroke color.
  const color = await page.evaluate(() => {
    const c = (
      window as unknown as {
        __curvesmith: {
          activeDoc(): { doc: { artboards: { children: { id: string }[] }[] } };
          centerOf(id: string): [number, number];
          worldToClient(x: number, y: number): [number, number];
        };
      }
    ).__curvesmith;
    const od = c.activeDoc();
    const img = od.doc.artboards[0].children[0] as unknown as { transform: number[]; height: number };
    const host = document.querySelector('[data-canvas-host]')!.getBoundingClientRect();
    const p = c.worldToClient(img.transform[4] - 4, img.transform[5] + img.height / 2);
    const cv = document.querySelector<HTMLCanvasElement>('canvas[data-layer="doc"]')!;
    const dpr = cv.width / cv.clientWidth;
    const d = cv
      .getContext('2d')!
      .getImageData(Math.round((p[0] - host.left) * dpr), Math.round((p[1] - host.top) * dpr), 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  // Default stroke is ink (#1A1820).
  expect(color[0]).toBeLessThan(60);
  expect(color[2]).toBeLessThan(60);
});

test('Shapes tool: pick a cog from the flyout, draw it, change its teeth', async ({ app: page }) => {
  await newA4(page);
  await page.keyboard.press('*');
  await page.locator('[data-tool="star"]').click();
  await page.getByRole('option', { name: 'Cog' }).click();
  await page.mouse.move(450, 300);
  await page.mouse.down();
  await page.mouse.move(600, 450, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => state<string>(page, 'od.doc.artboards[0].children[0]?.kind')).toBe('cog');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const c = (
      window as unknown as {
        __curvesmith: {
          select(ids: string[]): void;
          activeDoc(): { doc: { artboards: { children: { id: string }[] }[] } };
        };
      }
    ).__curvesmith;
    c.select([c.activeDoc().doc.artboards[0].children[0].id]);
  });
  await page.getByRole('button', { name: 'Teeth presets' }).click();
  await page.getByRole('menuitem', { name: '16', exact: true }).click();
  expect(await state<number>(page, 'od.doc.artboards[0].children[0].params.teeth')).toBe(16);
});

test('Shape builder merges overlapping shapes without selecting them first', async ({ app: page }) => {
  await newA4(page);
  const box = async (k: string, x: number, y: number) => {
    await page.keyboard.press(k);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 150, y + 150, { steps: 3 });
    await page.mouse.up();
  };
  await box('m', 450, 300);
  await box('l', 530, 360);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+m');
  await page.mouse.move(465, 315);
  await page.mouse.move(470, 320);
  await page.mouse.down();
  await page.mouse.move(560, 400, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() => state<string>(page, "od.doc.artboards[0].children.map((n) => n.type).join(',')"))
    .toBe('path,path');
});

test('traces a placed image into vector layers', async ({ app: page }) => {
  await newA4(page);
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 160;
    const x = c.getContext('2d')!;
    x.fillStyle = '#f4efe6';
    x.fillRect(0, 0, 240, 160);
    x.fillStyle = '#e5484d';
    x.beginPath();
    x.arc(70, 80, 50, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#3b82f6';
    x.fillRect(140, 30, 80, 100);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
    const io = '/src/state/io.ts';
    const { placeFiles } = await import(/* @vite-ignore */ io);
    await placeFiles([new File([blob], 'shapes.png', { type: 'image/png' })]);
  });
  await page.click('[data-action="trace-image"]');
  const dialog = page.getByRole('dialog', { name: 'Trace image' });
  await dialog.locator('[data-preset="logo"]').click();
  await expect(dialog.getByTestId('trace-stats')).toHaveText(/^3 colors · /);
  await dialog.getByRole('radio', { name: 'Outlines' }).click();
  await dialog.locator('[data-action="trace-apply"]').click();
  await expect(dialog).toBeHidden();
  const layers = await state<string[][]>(
    page,
    'od.doc.artboards[0].children.map((n) => [n.type, n.name, String(n.children?.length ?? 0)])',
  );
  expect(layers).toEqual([['group', 'shapes (traced)', '3']]);
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(() => state<string>(page, 'od.doc.artboards[0].children[0].type')).toBe('image');
});

test('guides come out of a ruler, move with the Move tool, and go when dropped on a ruler; the grid toggles', async ({
  app: page,
}) => {
  await newA4(page);
  const guides = () => state<{ axis: string; pos: number }[]>(page, 'od.doc.artboards[0].guides');
  const ruler = (await page.locator('.ruler.v').boundingBox())!;
  await page.mouse.move(ruler.x + 8, 400);
  await page.mouse.down();
  await page.mouse.move(600, 400, { steps: 5 });
  await page.mouse.up();
  expect((await guides()).map((g) => g.axis)).toEqual(['x']);
  const before = (await guides())[0].pos;
  await page.mouse.move(600, 600);
  await page.mouse.down();
  await page.mouse.move(700, 600, { steps: 5 });
  await page.mouse.up();
  expect((await guides())[0].pos).toBeGreaterThan(before);
  await page.mouse.move(700, 500);
  await page.mouse.down();
  await page.mouse.move(ruler.x + 5, 500, { steps: 5 });
  await page.mouse.up();
  expect(await guides()).toEqual([]);
  await page.getByRole('button', { name: 'Vertical' }).click();
  expect(await guides()).toHaveLength(1);

  // With guides hidden, dragging from a ruler makes nothing.
  await page.keyboard.press(`${mod}+;`);
  await page.mouse.move(ruler.x + 8, 300);
  await page.mouse.down();
  await page.mouse.move(650, 300, { steps: 5 });
  await page.mouse.up();
  expect(await guides()).toHaveLength(1);
  await expect(page.locator('.ruler.v')).not.toHaveAttribute('title', /.+/);
  await page.keyboard.press(`${mod}+;`);

  await page.getByRole('button', { name: 'Grid settings' }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Show grid' }).check();
  expect(await state<boolean>(page, 'window.__curvesmith.getState().ui.showGrid')).toBe(true);
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${mod}+'`);
  expect(await state<boolean>(page, 'window.__curvesmith.getState().ui.showGrid')).toBe(false);
});

test('uploads a font, uses it on text, outlines it, and embeds it in .curvs', async ({ app: page }) => {
  await newA4(page);
  await page.keyboard.press('t');
  await page.mouse.click(500, 300);
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: /^Font family/ })
    .first()
    .click();
  await page
    .locator('input[aria-label="Font files"]')
    .first()
    .setInputFiles('public/fonts/bricolage-grotesque-latin-standard-normal.woff2');
  await expect(page.getByText('Added Bricolage Grotesque')).toBeVisible();
  await page.getByRole('button', { name: 'My fonts', exact: true }).click();
  await page.getByRole('option', { name: /Bricolage Grotesque/ }).click();
  await expect
    .poll(() => state<string>(page, 'od.doc.artboards[0].children[0].runs[0].font.family'))
    .toBe('Bricolage Grotesque');
  const result = await page.evaluate(async () => {
    const c = (
      window as unknown as {
        __curvesmith: { getState(): { docs: { key: string; doc: never }[]; activeKey: string } };
      }
    ).__curvesmith;
    const s = c.getState();
    const doc = s.docs.find((d) => d.key === s.activeKey)!.doc as {
      artboards: { children: unknown[] }[];
    };
    const outline = '/src/fonts/outline.ts';
    const curvs = '/src/formats/curvs/index.ts';
    const { outlineText } = await import(/* @vite-ignore */ outline);
    const { writeCurvs, readCurvs } = await import(/* @vite-ignore */ curvs);
    const shapes = await outlineText(doc.artboards[0].children[0]);
    const back = await readCurvs(await writeCurvs(doc));
    return { shapes: shapes?.length ?? 0, fonts: back.fonts.map((f: { family: string }) => f.family) };
  });
  expect(result.shapes).toBeGreaterThan(0);
  expect(result.fonts).toEqual(['Bricolage Grotesque']);
});

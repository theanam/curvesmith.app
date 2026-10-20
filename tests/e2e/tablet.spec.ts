import { devices, type CDPSession, type Page } from '@playwright/test';
import { test, expect, state, mod } from './fixtures';

const { defaultBrowserType: _b, ...ipad } = devices['iPad Pro 11 landscape'];
test.use(ipad);

type Pt = [number, number];

async function touches(page: Page) {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const send = (type: string, pts: Pt[], timestamp?: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type: type as 'touchStart',
      touchPoints: pts.map(([x, y], id) => ({ x, y, id })),
      ...(timestamp ? { timestamp } : {}),
    });
  return {
    async drag(from: Pt, to: Pt, steps = 8) {
      await send('touchStart', [from]);
      for (let i = 1; i <= steps; i++)
        await send('touchMove', [
          [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps],
        ]);
      await send('touchEnd', []);
    },
    async tap(at: Pt) {
      await send('touchStart', [at]);
      await send('touchEnd', []);
    },
    /** Two taps 120 ms apart by their event timestamps, however slow the machine running the test is. */
    async doubleTap(at: Pt) {
      const t0 = Date.now() / 1000;
      await send('touchStart', [at], t0);
      await send('touchEnd', [], t0 + 0.03);
      await send('touchStart', [at], t0 + 0.12);
      await send('touchEnd', [], t0 + 0.15);
    },
    async pinch(center: Pt, from: number, to: number) {
      const at = (d: number): Pt[] => [
        [center[0] - d / 2, center[1]],
        [center[0] + d / 2, center[1]],
      ];
      await send('touchStart', at(from));
      for (let i = 1; i <= 6; i++) await send('touchMove', at(from + ((to - from) * i) / 6));
      await send('touchEnd', []);
    },
  };
}

const kids = (page: Page) => state<string[]>(page, 'od.doc.artboards[0].children.map((n) => n.type)');

test('works by touch: draw, pinch-zoom, on-screen Shift, and a pinch mid-path', async ({ app: page }) => {
  await page.tap('[data-preset="social"]');
  const t = await touches(page);
  await expect(page.getByRole('toolbar', { name: 'Touch keys' })).toBeVisible();

  await page.tap('[data-tool="rect"]');
  await t.drag([400, 300], [520, 380]);
  expect(await kids(page)).toEqual(['rect']);

  const zoom = await state<number>(page, 'od.view.zoom');
  await t.pinch([600, 450], 100, 260);
  expect(await state<number>(page, 'od.view.zoom')).toBeGreaterThan(zoom * 2);
  expect(await kids(page)).toEqual(['rect']);

  await page.getByRole('button', { name: 'Shift' }).tap();
  await page.tap('[data-tool="rect"]');
  await t.drag([300, 500], [420, 560]);
  await page.getByRole('button', { name: 'Shift' }).tap();
  const [w, h] = await state<number[]>(
    page,
    '[od.doc.artboards[0].children[1].width, od.doc.artboards[0].children[1].height]',
  );
  expect(Math.round(w)).toBe(Math.round(h));

  await page.tap('[data-tool="pen"]');
  await t.tap([500, 200]);
  await page.waitForTimeout(400);
  await t.tap([620, 260]);
  await page.waitForTimeout(400);
  await t.pinch([600, 500], 120, 150);
  await page.waitForTimeout(400);
  await t.tap([700, 200]);
  await page.getByRole('button', { name: 'Done' }).tap();
  expect(await state<number>(page, 'od.doc.artboards[0].children[2].subpaths[0].nodes.length')).toBe(3);
});

test('Shape builder and double-tap work without hover', async ({ app: page }) => {
  await page.tap('[data-preset="social"]');
  const t = await touches(page);
  await page.tap('[data-tool="rect"]');
  await t.drag([300, 250], [450, 400]);
  await page.tap('[data-tool="rect"]');
  await t.drag([380, 300], [530, 450]);
  await page.tap('[data-tool="move"]');
  await t.tap([700, 650]);
  await page.tap('[data-tool="builder"]');
  await t.drag([320, 270], [410, 330]);
  expect(await kids(page)).toEqual(['path', 'path']);

  // Group both through the app (select all, then the Group shortcut) and wait until it is done.
  await page.tap('[data-tool="move"]');
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(`${mod}+g`);
  await expect.poll(() => kids(page)).toEqual(['group']);
  // Record what the canvas receives, so a failure says what happened.
  await page.evaluate(() => {
    const w = window as unknown as { __taps: string[] };
    w.__taps = [];
    const host = document.querySelector('[data-canvas-host]')!;
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'dblclick'])
      host.addEventListener(
        type,
        (e) => w.__taps.push(`${type}:${(e as PointerEvent).pointerType ?? ''}@${Math.round(e.timeStamp)}`),
        true,
      );
  });
  await t.doubleTap([340, 280]);
  await expect
    .poll(async () => {
      const entered = await state<boolean>(page, 'od.isolation !== null');
      if (entered) return true;
      const sel = await state<string>(page, 'od.selection.join(",")');
      const taps = await page.evaluate(() => (window as unknown as { __taps: string[] }).__taps.join(' '));
      return `not entered; selection=[${sel}] events=${taps}`;
    })
    .toBe(true);
});

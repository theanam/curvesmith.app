import { devices, type CDPSession, type Page } from '@playwright/test';
import { test, expect, state } from './fixtures';

const { defaultBrowserType: _b, ...ipad } = devices['iPad Pro 11 landscape'];
test.use(ipad);

type Pt = [number, number];

async function touches(page: Page) {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const send = (type: string, pts: Pt[]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type: type as 'touchStart',
      touchPoints: pts.map(([x, y], id) => ({ x, y, id })),
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

  await page.tap('[data-tool="move"]');
  await page.evaluate(async () => {
    const c = (
      window as unknown as {
        __curvesmith: {
          getState(): {
            docs: { key: string; doc: { artboards: { children: { id: string }[] }[] } }[];
            activeKey: string;
          };
          select(ids: string[]): void;
        };
      }
    ).__curvesmith;
    const s = c.getState();
    const od = s.docs.find((d) => d.key === s.activeKey)!;
    c.select(od.doc.artboards[0].children.map((n) => n.id));
    const m = '/src/state/actions.ts';
    (await import(/* @vite-ignore */ m)).groupSelection();
  });
  await t.tap([700, 650]);
  await page.waitForTimeout(400);
  await t.tap([340, 280]);
  await t.tap([340, 280]);
  await expect.poll(() => state<boolean>(page, 'od.isolation !== null')).toBe(true);
});

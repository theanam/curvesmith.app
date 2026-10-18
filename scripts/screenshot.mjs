#!/usr/bin/env node
/* Regenerates the README screenshots, the tour images and the social preview image.
   Usage: npm run screenshot   (uses a running dev server on :5186, or starts one) */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.SCREENSHOT_URL ?? 'http://localhost:5186/';
const docs = resolve(root, 'docs/images');
const tour = resolve(root, 'public/tour');
mkdirSync(docs, { recursive: true });
mkdirSync(tour, { recursive: true });

async function ensureServer() {
  try {
    await fetch(URL);
    return null;
  } catch {
    const { createServer } = await import('vite');
    const server = await createServer({ root, server: { port: 5186, strictPort: true } });
    await server.listen();
    return server;
  }
}

const server = await ensureServer();
const browser = await chromium.launch();

async function openEditor(scheme) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
  });
  await page.addInitScript(() => {
    localStorage.setItem('curvesmith.tour', JSON.stringify('seen-v1'));
    localStorage.removeItem('curvesmith.session');
  });
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__curvesmith);
  await page.evaluate(() => window.__curvesmith.openSample('low-tide'));
  // Let fonts and PathKit settle.
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/** Node tool on Wave 2 with its middle node grabbed: shows handles, the HUD and a smart guide. */
async function nodeEditing(page) {
  await page.evaluate(() => {
    const c = window.__curvesmith;
    const id = c.idByName('Wave 2');
    c.setTool('node');
    c.select([id]);
    c.setNodeSelection([{ id, sp: 0, i: 1 }]);
  });
  await page.waitForTimeout(200);
  const p = await page.evaluate(() => {
    const c = window.__curvesmith;
    return c.nodePoint(c.idByName('Wave 2'), 0, 1);
  });
  await page.mouse.move(p[0], p[1]);
  await page.mouse.down();
  // Past the drag threshold, then back onto the line where the HUD and "3 nodes aligned" guide show.
  await page.mouse.move(p[0] + 8, p[1] + 6, { steps: 3 });
  await page.mouse.move(p[0] + 1, p[1] + 0.5, { steps: 3 });
  await page.waitForTimeout(250);
  return async () => {
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.evaluate(() => window.__curvesmith.getState().docs.length && undefined);
  };
}

// ---- Light: README hero + tour shots ----
const page = await openEditor('light');
let release = await nodeEditing(page);
await page.screenshot({ path: resolve(docs, 'screenshot.png') });
await page.screenshot({
  path: resolve(tour, 'node-tool.png'),
  clip: { x: 300, y: 120, width: 760, height: 640 },
});
await release();
await page.keyboard.press('Meta+z').catch(() => undefined);

// Editor overview (Move tool, a selection).
await page.evaluate(() => {
  const c = window.__curvesmith;
  c.setTool('move');
  c.select([c.idByName('Sun')]);
});
await page.waitForTimeout(300);
await page.screenshot({
  path: resolve(tour, 'editor.png'),
  clip: { x: 0, y: 0, width: 1440, height: 900 },
  scale: 'css',
});

// Assets tab.
await page.getByRole('tab', { name: 'Assets' }).click();
await page.waitForTimeout(300);
await page.screenshot({
  path: resolve(tour, 'assets.png'),
  clip: { x: 1136, y: 88, width: 304, height: 520 },
});
await page.getByRole('tab', { name: 'Design' }).click();

// Font picker on the title.
await page.evaluate(() => {
  const c = window.__curvesmith;
  c.select([c.idByName('Title')]);
});
await page.waitForTimeout(300);
await page.locator('.inspector .cs-fp-trigger').first().click();
await page.waitForTimeout(1800);
const pop = page.locator('.cs-fp-pop').last();
const box = await pop.boundingBox();
if (box)
  await page.screenshot({
    path: resolve(tour, 'fonts.png'),
    clip: {
      x: Math.max(0, box.x - 16),
      y: Math.max(0, box.y - 16),
      width: Math.min(1440 - box.x + 16, box.width + 32),
      height: Math.min(900 - box.y + 16, box.height + 32),
    },
  });
await page.keyboard.press('Escape');

// Command palette.
await page.keyboard.press('Meta+k');
await page.waitForTimeout(300);
await page.keyboard.type('union');
await page.waitForTimeout(300);
const pal = await page.locator('.palette').boundingBox();
if (pal)
  await page.screenshot({
    path: resolve(tour, 'palette.png'),
    clip: { x: pal.x - 20, y: pal.y - 20, width: pal.width + 40, height: Math.min(pal.height + 40, 520) },
  });
await page.keyboard.press('Escape');

// Export dialog.
await page.keyboard.press('Meta+Shift+e');
await page.waitForTimeout(1200);
const exp = await page.locator('.export-dialog').boundingBox();
if (exp)
  await page.screenshot({
    path: resolve(tour, 'export.png'),
    clip: { x: exp.x, y: exp.y, width: exp.width, height: exp.height },
  });
await page.keyboard.press('Escape');

// Start screen.
await page.evaluate(() => window.__curvesmith.setState({ route: 'home' }));
await page.waitForTimeout(400);
await page.screenshot({ path: resolve(docs, 'start-screen.png') });
await page.close();

// ---- Dark ----
const dark = await openEditor('dark');
release = await nodeEditing(dark);
await dark.screenshot({ path: resolve(docs, 'screenshot-dark.png') });
await release();
await dark.close();

// ---- Social preview (1200×630) ----
const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
const img = readFileSync(resolve(docs, 'screenshot.png')).toString('base64');
const lockup = readFileSync(resolve(root, 'public/brand/lockup-on-dark-transparent.svg')).toString('base64');
await og.setContent(`<!doctype html><html><body style="margin:0;width:1200px;height:630px;background:#141317;overflow:hidden;font-family:system-ui">
  <div style="position:absolute;left:64px;top:64px;width:430px">
    <img src="data:image/svg+xml;base64,${lockup}" style="height:58px">
    <div style="color:#F6F4EF;font-size:44px;font-weight:700;letter-spacing:-1.5px;line-height:1.05;margin-top:44px">Professional vector design in your browser.</div>
    <div style="color:#A19DA8;font-size:22px;margin-top:22px;line-height:1.4">No install, no account. Your files stay on your device.</div>
    <div style="color:#3BDC78;font-size:22px;margin-top:34px;font-family:ui-monospace,monospace">curvesmith.app</div>
  </div>
  <img src="data:image/png;base64,${img}" style="position:absolute;left:540px;top:70px;width:900px;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.6)">
</body></html>`);
await og.waitForTimeout(300);
await og.screenshot({ path: resolve(root, 'public/og-image.png') });
await og.close();

await browser.close();
if (server) await server.close();
console.log('Screenshots updated: docs/images, public/tour, public/og-image.png');

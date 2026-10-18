import { test as base, expect, type Page } from '@playwright/test';

/** Pages start with the tour already seen and with the native file pickers removed (downloads instead). */
export const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('keep-tour')) localStorage.setItem('curvesmith.tour', '"seen-v1"');
      delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
      delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
    });
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as { __curvesmith?: unknown }).__curvesmith);
    await use(page);
  },
});

export { expect };

export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

export async function newA4(page: Page) {
  await page.click('[data-preset="a4"]');
  await expect(page.getByRole('toolbar', { name: 'Tool options' })).toBeVisible();
}

export const state = <T>(page: Page, fn: string) =>
  page.evaluate(
    `(() => { const c = window.__curvesmith; const od = c.activeDoc(); return ${fn}; })()`,
  ) as Promise<T>;

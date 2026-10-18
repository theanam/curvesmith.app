import { test, expect } from '@playwright/test';

test('the tour appears on the first visit only and can be skipped', async ({ page }) => {
  await page.goto('/');
  const tour = page.getByRole('dialog');
  await expect(tour.getByText('Shape every curve.')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(tour.getByText('Draw Béziers with confidence')).toBeVisible();
  await tour.getByRole('button', { name: 'Skip' }).click();
  await expect(tour).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Start something' })).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.getByRole('dialog')).toBeHidden();
});

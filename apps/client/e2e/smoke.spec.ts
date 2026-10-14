import { expect, test } from '@playwright/test';

test('placeholder page boots Phaser with one visible canvas and zero errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.${message.type()}: ${message.text()}`);
  });

  await page.goto('/');
  await expect(page).toHaveTitle('Talad War');
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('canvas')).toBeVisible();

  expect(errors, 'zero page errors / console errors').toEqual([]);
});

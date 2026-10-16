import { expect, test } from '@playwright/test';

// Catches using the old 4x1 CSS crop with the approved 5x4 character atlas:
// each title box must show precisely one idle0 cell, not several tiny figures.
test('title mascots crop exactly one manifest-sized idle0 cell', async ({ page }) => {
  await page.goto('/?seed=43');
  await expect(page).toHaveTitle(/Talad War/);
  await page.getByRole('button', { name: 'เล่น', exact: true }).waitFor();
  const manifest = await (await page.request.get('/art/manifest.json')).json();
  const mascots = await page.locator('.tw-mascot').evaluateAll(async (elements) =>
    Promise.all(
      elements.map(async (element) => {
        const style = getComputedStyle(element);
        const url = style.backgroundImage.slice(5, -2);
        const image = new Image();
        image.src = url;
        await image.decode();
        return {
          file: new URL(url).pathname.split('/').pop()!,
          atlasWidth: image.naturalWidth,
          atlasHeight: image.naturalHeight,
          size: style.backgroundSize,
          position: style.backgroundPosition,
        };
      }),
    ),
  );
  expect(mascots).toHaveLength(2);
  for (const mascot of mascots) {
    const character = Object.values(manifest.characters).find(
      (entry) => (entry as { file: string }).file === mascot.file,
    ) as { frameWidth: number; frameHeight: number };
    expect(character).toBeDefined();
    expect(mascot.size).toBe(
      `${(mascot.atlasWidth / character.frameWidth) * 100}% ${(mascot.atlasHeight / character.frameHeight) * 100}%`,
    );
    expect(mascot.position).toBe('0px 0px');
  }
});

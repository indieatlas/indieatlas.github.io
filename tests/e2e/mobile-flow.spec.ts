import { expect, test } from '@playwright/test';

// スマートフォンで、検索から作品詳細、ストアまでたどれる（受入基準10）
test('検索して作品詳細へ移り、最初の画面にストアのボタンがある', async ({ page }) => {
  await page.goto('games/');
  await page.locator('#search-input').fill('星屑');
  const card = page.locator('[data-search-results] a.game-card').first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(/games\/g_000004\/$/);
  const store = page.locator('.store-button');
  await expect(store).toBeInViewport();
  await expect(store).toHaveAttribute('href', 'https://stardust-atelier.example.jp/buy');
  const box = await store.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test('幅 360px で横にはみ出さない', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const p of ['./', 'games/', 'games/g_000001/', 'articles/', 'collections/col_0001/']) {
    await page.goto(p);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, p).toBeLessThanOrEqual(1);
  }
});

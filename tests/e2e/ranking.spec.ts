import { expect, test } from '@playwright/test';

// Amazon の売れ筋（CI では scripts/dev/fake-amazon-ranking.ts の架空の商品でビルドする）
test('ホームと売れ筋のページに、プリペイドカードと周辺機器を除いて並ぶ', async ({ page }) => {
  await page.goto('./');
  const row = page.locator('section[aria-labelledby="ranking-h"] .amazon-ranking li');
  if ((await row.count()) === 0) test.skip(true, '売れ筋のデータがない（キーがない環境）');
  await expect(row).toHaveCount(10);
  await page.goto('ranking/');
  const items = page.locator('.amazon-ranking li');
  await expect(items.first()).toContainText('ランタンの森');
  await expect(page.locator('.amazon-ranking')).not.toContainText('プリペイド');
  await expect(page.locator('.amazon-ranking')).not.toContainText('チケット');
  await expect(page.locator('.amazon-ranking')).not.toContainText('コントローラー');
  const link = items.first().locator('a');
  await expect(link).toHaveAttribute('rel', /sponsored/);
  await expect(link).toHaveAttribute('href', /tag=pspken-22/);
  await expect(page.locator('main')).toContainText('アソシエイト');
});

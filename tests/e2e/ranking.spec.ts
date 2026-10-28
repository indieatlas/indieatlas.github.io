import { expect, test } from '@playwright/test';

// 売れ筋。CI では scripts/dev/fake-amazon-ranking.ts の架空の商品でビルドする（Amazon の売れ筋）。
// 手元で Steam の売上上位を取得してあれば、そちらが出る
test('ホームと売れ筋のページに並び、リンクは Amazon のアソシエイトか Steam のストア', async ({ page }) => {
  await page.goto('./');
  const row = page.locator('section[aria-labelledby="ranking-h"] .ranking-list li');
  if ((await row.count()) === 0) test.skip(true, '売れ筋のデータがない');
  await expect(row).toHaveCount(10);
  await page.goto('ranking/');
  const list = page.locator('.ranking-list');
  const steam = (await page.locator('h1').innerText()).includes('Steam');
  if (!steam) {
    // Amazon の売れ筋: プリペイドカードと周辺機器を除く
    await expect(list.locator('li').first()).toContainText('ランタンの森');
    await expect(list).not.toContainText('プリペイド');
    await expect(list).not.toContainText('チケット');
    await expect(list).not.toContainText('コントローラー');
  }
  for (const link of await list.locator('li > a').all()) {
    const href = (await link.getAttribute('href'))!;
    if (href.includes('amazon.co.jp')) {
      expect(href).toMatch(/tag=pspken-22/);
      await expect(link).toHaveAttribute('rel', /sponsored/);
    } else expect(href).toMatch(/^https:\/\/store\.steampowered\.com\/app\/\d+\/$/);
  }
  await expect(page.locator('main')).toContainText('アソシエイト');
});

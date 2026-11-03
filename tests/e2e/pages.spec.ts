import { expect, test } from '@playwright/test';

// 各ページが表示され、ナビゲーションがベースパスの中で完結する（09 P1-07、08 §8.4）
test('ホームから作品詳細へ移る', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('h1')).toContainText('インディーゲーム');
  await expect(page.getByRole('heading', { name: '最近収録した作品' })).toBeVisible();
  await page.locator('section[aria-labelledby="recent-h"] a.game-card').first().click();
  await expect(page).toHaveURL(/\/games\/g_\d{6}\/$/);
  await expect(page.getByRole('heading', { name: '基本情報' })).toBeAttached();
});

test('作品一覧（JS なしの静的な一覧）とページ送り', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto('games/');
  await expect(page.locator('[data-static-listing] a.game-card')).toHaveCount(6);
  await context.close();
});

test('作品詳細: 不明の表示と出典のリンク（受入基準4）', async ({ page }) => {
  await page.goto('games/g_000002/');
  const info = page.locator('.info');
  await expect(info.locator('dt', { hasText: '日本語対応' }).locator('xpath=..')).toContainText('不明');
  await page.goto('games/g_000001/');
  // 機種は見出しの横に並べる
  await expect(page.locator('.headline .chips')).toContainText('Nintendo Switch');
  for (const label of ['発売', '日本語対応']) {
    const row = info.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=..');
    await expect(row.locator('.source-refs a').first()).toHaveAttribute('href', /^https?:\/\//);
    await expect(row.locator('.source-refs').first()).toContainText('確認日');
  }
  await expect(page.locator('.history')).toContainText('2026年 冬');
});

test('作品詳細: 外部リンクは新しいタブで開き、noreferrer を付けない', async ({ page }) => {
  await page.goto('games/g_000001/');
  const store = page.locator('.store-button');
  await expect(store).toHaveAttribute('target', '_blank');
  await expect(store).toHaveAttribute('rel', 'noopener');
});

test('記事一覧と種別のタブ', async ({ page }) => {
  await page.goto('articles/');
  await expect(page.locator('.article-item')).toHaveCount(3);
  // はてなブックマークの反応は、当サイトの要約とエントリーへのリンクだけを出す
  const reactions = page.locator('.article-item .reactions');
  await expect(reactions).toHaveCount(1);
  await expect(reactions.locator('li')).toHaveText(['完成度を優先した延期を歓迎する声', '前作の灯台めぐりを懐かしむ声']);
  await expect(reactions.getByRole('link', { name: /はてブ 42件/ })).toHaveAttribute('href', /^https:\/\/b\.hatena\.ne\.jp\/entry\//);
  await page.getByRole('navigation', { name: '記事の種別' }).getByRole('link', { name: 'インタビュー' }).click();
  await expect(page).toHaveURL(/articles\/kind\/interview\/$/);
  await expect(page.locator('.article-item')).toHaveCount(1);
});

test('コレクション一覧と詳細', async ({ page }) => {
  await page.goto('collections/');
  await page.locator('a.collection-card').first().click();
  await expect(page).toHaveURL(/collections\/col_0001\/$/);
  await expect(page.getByRole('heading', { name: '選定条件' })).toBeVisible();
  await expect(page.locator('a.game-card')).toHaveCount(4);
});

test('運営説明', async ({ page }) => {
  await page.goto('about/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('運営説明');
});

test('404 ページ', async ({ page }) => {
  const res = await page.goto('no-such-page/');
  expect(res?.status()).toBe(404);
  await expect(page.locator('h1')).toContainText('ページが見つかりません');
});

test('統合済みの作品の転送ページ', async ({ page, baseURL }) => {
  await page.goto('games/g_000007/');
  // 転送先は SITE_URL の絶対 URL。パスで確かめる
  await expect(page).toHaveURL((u) => u.pathname === `${new URL(baseURL!).pathname}games/g_000004/`);
});

test('build-manifest.json を配信する', async ({ request }) => {
  const m = await (await request.get('build-manifest.json')).json();
  expect(m.contentHash).toMatch(/^sha256:/);
});

test('殿堂入りと人気の作品は一覧と詳細で見分けられる', async ({ page }) => {
  await page.goto('games/');
  await expect(page.locator('a.game-card[data-game-id="g_000001"]')).toHaveClass(/is-landmark/);
  await expect(page.locator('a.game-card[data-game-id="g_000001"] .game-card__badge')).toHaveText(/殿堂入り/);
  await expect(page.locator('a.game-card[data-game-id="g_000002"] .game-card__badge')).toHaveText('人気');
  await page.goto('games/g_000001/');
  await expect(page.locator('.headline .prominence')).toHaveText(/殿堂入り/);
  await expect(page.locator('.headline .reviews')).toContainText('圧倒的に好評（好評 95%');
});

test('作品詳細: Steam のレビューの要約を長所と短所に分けて出す', async ({ page }) => {
  await page.goto('games/g_000001/');
  const section = page.locator('section[aria-labelledby="reviews-h"]');
  await expect(section.locator('li.pro')).toHaveCount(2);
  await expect(section.locator('li.con')).toHaveCount(1);
  await expect(section).toContainText('レビュー50件');
});

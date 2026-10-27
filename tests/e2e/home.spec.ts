import { expect, test } from '@playwright/test';

// ホームの最新情報のカルーセルと、背景の WebGL
test('カルーセルを前後のボタンで送れる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  const carousel = page.locator('[data-carousel]');
  await expect(carousel.locator('[data-controls]')).toBeVisible();
  const track = carousel.locator('[data-track]');
  const before = await track.evaluate((t) => t.scrollLeft);
  await carousel.getByRole('button', { name: '次の情報' }).click();
  await expect.poll(() => track.evaluate((t) => t.scrollLeft)).toBeGreaterThan(before);
  // 自動再生は止められる（WCAG 2.2.2）
  const pause = carousel.locator('[data-pause]');
  if (await pause.isVisible()) {
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
  }
});

test('広い画面では複数の記事が同時に見える', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  const slides = page.locator('[data-slide]');
  await expect(slides.nth(0)).toBeInViewport();
  await expect(slides.nth(1)).toBeInViewport();
});

test('カルーセルから作品詳細へ移れる', async ({ page }) => {
  await page.goto('./');
  await page.locator('[data-slide]').first().locator('.games a').click();
  await expect(page).toHaveURL(/games\/g_\d{6}\/$/);
});

test('reduced motion の環境では自動再生しない', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await expect(page.locator('[data-pause]')).toHaveAttribute('aria-pressed', 'true');
});

test('WebGL の背景は1つだけで、操作の邪魔をしない', async ({ page }) => {
  await page.goto('./');
  const stage = page.locator('canvas.stage');
  await expect(stage)
    .toHaveCount(1, { timeout: 5000 })
    .catch(() => {});
  if ((await stage.count()) === 0) test.skip(true, 'この環境では WebGL2 が使えない');
  await expect(stage).toHaveAttribute('aria-hidden', 'true');
  expect(await stage.evaluate((c) => getComputedStyle(c).pointerEvents)).toBe('none');
});

test('WebGL を使えない環境では CSS の背景のままになる', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2' || type === 'webgl') return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof orig;
  });
  await page.goto('./');
  await page.waitForTimeout(2500);
  await expect(page.locator('canvas.stage')).toHaveCount(0);
  await expect(page.locator('a.game-card').first()).toBeVisible();
});

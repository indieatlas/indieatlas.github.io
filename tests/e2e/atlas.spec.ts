import { expect, test } from '@playwright/test';

// アトラス（02 §2.7、09 P1-09）
test('WebGL が使える環境で点が描かれ、ツールチップから作品詳細へ移れる', async ({ page, baseURL }) => {
  await page.goto('./');
  const host = page.locator('atlas-canvas');
  const state = await host.getAttribute('data-state', { timeout: 1 }).catch(() => null);
  await expect(host).toHaveAttribute('data-state', /ready|static/, { timeout: 10_000 });
  test.skip((await host.getAttribute('data-state')) === 'static' && state === null, 'この環境では WebGL2 が使えない');
  await expect(page.locator('atlas-canvas canvas')).toBeVisible();
  // 点を探してポインターを置く
  const points = (await (await page.request.get('atlas.json')).json()).points as { id: string }[];
  const box = (await page.locator('atlas-canvas canvas').boundingBox())!;
  let found = false;
  for (let y = box.y + 20; y < box.y + box.height - 20 && !found; y += 8) {
    for (let x = box.x + box.width * 0.4; x < box.x + box.width - 20 && !found; x += 8) {
      await page.mouse.move(x, y);
      if (await page.locator('.atlas-tooltip:not([hidden])').count()) {
        found = true;
        await page.mouse.click(x, y);
      }
    }
  }
  expect(found).toBe(true);
  await expect(page).toHaveURL(new RegExp(`${baseURL}games/(${points.map((p) => p.id).join('|')})/$`));
});

test('reduced motion の環境では静止画を描く（操作は受け付ける）', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await expect(page.locator('atlas-canvas')).toHaveAttribute('data-state', /ready|static/, { timeout: 10_000 });
  await expect(page.locator('[data-atlas-fallback]')).toBeAttached();
});

test('WebGL を使えない環境では静的な表示になる', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2' || type === 'webgl') return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof orig;
  });
  await page.goto('./');
  await expect(page.locator('atlas-canvas')).toHaveAttribute('data-state', 'static');
  await expect(page.locator('atlas-canvas canvas')).toHaveCount(0);
  await expect(page.locator('[data-atlas-fallback] .star-card').first()).toBeVisible();
});

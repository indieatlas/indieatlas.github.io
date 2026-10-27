import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// 主要なページで、axe の serious と critical の違反がない（09 P1-13）
for (const [name, path] of [
  ['ホーム', './'],
  ['作品一覧', 'games/'],
  ['作品詳細', 'games/g_000001/'],
  ['記事一覧', 'articles/'],
  ['コレクション', 'collections/col_0001/'],
  ['運営説明', 'about/'],
  ['イベント', 'events/'],
  ['売れ筋', 'ranking/'],
  ['開発元の一覧', 'developers/'],
  ['パブリッシャーの一覧', 'publishers/'],
  ['開発元', 'developers/dev_000001/'],
] as const) {
  for (const scheme of ['dark', 'light'] as const) {
    test(`${name}（${scheme}）`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.goto(path);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
}

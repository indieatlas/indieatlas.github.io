import { prepareSite, readFreshAmazonRanking, SITE_DATA_DIR, writePreparedSite } from '../build/prepare-site.ts';
import { codeHashes } from '../build/content-hash.ts';
import { runMain } from '../lib/errors.ts';
import { loadRepo } from '../lib/repo-io.ts';

// data/ から .generated/site-data/ を作る。アトラスの座標と公開内容ハッシュも計算する（03 §3.4）
await runMain(() => {
  const site = prepareSite(loadRepo(), codeHashes(), readFreshAmazonRanking());
  writePreparedSite(site);
  const stats = site.files.stats as { games: number; articles: number; collections: number };
  console.log(
    `prepare-site: ${stats.games} games, ${stats.articles} articles, ${stats.collections} collections → ${SITE_DATA_DIR}`,
  );
  console.log(`contentHash: ${site.meta.contentHash}`);
});

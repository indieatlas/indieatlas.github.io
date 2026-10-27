# 08 公開先と移行

移行するときも、収集の処理、作品 ID、データの形式、ページの生成は変えない。差し替えるのは公開の設定とデプロイの処理だけにする。

## 8.1 設定値

| 設定 | GitHub Pages での例 | 移行後 | 置き場所 |
| - | - | - | - |
| `SITE_URL` | `https://owner.github.io` | 独自ドメインのオリジン（例: `https://indieatlas.example`） | GitHub の Variables |
| `BASE_PATH` | `/indieatlas/` | 通常は `/` | GitHub の Variables |
| 公開の処理 | `actions/upload-pages-artifact` と `actions/deploy-pages` | 移行先へのアップロード（§8.7） | update.yml の deploy ジョブ |
| 素材の配信 | 配信元の URL を参照する（[05](05-sources-and-editorial-policy.md) §5.4.2） | 必要に応じて CDN やストレージへ移す | — |

`BASE_PATH` は先頭と末尾にスラッシュを付ける。`astro.config.mjs` は起動時に形式を検証し、誤っていればビルドを止める。

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const site = process.env.SITE_URL ?? 'http://localhost:4321';
const base = process.env.BASE_PATH ?? '/';
if (!/^\/([^/]+\/)*$/.test(base)) throw new Error(`BASE_PATH must start and end with "/": ${base}`);
if (!/^https?:\/\/[^/]+$/.test(site)) throw new Error(`SITE_URL must be an origin without a path: ${site}`);

export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', assets: '_assets' },
  integrations: [sitemap()],
});
```

## 8.2 URL の生成（`src/lib/urls.ts`）

内部リンク、画像の URL、検索索引、canonical、sitemap、OGP の URL は、すべて共通の設定から作る。

```ts
const base = normalizeBase(import.meta.env.BASE_URL);   // 必ず "/" で終わる形に揃える
const site = import.meta.env.SITE;

/** サイト内のパスを、ベースパス付きの URL にする。path の先頭の "/" はあってもなくてもよい */
export function url(path = ''): string {
  return base + path.replace(/^\/+/, '');
}

/** canonical、OGP、sitemap 用の絶対 URL */
export function absoluteUrl(path = ''): string {
  return new URL(url(path), site).href;
}

export const paths = {
  home: () => '',
  games: (page = 1) => (page === 1 ? 'games/' : `games/page/${page}/`),
  game: (id: string) => `games/${id}/`,
  articles: (page = 1) => (page === 1 ? 'articles/' : `articles/page/${page}/`),
  articleKind: (kind: string, page = 1) => (page === 1 ? `articles/kind/${kind}/` : `articles/kind/${kind}/page/${page}/`),
  collections: () => 'collections/',
  collection: (id: string) => `collections/${id}/`,
  about: () => 'about/',
};
```

規則は次のとおり。

- コンポーネントとページに、`href="/…"` や `src="/…"` を直接書かない。必ず `url()` を通す。`tests/unit/no-raw-links.test.ts` で `src/` を走査し、違反を見つけたら失敗させる。
- ブラウザで動くスクリプトは、`<html data-base="{BASE_PATH}">` からベースパスを読む。
- `public/` の素材（プレースホルダー画像、フォント）も `url()` で参照する。CSS の中の `url()` はファイルからの相対パスにする。

## 8.3 ベースパスに関わる個別の対応

| 対象 | 対応 |
| - | - |
| Pagefind | `import(url('pagefind/pagefind.js'))` で読み込み、`await pagefind.options({ baseUrl: BASE_PATH })` を指定する。結果の URL がベースパスを含むことを E2E で確かめる |
| アトラスのデータ | `fetch(url('atlas.json'))` |
| sitemap | `@astrojs/sitemap` が `site` と `base` から作る |
| robots.txt | `src/pages/robots.txt.ts` で生成し、`Sitemap: {absoluteUrl('sitemap-index.xml')}` を書く |
| canonical と OGP | `absoluteUrl()` で作る。OGP の画像は作品の画像（外部の URL）か、`public/og-default.png` |
| 404 | `src/pages/404.astro` が `dist/404.html` になる。GitHub Pages ではプロジェクトサイトでも独自ドメインでも、このファイルが使われる |
| 統合済みの作品の転送ページ | `<meta http-equiv="refresh" content="0; url={統合先の絶対 URL}">`、`<link rel="canonical" href="{統合先の絶対 URL}">`、統合先へのリンクを置いた HTML |

## 8.4 2種類のパスでの確認

受入基準9（`/repository-name/` の配下とドメイン直下の両方で、リンクと検索が動作する）のため、次を行う。

- CI で `BASE_PATH` を `/indieatlas/` と `/` の2通りにしてビルドし、両方で `check:dist` と E2E テストを実行する（[07](07-workflows-and-operations.md) §7.3）。
- E2E テストでは、`scripts/dev/serve-dist.ts --base {BASE_PATH} --port 4173` で `dist/` を指定したベースパスの下に配信する。`BASE_PATH` の外へのリクエストは 404 にし、ベースパスの付け忘れを見つける。
- E2E テストの内容: ホームから作品詳細へ移る、検索して結果から作品詳細へ移る、ページ送り、コレクション詳細、記事一覧の種別のタブ、404 ページ、統合済みの作品の転送ページ。

## 8.5 移行の手順

移行は、実用的な発見体験が得られ、自動更新の品質と費用が続けられると判断できた段階（[10](10-testing-and-acceptance.md) §10.6）で進める。

1. **独自ドメインを取得する。**
2. **移行先を決める**（§8.7 の要件で比べる）。
3. **移行先へのデプロイを用意する。** update.yml に移行先用の deploy ジョブを追加する。build ジョブの成果物（`dist/`）をそのまま使い、`SITE_URL` を独自ドメイン、`BASE_PATH` を `/` にしてビルドする。認証は、移行先が対応していれば OIDC を使い、対応していなければ権限を絞ったトークンを環境のシークレットにする。
4. **移行先で同じ成果物を公開して確かめる。** 移行先のプレビュー用の URL などで、`check:dist` と E2E テスト（`E2E_BASE_URL` で対象を切り替える）を通す。
5. **DNS を切り替える。** HTTPS の証明書が有効になったことを確かめる。
6. **旧 URL からの移行導線を置く。** GitHub Pages では、サーバー側の恒久的なリダイレクト（301）を設定できない。旧 `github.io` の URL が検索エンジンでそのまま引き継がれるとは考えない。代わりに、GitHub Pages の成果物を「転送ページの集まり」に切り替える。
   - `BUILD_TARGET=redirect-stubs npm run build` で、旧サイトのすべての URL（`sitemap` と作品 ID の一覧から作る）について、新しい URL へ案内する静的なページを作る。各ページには `<meta http-equiv="refresh" content="0; url={新しい URL}">`、`<link rel="canonical" href="{新しい URL}">`、新しい URL へのリンクと説明文を置く。
   - 旧サイトの `build-manifest.json` には `"movedTo": "{新しいオリジン}"` を書く。
   - 転送ページは12か月以上残す。
7. **設定を切り替える。** Variables の `SITE_URL` と `BASE_PATH` を新しい値にする。update.yml の deploy ジョブを移行先のものに切り替え、GitHub Pages への通常のデプロイを止める（転送ページの成果物は、手順6で1回だけデプロイする）。
8. **監視を切り替える。** 死活監視と `check:publish` の取得先を新しい URL にする。

## 8.6 GitHub Pages の制限

| 制限 | 値 | 対応 |
| - | - | - |
| 公開サイトの大きさ | 1GB まで | `check:dist` で 500MB を超えたら警告、800MB で失敗（[07](07-workflows-and-operations.md) §7.5 の B-07）。manifest の `distBytes` を実行の記録に残す |
| 月間の帯域 | 100GB（ソフトリミット） | GitHub Pages では計測できない。画像を外部参照にして負荷を抑える。アクセスが増えたら移行を早める |
| デプロイ | 1回10分でタイムアウト | 成果物の大きさを抑える |
| 利用の条件 | 主にオンラインビジネスや商取引のためのサイトには使えない | 広告やアフィリエイトを入れる場合は、先に移行する |
| 公開の条件 | リポジトリの公開範囲と GitHub のプランで、Pages を使えるかが変わる | P1-12 で確認する（[11](11-open-decisions.md) D-02） |

制限の値は変わることがある。P1-12 と移行の判断の前に、GitHub の公式ドキュメントで確かめる。

## 8.7 移行先の要件

| 要件 | 理由 |
| - | - |
| 静的なファイルを配信できる | `dist/` をそのまま置く |
| 独自ドメインと、自動で管理される TLS 証明書 | |
| GitHub Actions からデプロイできる（OIDC か、権限を絞ったトークン） | 公開のジョブだけに権限を渡す |
| リダイレクトの規則を設定できる（301） | 統合済みの作品 ID や将来の URL 変更を、転送ページではなく本当のリダイレクトにする |
| 応答ヘッダーを設定できる | `/_assets/` と `/pagefind/` に長いキャッシュ（`immutable`）を付ける |
| プレビュー用の URL（任意） | 手順4の確認に使う |
| 帯域と費用が、試行期間のアクセスの見込みに合う | |

ホストに依存する設定は、ホストに依存しない中間の形式から作る。

- `scripts/build/site-data.ts` が `.generated/hosting/redirects.json`（`[{ from, to, status: 301 }]`）と `.generated/hosting/headers.json`（`[{ path, headers }]`）を書く。
- 移行先ごとの小さな変換スクリプト（`scripts/build/hosting/{host}.ts`）が、それをホストの形式（例: `_redirects`、`_headers`、設定ファイル）にして `dist/` に置く。
- GitHub Pages では、リダイレクトを転送ページで代用し、ヘッダーは設定しない。

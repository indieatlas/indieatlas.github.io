# Indie Atlas

インディーゲームのライブラリ兼ショーケース。作品を「星図」に配置し、出典に基づく情報、関連記事、コレクションから、遊び方や雰囲気で作品を探せるようにする静的サイトです。仕様は [docs/](docs/README.md) にあります。

## 必要なもの

- Node.js 24 以上（`.nvmrc`）と npm

## よく使うコマンド

```sh
npm ci
npm run dev            # data/ からサイト用データを作り、開発サーバーを起動する（部品の一覧は /dev/components/）
npm run build          # prepare-site → astro build → pagefind → build-manifest.json
npm run preview        # dist/ を配信する（--base /indieatlas/ でベースパスを変えられる）
npm run check:types    # astro check と tsc
npm run check:data     # data/、state/、config/ の検証（04 §4.10）
npm run check:dist     # 公開前の検証（07 §7.5）
npm test               # 単体テスト（外部と通信しない）
npm run test:e2e       # ビルド済みの dist/ に対する E2E テスト
npm run seed:steam -- --app 413150   # Steam の作品情報から候補の作品と Claim を作る
npm run media:articles               # 記事の OGP 画像を WebP で public/media/articles/ に保存する
```

E2E テストと CI は、架空の作品だけのフィクスチャ（`tests/fixtures/repo/`）でビルドしたサイトを使います。

```sh
INDIEATLAS_ROOT=tests/fixtures/repo npm run build
BASE_PATH=/indieatlas/ SITE_URL=https://example.github.io INDIEATLAS_ROOT=tests/fixtures/repo npm run build
npm run test:e2e
```

フィクスチャを作り直すときは `npx tsx tests/fixtures/generate-repo.ts` を実行します。

## 構成

| 場所 | 内容 |
| - | - |
| `schema/` | Zod スキーマ（データ、状態、設定、サイト用データ、manifest） |
| `data/`、`state/`、`config/` | 正規化した JSON のデータ、運用の状態、人が管理する設定 |
| `scripts/lib/` | 読み書き、ID、ハッシュ、正規化などの共通処理 |
| `scripts/build/` | サイト用データ、公開内容ハッシュ、公開前の検証 |
| `scripts/pipeline/` | データの検証、公開条件、Steam からの取り込み |
| `src/` | Astro のサイト（`.generated/site-data/` だけを読む） |

## 公開

`main` への push で `.github/workflows/update.yml` が動き、公開中の `build-manifest.json` と内容が違うときだけ GitHub Pages にデプロイします。リポジトリの Variables に `SITE_URL`（例: `https://owner.github.io`）と `BASE_PATH`（例: `/indieatlas/`）を設定し、Settings → Pages → Source を「GitHub Actions」にしてください（07 §7.9）。

## 実装の状況

第1段階（[docs/09-roadmap.md](docs/09-roadmap.md) の P1-01〜P1-13）を実装しました。情報源の自動取得、LLM による調査、定期実行（第2段階以降）は未実装で、`npm run research`、`adopt`、`ia`、`report:trial` は「未実装」と表示して終了します。

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
npm run media:events                 # イベントの OGP 画像を public/media/events/ に保存する
npm run refresh:status               # 古くなったもの、確かめ直すもの（発売予定、催し、指標、記事の情報源）を JSON で出す（通信しない）
npm run refresh:feeds                # 媒体のフィードから、まだ登録していない新しい記事の候補を JSON で出す（データは変えない）
npm run claims:repoint               # 置き換えられた Claim を参照するコレクションの項目を、置き換えた先に付け替える
npm run media:palettes               # 作品の画像から色を抽出する（作品詳細のページの色）
npm run igdb:sync                    # IGDB から機種、スクリーンショット、ストアのリンクを取り込む（.env にキーが必要）
npm run metrics:popularity           # Steam のレビュー数と IGDB の評価を取得する（殿堂入り、人気の判定）
npm run reviews:summarize            # Steam のレビューを LLM で要約する（OPENCODE_API_KEY と Steam への接続が必要）
npm run ranking:steam                # Steam のインディーの売上上位を取得する（キー不要。コミットしない）
npm run amazon:ranking               # Amazon の売れ筋を取得する（.env に Creators API のキーが必要。コミットしない）
npm run research -- --out out/research [--max-tasks 3]  # 調査ジョブ: 新着の記事、未収録の作品、催し、発売情報を LLM で調べ、提案を out/ に書く（data/ は変えない）
npm run adopt -- --in out/research --dry-run            # 採用ジョブ: 提案を検証して data/ と state/ に反映する（--dry-run は差分を見て戻す。--push でコミットして push）
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

## コーディングエージェントでの更新

サイトの内容をまとめて最新にするときは、コーディングエージェント（Codex など）でスキル `ia-refresh`（`.agents/skills/ia-refresh/SKILL.md`）を使います。「サイトの内容を全部最新にして」のように頼むと、作品の発売情報、指標と要約、新しい記事、催しの日程、画像を順に更新し、検証とビルドまで行います（[docs/12-agent-skills.md](docs/12-agent-skills.md) §12.6.7）。

## 毎日の自動更新

`.github/workflows/update.yml` が毎日、日本時間 8時17分に research → adopt → build → deploy を行います（[docs/07](docs/07-workflows-and-operations.md) §7.2）。

- **research**（LLM のキーあり、書き込みなし）: 登録した媒体のフィードから新着を集め、タイトルで仕分け、記事を読んで扱う作品を探します。未収録のインディーの作品の登録、発売情報の変更の確認、催しの日程の確認、コレクションへの追加も、タスクとして実行します。LLM（OpenCode Go の DeepSeek V4.1 Flash）は決まったツール（`fetch_url`、`find_games`、`get_game`、`get_steam_app`）で調べ、結果を決まった形式の提案として返します。
- **adopt**（書き込みあり、LLM のキーなし）: 提案を検証ルール（根拠の抜粋が取得したページにあるか、作品を扱っているページか、使わない表現がないか、同定、上限など。[docs/06](docs/06-update-pipeline.md) §6.7）で確かめ、通ったものだけを反映します。新しい Steam の作品の発売情報や画像はストアから取り込み、Claim の採用、公開の判定、`check:data` を通してから `main` にコミットします。
- 20時17分は公開だけをやり直します（Amazon の売れ筋の更新）。毎週月曜には `refresh-metrics.yml` が IGDB の機種、知名度、レビューと反応の要約を作り直します。`watchdog.yml` は朝の更新が36時間以上成功していなければ Issue を作ります。

LLM だけを止めるときは、リポジトリの Variables の `INDIEATLAS_LLM_ENABLED` を `false` にします（収集と公開は続きます）。

## 公開

`main` への push で `.github/workflows/update.yml` が動き、公開中の `build-manifest.json` と内容が違うときだけ GitHub Pages にデプロイします。リポジトリの Variables に `SITE_URL`（例: `https://owner.github.io`）と `BASE_PATH`（例: `/indieatlas/`）を設定し、Settings → Pages → Source を「GitHub Actions」にしてください（07 §7.9）。

## 実装の状況

第1段階（[docs/09-roadmap.md](docs/09-roadmap.md) の P1-01〜P1-13）、第2段階の情報の取り込み（P2-01〜P2-09）、第3段階の定期実行（P3-01〜P3-06）と、記事、作品、催し、発売情報、コレクションの更新に要る第4段階の一部を実装しました。手動の作業用の CLI（`npm run ia`、P2-11）と試行期間の集計（`report:trial`）は未実装で、「未実装」と表示して終了します。

# 03 アーキテクチャとリポジトリ構成

## 3.1 技術スタック【初期案】

| 部分 | 採用するもの | 理由・補足 |
| - | - | - |
| 実行環境 | Node.js 24 LTS（`.nvmrc` に `24` と書き、`package.json` の `engines` を `>=24` にする） | GitHub Actions と手元の環境をそろえる |
| パッケージ管理 | npm（`package-lock.json` をコミットする） | 追加の準備が要らない |
| 言語 | TypeScript（`strict: true`、ESM のみ）。`@astrojs/check` が対応する 6 系 | 11 の決定ログ（2026-10-27） |
| スクリプトの実行 | `tsx` | `scripts/` の TypeScript をビルドせずに実行する |
| サイト生成 | Astro（実装時点の最新の安定版。メジャーバージョンを固定する）。`output: 'static'`、`trailingSlash: 'always'`、`build.format: 'directory'` | 静的な成果物を作り、公開先を変えやすくする |
| スキーマ | Zod | データの型と形式を検証する。LLM の構造化出力のスキーマにも同じものを使う |
| 検索 | Pagefind | ビルド結果から検索索引を作る（§3.6） |
| サイトマップ | `@astrojs/sitemap` | |
| フィード・HTML の解析 | RSS 1.0、RSS 2.0、Atom は `scripts/pipeline/feed-items.ts` の小さな読み取り（依存なし）。HTML は `linkedom`（DOM）と `@mozilla/readability`（本文の抽出） | 2026-11-04 に実装 |
| robots.txt の解釈 | `robots-parser` | |
| 並列数の制御 | 依存なし（`scripts/pipeline/research.ts` の小さなワーカー。同じホストへの間隔は Fetcher が守る） | |
| 画像の変換 | `sharp`（手元とスクリプトだけで使う） | 記事の OGP 画像を WebP に変換して保存する（`npm run media:articles`） |
| LLM | OpenCode Go の DeepSeek V4.1 Flash（`deepseek-v4.1-flash`）。OpenAI 互換のエンドポイントに `scripts/llm/client.ts` が直接接続する（SDK は使わない） | [06](06-update-pipeline.md) §6.9 |
| 単体テスト | Vitest | |
| E2E テスト | Playwright と `@axe-core/playwright` | |
| 整形 | Prettier と `prettier-plugin-astro` | |
| 型検査 | `astro check` と `tsc --noEmit` | |

依存を追加する場合は、上記で足りない理由を PR の説明に書く。

## 3.2 リポジトリ構成

```
indieatlas/
├── AGENTS.md                   # コーディングエージェント向けの案内（12 §12.4）
├── CLAUDE.md                   # `@AGENTS.md` だけを書く
├── .agents/
│   └── skills/                 # 手動の作業のスキル（12 §12.6）。Codex と OpenCode が読む
│       ├── ia-common/RULES.md
│       ├── ia-add-game/SKILL.md
│       ├── ia-collect/SKILL.md
│       ├── ia-link-article/SKILL.md
│       ├── ia-edit-collection/SKILL.md
│       ├── ia-fix-data/SKILL.md
│       └── ia-add-source/SKILL.md
├── .github/
│   ├── workflows/
│   │   ├── update.yml          # 定期更新と公開: research → adopt → build → deploy（07 §7.2）
│   │   ├── ci.yml              # PR と push の検証（07 §7.3）
│   │   └── watchdog.yml        # 最終成功時刻の監視（07 §7.8）
│   ├── ISSUE_TEMPLATE/
│   │   └── correction.yml      # 情報の訂正依頼（リポジトリを公開する場合）
│   └── CODEOWNERS              # config/、.github/、schema/、scripts/pipeline/validate/、.agents/skills/ の変更に人のレビューを必須にする
├── config/                     # 人が管理する設定。調査ジョブからは変更できない
│   ├── policy.md               # 対象作品、編集、公開の方針（LLM にも渡す）
│   ├── runtime.json            # 件数、時間、費用、モデルの設定
│   └── sources.json            # 情報源と取得条件、権利条件
├── data/                       # 正規化した公開用データ（04 を参照）
│   ├── games/g_000001.json
│   ├── claims/g_000001.json
│   ├── articles/a_3f9c2e1b7d4a5c60.json
│   ├── developers/dev_000001.json
│   ├── collections/col_0001.json
│   ├── relations/game-relations.json
│   └── taxonomy/tags.json
├── state/                      # 運用の状態（04 §4.8）
│   ├── sources/{sourceId}.json # 情報源ごとの処理位置
│   ├── tasks.json              # 未完了と最近完了したタスク
│   ├── tasks-archive/YYYY-MM.json
│   ├── seen-urls.json          # 処理済み URL の台帳
│   ├── review-queue.json       # 人の判断を待つ提案（作品の統合など）
│   ├── runs/YYYY-MM.json       # 実行の記録
│   └── usage/YYYY-MM.json      # 費用の台帳
├── schema/                     # Zod スキーマ（I/O を持たない純粋なコード）
│   ├── common.ts               # ID、日付、URL、言語、機種、ストアなど
│   ├── game.ts
│   ├── claim.ts
│   ├── article.ts
│   ├── developer.ts
│   ├── collection.ts
│   ├── relation.ts
│   ├── taxonomy.ts
│   ├── state.ts                # SourceState、Task、RunSummary、UsageLedger、SeenUrl、ReviewItem
│   ├── config.ts               # RuntimeConfig、SourceConfig
│   ├── proposal.ts             # LLM が出力する TaskResult と Operation（06 §6.6）
│   ├── site-data.ts            # サイト用データの型（§3.7）
│   └── manifest.ts             # build-manifest.json
├── scripts/
│   ├── lib/                    # 共通処理: repo-io（正規化した JSON の読み書き）、ids、hash、url-normalize、
│   │                           #   text-normalize、partial-date、clock、logger、errors
│   ├── fetch/                  # Fetcher: robots.txt、間隔の制御、SSRF の防止、本文の抽出、取得ログ
│   ├── sources/                # 情報源のアダプタ: rss.ts、atom.ts、sitemap.ts、html-list.ts、steam.ts
│   ├── llm/
│   │   ├── client.ts           # LlmClient インターフェース
│   │   ├── opencode-go.ts      # OpenCode Go（OpenAI 互換）のアダプタ
│   │   ├── fake.ts             # テスト用（フィクスチャを再生する）
│   │   ├── pricing.ts          # usage から費用を計算する
│   │   └── prompts/            # システムプロンプト（Markdown）
│   ├── pipeline/
│   │   ├── collect.ts          # 情報源の取得と新着の抽出（LLM なし）
│   │   ├── triage.ts           # 新着記事の関連性の判定（LLM）
│   │   ├── tasks.ts            # タスクの生成、優先度、選択
│   │   ├── plan.ts             # 調査計画（LLM とコード）
│   │   ├── execute.ts          # タスクの実行（LLM とツール）
│   │   ├── tools/              # LLM に渡すツール: fetch-url、find-games、get-game、steam-app、submit-result
│   │   ├── budget.ts           # 時間と費用の管理
│   │   ├── validate/           # 提案の検証ルール V-*（06 §6.7）
│   │   ├── apply.ts            # 検証を通った提案をデータへ反映する
│   │   ├── adopt-core.ts       # 採用ジョブの手順4〜13（06 §6.11）。ia apply と共用
│   │   ├── merge.ts            # 作品の統合の反映（06 §6.12）
│   │   ├── resolve.ts          # Claim の採用アルゴリズム（06 §6.8）
│   │   ├── identity.ts         # 作品の同定（04 §4.3）
│   │   └── publish-rules.ts    # 公開条件の判定（05 §5.5）
│   ├── build/
│   │   ├── site-data.ts        # data/ → .generated/site-data/
│   │   ├── palette.ts          # 画像からの色の抽出
│   │   ├── content-hash.ts     # 公開内容ハッシュ
│   │   ├── manifest.ts         # dist/build-manifest.json
│   │   └── dist-checks.ts      # 公開前の検証
│   ├── run/                    # CLI の入口（npm scripts から呼ぶ）
│   │   ├── research.ts
│   │   ├── adopt.ts
│   │   ├── prepare-site.ts
│   │   ├── finalize-dist.ts
│   │   ├── check-data.ts
│   │   ├── check-dist.ts
│   │   ├── check-publish.ts
│   │   ├── seed-steam.ts       # 初期データ作成の補助（09 P1-04）
│   │   ├── ia.ts               # 手動の作業用の CLI（12 §12.2）
│   │   └── report-trial.ts     # 試行期間の評価の集計（10 §10.6）
│   └── dev/
│       ├── serve-dist.ts       # dist を任意のベースパスで配信する
│       └── llm-smoke.ts        # LLM の接続先の動作を手元で確かめる（09 P2-04）
├── src/
│   ├── config/site.ts          # サイト名、説明文など（SITE_URL、BASE_PATH は環境変数から）
│   ├── lib/
│   │   ├── data.ts             # サイト用データの読み出し（.generated/site-data/ だけを読む）
│   │   ├── urls.ts             # url()、absoluteUrl()（08 §8.2）
│   │   └── format.ts           # 日付、発売状況、機種名などの表示用の整形
│   ├── components/             # 02 §2.6.6
│   ├── layouts/
│   ├── pages/                  # 02 §2.2 の URL に対応する
│   ├── content/about.md
│   ├── scripts/                # ブラウザで動く TypeScript
│   │   ├── search/             # 検索 UI（Custom Elements）
│   │   ├── gl/                 # 背景の WebGL（stage.ts）
│   │   └── theme.ts
│   └── styles/                 # tokens.css、base.css、utilities.css
├── public/                     # favicon、プレースホルダー画像、フォント
├── tests/
│   ├── unit/                   # scripts/ と schema/ の構成に合わせる
│   ├── integration/            # Fake の LLM と取得を使い、research → adopt を通す
│   ├── e2e/                    # Playwright
│   ├── search/queries.json     # 検索品質の確認用（10 §10.4）
│   └── fixtures/
│       ├── repo/               # 架空の作品によるデータ一式
│       ├── web/                # 取得結果として使う HTML、XML、JSON
│       └── llm/                # LLM の応答を記録したもの
├── docs/
├── .generated/                 # 生成物（Git の管理外）
├── out/                        # 調査ジョブの出力（Git の管理外）
├── dist/                       # ビルド結果（Git の管理外）
├── astro.config.mjs
├── package.json
├── tsconfig.json               # パスの別名: @schema/* → schema/*、@scripts/* → scripts/*
├── playwright.config.ts
├── vitest.config.ts
├── .nvmrc
├── .prettierrc
└── .gitignore                  # node_modules/、dist/、.generated/、out/（out/manual/ を含む）、.astro/、test-results/
```

## 3.3 モジュール境界と依存の向き

```
schema/  ←─ scripts/lib/  ←─ scripts/{fetch,sources,llm,search}/  ←─ scripts/pipeline/  ←─ scripts/run/
   ↑                                                                                      
   └──────── scripts/build/  ←─ scripts/run/prepare-site.ts
   ↑
   └──────── src/lib/data.ts（.generated/site-data/ を読む） ←─ src/pages/, src/components/
```

- `schema/` は他のどこにも依存しない。I/O を持たない。
- `src/`（サイト）は `data/` を直接読まない。`scripts/build/site-data.ts` が作った `.generated/site-data/` だけを `src/lib/data.ts` 経由で読む。データの保存先を DB などに変えても、変更は `scripts/build/` の範囲で済む。
- `src/` から `scripts/pipeline/`、`scripts/llm/` を import しない。
- LLM の接続先に送る処理は `scripts/llm/client.ts` だけに置く。他のモジュールは `LlmClient` インターフェースだけを使う。
- 外部への HTTP 通信は `scripts/fetch/` と `scripts/llm/` からだけ行う。テストではこれらを Fake に差し替える。

## 3.4 npm scripts

| コマンド | 内容 |
| - | - |
| `npm run dev` | `prepare-site` を実行してから `astro dev` を起動する |
| `npm run prepare-site` | `data/` から `.generated/site-data/` を作る。公開内容ハッシュも計算する |
| `npm run build` | `prepare-site` → `astro build` → `pagefind --site dist` → `finalize-dist`（`dist/build-manifest.json` を書く） |
| `npm run check:types` | `astro check && tsc --noEmit` |
| `npm run check:data` | `data/`、`state/`、`config/` 全体のスキーマ、参照、並び順を検証する（04 §4.10） |
| `npm run check:dist` | 公開前の検証（07 §7.5） |
| `npm run check:publish` | 公開済みの manifest と比べ、デプロイが必要かを判定する（07 §7.6） |
| `npm test` | `vitest run` |
| `npm run test:e2e` | `playwright test`（ビルド済みの `dist/` を `serve-dist` で配信して試す） |
| `npm run research -- --out out/ [--llm opencode-go\|fake] [--mode full\|collect-only] [--max-tasks N]` | 調査ジョブの本体（06 §6.1） |
| `npm run adopt -- --in out/ [--push] [--dry-run]` | 採用ジョブの本体（06 §6.1） |
| `npm run ia -- <コマンド>` | 手動の作業用の CLI。コーディングエージェントのスキルから使う（[12](12-agent-skills.md) §12.2） |
| `npm run seed:steam -- --app {steamAppId}` | Steam の作品情報から候補の作品と Claim を作る（初期データ作成の補助） |
| `npm run report:trial -- --from YYYY-MM-DD --to YYYY-MM-DD` | 試行期間の評価指標を集計する |
| `npm run format` | Prettier で整形する |

## 3.5 環境変数と設定ファイル

### 3.5.1 環境変数

| 名前 | 使う場所 | 既定値 | 説明 |
| - | - | - | - |
| `SITE_URL` | build | `http://localhost:4321` | 公開先のオリジン（08 §8.1） |
| `BASE_PATH` | build | `/` | 公開先のベースパス。先頭と末尾にスラッシュを付ける |
| `OPENCODE_API_KEY` | research | なし | OpenCode Go の API キー。research ジョブにだけ渡す |
| `RUN_ID`、`RUN_ATTEMPT` | research、adopt、build | `local`、`1` | GitHub Actions の `github.run_id` と `github.run_attempt` |
| `SOURCE_COMMIT`、`TRIGGER_COMMIT` | build | `git rev-parse HEAD` | manifest に記録する |
| `INDIEATLAS_LLM` | research | `opencode-go` | `fake` にするとフィクスチャを再生する |
| `INDIEATLAS_LLM_ENABLED` | research | `true` | `false` にすると LLM を呼ばずに収集だけを行う（緊急停止用。GitHub の Variables で設定する） |
| `INDIEATLAS_NOW` | 全体 | 現在時刻 | テスト用に時刻を固定する（ISO 8601） |
| `INDIEATLAS_ROOT` | 全体 | リポジトリの直下 | `data/`、`state/`、`config/` を読み書きする場所。テストでは `tests/fixtures/repo` にする（[10](10-testing-and-acceptance.md) §10.2） |

### 3.5.2 `config/runtime.json`

件数と時間は処理能力の保証ではなく、初期運用の設定である。定期実行を有効にする前に、費用の上限を確定する（[11](11-open-decisions.md) D-05）。

```json
{
  "schemaVersion": 1,
  "run": {
    "softDeadlineMinutes": 40,
    "hardDeadlineMinutes": 50,
    "maxTasks": 40,
    "maxTasksPerGame": 2,
    "executeConcurrency": 3
  },
  "limits": {
    "maxNewArticles": 30,
    "maxNewGames": 10,
    "maxNewlyPublishedGames": 10,
    "maxFetchesPerTask": 8,
    "maxOperationsPerTask": 60,
    "maxFollowUpTasksPerTask": 5
  },
  "exploration": {
    "minTaskShare": 0.2,
    "lowCoverageArticleThreshold": 1
  },
  "budget": {
    "currency": "USD",
    "monthlyLimit": 30,
    "perRunLimit": 1.5,
    "perTaskLimit": 0.15
  },
  "llm": {
    "provider": "opencode-go",
    "baseUrl": "https://opencode.ai/inference/go/openai/v1",
    "apiKeyEnv": "OPENCODE_API_KEY",
    "sessionHeader": "x-opencode-session",
    "modelsUrl": "https://opencode.ai/inference/go/v1/models",
    "roles": {
      "triage": {
        "model": "deepseek-v4.1-flash",
        "thinking": "disabled",
        "reasoningEffort": null,
        "maxOutputTokens": 8000
      },
      "plan": {
        "model": "deepseek-v4.1-flash",
        "thinking": "disabled",
        "reasoningEffort": null,
        "maxOutputTokens": 16000
      },
      "execute": {
        "model": "deepseek-v4.1-flash",
        "thinking": "enabled",
        "reasoningEffort": null,
        "maxOutputTokens": 32000
      },
      "resolve": {
        "model": "deepseek-v4.1-flash",
        "thinking": "enabled",
        "reasoningEffort": "high",
        "maxOutputTokens": 32000
      }
    },
    "pricingUsdPerMTok": {
      "deepseek-v4.1-flash": {
        "offPeak": {
          "input": 0.15,
          "output": 0.6,
          "cacheRead": 0.003
        },
        "peak": {
          "input": 0.3,
          "output": 1.2,
          "cacheRead": 0.006
        }
      }
    },
    "peakHoursUtc": {
      "days": [
        "mon",
        "tue",
        "wed",
        "thu",
        "fri"
      ],
      "ranges": [
        [
          "01:00",
          "04:00"
        ],
        [
          "06:00",
          "10:00"
        ]
      ]
    },
    "plan": {
      "name": "go",
      "monthlyAllowanceUsd": {
        "deepseek-v4.1-flash": 80
      }
    },
    "maxTurnsPerTask": 16,
    "requestTimeoutSeconds": 300
  },
  "fetch": {
    "userAgent": "IndieAtlasBot/0.1 (+{SITE_URL}{BASE_PATH}about/)",
    "timeoutSeconds": 15,
    "maxBytes": 4000000,
    "perDomainMinIntervalMs": 3000,
    "maxTextChars": 20000
  },
  "publish": {
    "candidateTagMinGames": 3,
    "autoPublishNewCollections": false,
    "autoMergeGames": false
  },
  "evidence": {
    "storeQuotes": true,
    "maxQuoteChars": 200
  },
  "retention": {
    "seenUrlDays": 180,
    "doneTaskDays": 30
  }
}
```

| キー | 意味 |
| - | - |
| `run.softDeadlineMinutes` | これを過ぎたら新しいタスクを始めない |
| `run.hardDeadlineMinutes` | これを過ぎたら実行中の LLM 呼び出しを中断し、出力を書いて終了する。ジョブの `timeout-minutes` は 25 分とし、終了処理の時間を残す |
| `run.maxTasks` | 1回の実行で扱うタスク数の上限 |
| `limits.maxNewArticles` | 1回の実行で新しく処理する記事の上限 |
| `limits.maxNewGames` | 1回の実行で新しく作る作品（candidate）の上限。超えた分は `register-game` タスクとして次回以降に回す |
| `limits.maxNewlyPublishedGames` | 1回の実行で candidate から published に移す作品の上限 |
| `exploration.minTaskShare` | タスク枠のうち、探索（`discover` と報道の少ない作品の調査）に確保する割合の下限 |
| `budget.*` | Indie Atlas が使ってよい LLM の利用額の上限（[11](11-open-decisions.md) D-05 で確定するまでの仮の値）。OpenCode Go のプランの上限（`llm.plan`）より低くする |
| `llm.provider`、`llm.baseUrl`、`llm.apiKeyEnv`、`llm.sessionHeader`、`llm.modelsUrl` | 接続先の設定（[06](06-update-pipeline.md) §6.9.2、§6.9.6） |
| `llm.roles.*` | 役割ごとのモデル、思考モードの有無、推論の深さ、出力の上限。`reasoningEffort` が `null` なら送らず、モデルの既定に任せる。指定できる値は P2-04 で確認する |
| `llm.pricingUsdPerMTok` | 100万トークンあたりの単価。時間帯（オフピークとピーク）ごとに持つ。2026年10月27日時点の OpenCode Go の公表値を初期値にしている。定期実行の開始前に確認する |
| `llm.peakHoursUtc` | ピークの時間帯（UTC） |
| `llm.plan` | 契約しているプランと、モデルごとの月の利用額の上限。予算の警告に使う |
| `publish.autoMergeGames` | `false` の間、作品の統合の提案は `state/review-queue.json` に入り、人が判断する |
| `publish.autoPublishNewCollections` | `false` の間、LLM が作った新しいコレクションは `draft` のままにする |
| `evidence.storeQuotes` | `false` にすると、根拠の抜粋を保存せず、ハッシュだけを保存する（[11](11-open-decisions.md) D-11） |

`config/runtime.json` の Zod スキーマは `schema/config.ts` に置き、各スクリプトは起動時に検証する。不正な設定なら起動を止める。

### 3.5.3 `config/sources.json` と `config/policy.md`

形式は [05-sources-and-editorial-policy.md](05-sources-and-editorial-policy.md) §5.2 と §5.8 にある。

## 3.6 検索の実装

- ビルド後に `pagefind --site dist` を実行し、`dist/pagefind/` に索引を作る。
- 索引の対象は作品詳細のページだけにする。作品詳細の本文に `data-pagefind-body` を付け、その他のページは索引に入れない。
- 作品詳細に次の属性を付ける。

| 属性 | 用途 |
| - | - |
| `data-pagefind-meta="title"` などのメタ情報 | 結果の表示（表示名、原題、画像、発売状況のラベル、日本語対応、収録日） |
| `data-pagefind-filter="tag"`、`"platform"`、`"release"`、`"ja"`、`"mode"` | 絞り込み |
| `data-pagefind-sort="added"`、`"released"` | 並び替え（`YYYY-MM-DD` 形式の値） |
| `data-pagefind-weight="10"` | 表示名、原題、別名に付けて関連度を上げる |

- 別名、読み、略称、ローマ字表記は、画面に出さない要素（`.visually-hidden`）に入れて索引に含める。表示名と読みについては、ひらがなとカタカナを相互に変換した表記も加える（Pagefind は仮名の違いを同一視しないため）。
- 日本語の分かち書きには、Pagefind の extended 版のバイナリが必要である。npm の `pagefind` パッケージが使うバイナリに日本語の分かち書きが含まれるかを P1-08 で確認し、結果を [11](11-open-decisions.md) の決定ログに書く。
- ブラウザ側では `pagefind.js` を動的 `import()` し、`await pagefind.options({ baseUrl: BASE_PATH })` を指定してから検索する。結果の URL がベースパスを含むことを E2E テストで確認する。
- Pagefind の標準 UI は使わず、§2.3.4 の検索 UI を `src/scripts/search/` に自前で作る。
- 検索品質は `tests/search/queries.json` で確認する（[10](10-testing-and-acceptance.md) §10.4）。

## 3.7 サイト用データ（site-data）

`scripts/build/site-data.ts` は、`data/` を読み、公開してよい項目だけを表示用の形に整えて `.generated/site-data/` に書く。根拠の抜粋（`quote`）、内部メモ、`state/` の内容は含めない。

| ファイル | 内容 |
| - | - |
| `games.json` | 公開中の作品の表示用モデル（`SiteGame[]`） |
| `redirects.json` | 統合済みの作品 ID と統合先（`[{ from, to }]`） |
| `articles.json` | 公開中の作品に関連づいた記事（`SiteArticle[]`） |
| `collections.json` | 公開中のコレクション（`SiteCollection[]`） |
| `tags.json` | 表示するタグ（core と、`candidateTagMinGames` 件以上の作品に付いた candidate） |
| `genres.json` | 主ジャンルの上位8件（カテゴリ色の割り当て） |
| `stats.json` | 作品数、記事数、最終更新日など |
| `meta.json` | 公開内容ハッシュ（`contentHash`）とその入力の内訳 |

`SiteGame` の型（`schema/site-data.ts`）は次のとおり。

```ts
export interface SourceRef {
  label: string;            // 媒体名。なければドメイン名
  url: string;
  kind: 'official' | 'store' | 'media' | 'database' | 'event';
  publishedAt?: string;     // ISO 8601
  checkedAt: string;        // 最後に確認した日時（公開内容ハッシュの計算から除く）
}

export interface SiteGame {
  id: string;               // g_000123
  path: string;             // /games/g_000123/（ベースパスを含まない）
  title: { display: string; original: string; originalLang: string };
  aliases: string[];        // 索引用。表示は主なものだけ
  developers: { id: string; name: string }[];
  publishers: { id: string; name: string }[];
  addedAt: string;          // YYYY-MM-DD（収録日）
  enrichedAt?: string;      // YYYY-MM-DD（04 §4.9）
  enrichedNote?: string;    // 例: 「発売日が更新」
  release: {
    overall: { status: ReleaseStatus; label: string; sortKey?: string };
    entries: {
      platform: Platform; region: Region; status: ReleaseStatus;
      date?: PartialDate; rawText?: string; label: string;
      sources: SourceRef[];
    }[];
    history: { platform: Platform; label: string; asOf: string; sources: SourceRef[] }[];
  };
  platforms: Platform[];
  japaneseSupport: null | {
    interface: Support; subtitles: Support; audio: Support;
    platform?: Platform; sources: SourceRef[];
  };
  playerModes: null | { modes: PlayerMode[]; minPlayers?: number; maxPlayers?: number; sources: SourceRef[] };
  summary: null | { text: string; sources: SourceRef[] };
  features: null | { items: string[]; sources: SourceRef[] };
  tags: { id: string; label: string; group: TagGroup }[];
  stores: { store: Store; url: string; platform?: Platform }[];
  officialUrl?: string;
  image?: { url: string; width?: number; height?: number; alt: string; credit?: string };
  palette?: string[];       // #rrggbb を3色
  articles: { id: string; role: ArticleRole }[];   // 詳細は articles.json から引く
  related: { gameId: string; kind: RelationKind; reason: string }[];
  collections: string[];    // コレクション ID
  coverage: { articleCount: number; filledFields: number };
}
```

`ReleaseStatus`、`Platform`、`Region`、`Support`、`PlayerMode`、`Store`、`TagGroup`、`ArticleRole`、`RelationKind`、`PartialDate` は [04-data-model.md](04-data-model.md) で定義する。

## 3.8 保存範囲

| 対象 | Git に入れるか | 理由・補足 |
| - | - | - |
| `data/`、`state/`、`config/` | 入れる | 1作品などの単位に分割し、変更した分だけが差分になるようにする |
| 根拠の短い抜粋（200字以内） | 入れる（`evidence.storeQuotes` で無効にできる） | 公開サイトには出さない。リポジトリを公開する場合は誰でも読めることを前提にする |
| 記事の本文、取得した HTML | 入れない | 調査ジョブの成果物（artifact）に一時的に置き、3日で消える設定にする |
| 検索索引、ビルド結果、`.generated/` | 入れない | 生成物 |
| 画像と動画 | 記事の OGP 画像だけを入れる | 記事の OGP 画像は幅720px の WebP に縮小し、`public/media/articles/` に置く（1件30KB程度）。作品の画像は外部の URL を参照する（[05](05-sources-and-editorial-policy.md) §5.4）。その他はプレースホルダー画像、アイコン、フォントだけ |
| LLM のやり取りの全文ログ | 入れない | 成果物に一時的に置く。Git には実行の要約（`state/runs/`）だけを残す |
| Secrets | 入れない | GitHub Actions の Secrets だけで扱う |

リポジトリを公開する場合は、`data/` と `state/` も公開されることを前提にする。`state/` には外部に知られて困る情報（API キー、個人の連絡先、未公開の内部判断のメモ）を書かない。

## 3.9 データ量が増えたときの方針

次のいずれかに当てはまったら、移行を検討する。

- `data/` と `state/` の合計が 200MB を超えた
- `npm run build` が GitHub Actions 上で10分を超えた
- 公開サイトの成果物が 500MB を超えた（GitHub Pages の上限は 1GB。[08](08-hosting-and-migration.md) §8.6）

移行の順番は次のとおり。

1. 記事の履歴、古い実行記録、大きな素材をオブジェクトストレージへ移す。
2. 必要になったら DB を導入する。その場合も `scripts/build/site-data.ts` が DB から `.generated/site-data/` を作る構造を保ち、`src/` 側は変えない。

最初から特定のホストの DB 構造に依存させない。

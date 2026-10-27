# 07 ワークフローと運用

## 7.1 ワークフローの一覧

| ファイル | 起動条件 | 内容 |
| - | - | - |
| `.github/workflows/update.yml` | 毎日の定期実行、手動実行、`main` へのサイトコードとデータの push | research → adopt → build → deploy |
| `.github/workflows/ci.yml` | pull request、`main` への push | 型、データ、単体テスト、2種類のベースパスでのビルドと E2E |
| `.github/workflows/watchdog.yml` | 毎日の定期実行（update とは別の時刻） | 定期更新の最終成功時刻を確かめ、古ければ Issue で知らせる |

`main` への push では、update.yml は `publish-only` として動き、build と deploy だけを行う。採用ジョブが `GITHUB_TOKEN` で push したコミットは、GitHub の仕様により新しいワークフローを起動しない。そのため、定期更新ではコミット後に別のワークフローを待たず、同じ実行の中で build と deploy に進む。

## 7.2 `update.yml`

アクションのバージョンは、実装時点の最新のメジャーバージョンを確認し、コミット SHA で固定する（下の例ではタグで書いている）。

```yaml
name: update

on:
  schedule:
    - cron: '17 9 * * *'
      timezone: 'Asia/Tokyo'
  workflow_dispatch:
    inputs:
      mode:
        description: 'full / collect-only / publish-only'
        type: choice
        options: [full, collect-only, publish-only]
        default: full
      force_deploy:
        description: '公開内容が同じでもデプロイする'
        type: boolean
        default: false
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'public/**'
      - 'schema/**'
      - 'data/**'
      - 'scripts/build/**'
      - 'astro.config.mjs'
      - 'package-lock.json'

concurrency:
  group: site-update-and-publish
  cancel-in-progress: false

permissions: {}   # 既定は権限なし。ジョブごとに必要な分だけ付与する

jobs:
  research:
    if: ${{ github.ref == 'refs/heads/main' && github.event_name != 'push' && inputs.mode != 'publish-only' }}
    runs-on: ubuntu-latest
    timeout-minutes: 25
    environment: research          # OPENCODE_API_KEY はこの環境のシークレットにする（§7.9）
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - name: Research
        env:
          OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}
          INDIEATLAS_LLM_ENABLED: ${{ vars.INDIEATLAS_LLM_ENABLED || 'true' }}
          RUN_ID: ${{ github.run_id }}
          RUN_ATTEMPT: ${{ github.run_attempt }}
          TRIGGER_COMMIT: ${{ github.sha }}
        run: npm run research -- --out out/ --mode "${{ inputs.mode || 'full' }}"
      - uses: actions/upload-artifact@v4
        if: ${{ always() }}
        with:
          name: research-${{ github.run_id }}-${{ github.run_attempt }}
          path: out/
          retention-days: 3
          if-no-files-found: ignore

  adopt:
    needs: research
    if: ${{ !cancelled() && github.ref == 'refs/heads/main' && github.event_name != 'push' && inputs.mode != 'publish-only' }}
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write
    outputs:
      data_commit: ${{ steps.adopt.outputs.data_commit }}
    steps:
      - uses: actions/checkout@v5
        with:
          ref: main
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - uses: actions/download-artifact@v5
        continue-on-error: true
        with:
          pattern: research-${{ github.run_id }}-*
          path: research-artifacts/
      - name: Adopt
        id: adopt
        env:
          RUN_ID: ${{ github.run_id }}
          RUN_ATTEMPT: ${{ github.run_attempt }}
          TRIGGER_COMMIT: ${{ github.sha }}
          SITE_URL: ${{ vars.SITE_URL }}
          BASE_PATH: ${{ vars.BASE_PATH }}
        run: |
          git config user.name 'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          npm run adopt -- --in research-artifacts/ --push

  build:
    needs: adopt
    if: ${{ !cancelled() && github.ref == 'refs/heads/main' }}
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
    outputs:
      should_deploy: ${{ steps.publish_check.outputs.should_deploy }}
      content_hash: ${{ steps.publish_check.outputs.content_hash }}
    env:
      SITE_URL: ${{ vars.SITE_URL }}
      BASE_PATH: ${{ vars.BASE_PATH }}
    steps:
      - uses: actions/checkout@v5
        with:
          ref: ${{ needs.adopt.outputs.data_commit || github.sha }}
          persist-credentials: false
      - id: source
        run: echo "commit=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run check:data
      - name: Build
        env:
          SOURCE_COMMIT: ${{ steps.source.outputs.commit }}
          TRIGGER_COMMIT: ${{ github.sha }}
          RUN_ID: ${{ github.run_id }}
          RUN_ATTEMPT: ${{ github.run_attempt }}
        run: npm run build
      - run: npm run check:dist
      - id: publish_check
        env:
          FORCE_DEPLOY: ${{ inputs.force_deploy || 'false' }}
        run: npm run check:publish
      - uses: actions/upload-pages-artifact@v4
        if: ${{ steps.publish_check.outputs.should_deploy == 'true' }}
        with:
          path: dist/

  deploy:
    needs: build
    if: ${{ !cancelled() && needs.build.outputs.should_deploy == 'true' }}
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

要点は次のとおり。

| 項目 | 内容 |
| - | - |
| 権限の分離 | research は `contents: read` だけで、checkout の認証情報も残さない（`persist-credentials: false`）。LLM の API キーは research だけが読める。adopt は `contents: write` を持つが、LLM のキーを持たない。deploy は `pages: write` と `id-token: write` だけを持つ |
| 実行の直列化 | `concurrency` の `site-update-and-publish` で、更新と公開の実行を直列にする。実行中のものは取り消さない |
| 固定したコミットのビルド | build は adopt が出力した `data_commit`（adopt を行わない場合は `github.sha`）を1回だけ checkout し、その SHA を `SOURCE_COMMIT` として manifest に記録する。途中で最新のブランチを取り直さない。deploy は、build が検証して upload した成果物をそのまま公開する |
| 失敗しても公開を試みる | adopt が失敗しても、build は `!cancelled()` で動く。そのときは起動時のコミットをビルドする。前回のデプロイが失敗していれば、ここで再公開される（§7.6） |
| `main` 以外での手動実行 | `github.ref == 'refs/heads/main'` の条件で、research、adopt、build を行わない |

定期実行の時刻（日本時間 9時17分 = UTC 0時17分）は、OpenCode Go のオフピーク（[06](06-update-pipeline.md) §6.9.3）に収まるように選んでいる。GitHub Actions の定期実行は混雑時に遅れることがあり、UTC 1時（日本時間10時）を過ぎた平日の呼び出しはピークの単価になる。

既知の制約: GitHub Actions の `concurrency` では、同じグループで待機中の実行は1つだけになり、新しい実行が来ると待機中の古い実行は取り消される。定期更新が待機している間に `main` への push が2回続くと、定期更新が取り消される場合がある。その日の調査は行われず、翌日の実行で続きを扱う。最終成功時刻の監視（§7.8）で気づけるようにする。

## 7.3 `ci.yml`

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v5
        with: { persist-credentials: false }
      - uses: actions/setup-node@v5
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm run check:types
      - run: npm run check:data
      - run: npm test

  site:
    needs: verify
    runs-on: ubuntu-latest
    timeout-minutes: 20
    strategy:
      matrix:
        base_path: ['/indieatlas/', '/']
    env:
      SITE_URL: https://example.github.io
      BASE_PATH: ${{ matrix.base_path }}
      INDIEATLAS_ROOT: tests/fixtures/repo   # 決定的な結果にするため、架空のデータでビルドする
    steps:
      - uses: actions/checkout@v5
        with: { persist-credentials: false }
      - uses: actions/setup-node@v5
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium webkit
      - run: npm run build
      - run: npm run check:dist
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: ${{ failure() }}
        with:
          name: playwright-report-${{ strategy.job-index }}
          path: playwright-report/
          retention-days: 7
```

CI では LLM と外部サイトを呼ばない。`npm test` は Fake のアダプタとフィクスチャだけを使う。

Lighthouse の計測（[02](02-ux-and-design.md) §2.8）は、第1段階では別のジョブで警告として出し、第5段階で合否の条件にする。

## 7.4 `build-manifest.json` と公開内容ハッシュ

### 7.4.1 公開内容ハッシュ（`scripts/build/content-hash.ts`）

公開に影響する入力だけからハッシュを計算する。運用上の確認時刻だけが変わった場合は、公開内容の変更として数えない。

```
contentHash = "sha256:" + sha256(canonicalJson({
  schemaVersion: 1,
  siteData: sha256(canonicalJson(.generated/site-data/ の全ファイル。揮発する項目を除く)),
  code: {
    "src": git のツリーハッシュ,
    "public": git のツリーハッシュ,
    "schema": git のツリーハッシュ,
    "scripts/build": git のツリーハッシュ,
    "astro.config.mjs": git のブロブハッシュ,
    "package-lock.json": git のブロブハッシュ
  },
  env: { SITE_URL, BASE_PATH }
}))
```

- 揮発する項目は、`schema/site-data.ts` の `VOLATILE_KEYS`（`checkedAt`、`lastCheckedAt`、`builtAt`、`generatedAt`）とする。ハッシュを計算するときに、どの深さにあるかを問わず、このキーを取り除く。
- ツリーハッシュは `git rev-parse {SOURCE_COMMIT}:{path}` で得る。作業ツリーに未コミットの変更があるとき（手元での実行）は、ファイルの内容から計算する。

### 7.4.2 manifest の形式

`scripts/run/finalize-dist.ts` が `dist/build-manifest.json` を書く。公開サイトの `{SITE_URL}{BASE_PATH}build-manifest.json` で読める。

```json
{
  "schemaVersion": 1,
  "site": "Indie Atlas",
  "contentHash": "sha256:4c1f…",
  "hashInputs": { "siteData": "sha256:9ab2…", "code": { "src": "1f3e…", "public": "77c0…" } },
  "sourceCommit": "3e5d…（ビルドしたデータとコードのコミット）",
  "triggerCommit": "a91c…（ワークフローを起動した時点のコミット）",
  "runId": "19533107",
  "runAttempt": 1,
  "workflow": "update",
  "builtAt": "2026-10-27T00:40:12Z",
  "siteUrl": "https://owner.github.io",
  "basePath": "/indieatlas/",
  "counts": { "games": 50, "articles": 132, "collections": 6 },
  "distBytes": 18432211
}
```

`sourceCommit` と `triggerCommit` は異なることがある。定期更新では、起動した時点のコミットの後に、採用ジョブがデータのコミットを作るためである。実際にビルドした内容は `sourceCommit` で特定する。

## 7.5 公開前の検証（`npm run check:dist`）

`scripts/build/dist-checks.ts` は次を確かめ、1つでも失敗したら終了コード1で終わる。

| 番号 | 内容 |
| - | - |
| B-01 | 必要なファイルがある: `index.html`、`games/index.html`、`404.html`、`build-manifest.json`、`atlas.json`、`pagefind/pagefind.js`、`sitemap-index.xml`、`robots.txt` |
| B-02 | 公開中のすべての作品に詳細ページがあり、統合済みの作品 ID には転送ページがある |
| B-03 | すべての HTML の内部リンク（`href`、`src`、`srcset`）が、`BASE_PATH` で始まり、`dist/` 内のファイルに解決できる。`BASE_PATH` が `/` 以外のとき、`BASE_PATH` を含まない `/` 始まりのリンクがあれば失敗にする |
| B-04 | canonical、OGP の URL、sitemap の URL が `SITE_URL` と `BASE_PATH` で始まる |
| B-05 | すべての HTML に `<html lang="ja">` と `<title>` がある |
| B-06 | 公開してはならない内容がない: `quote`、`quoteHash`、`identityEvidence`、`disambiguation` というキーを含む JSON。機密情報らしい文字列（[04](04-data-model.md) §4.10 の D-14 と同じ規則） |
| B-07 | 成果物の大きさ: 合計 500MB で警告、800MB で失敗。1ファイル 50MB で失敗（GitHub Pages の上限は [08](08-hosting-and-migration.md) §8.6） |
| B-08 | `build-manifest.json` がスキーマに合い、`contentHash` が `.generated/site-data/meta.json` と一致する |

## 7.6 公開の判定（`npm run check:publish`）

`scripts/run/check-publish.ts` は次の順に判定し、`GITHUB_OUTPUT` に `should_deploy`、`reason`、`content_hash` を書く。

1. `FORCE_DEPLOY=true` なら、デプロイする（`reason: forced`）。
2. `{SITE_URL}{BASE_PATH}build-manifest.json?t={現在のミリ秒}` を、10秒のタイムアウトで取得する（失敗したら2回まで再試行する）。
3. 取得でき、`contentHash` が今回のビルドと同じなら、デプロイしない（`reason: unchanged`）。
4. 404 なら、デプロイする（`reason: not-deployed`）。
5. それ以外（タイムアウト、形式の誤り、5xx など）なら、デプロイする（`reason: unknown-remote`）。

新しく取得したデータの有無ではなく、公開中の内容との比較で判定する。デプロイが失敗した後は、公開中の manifest が古いままなので、新しいデータがなくても次の実行でデプロイされる。

## 7.7 状態管理と失敗時の動作

取り込み済みの状態（`data/`、`state/`）と公開済みの状態（公開中の `build-manifest.json`）を分けて管理する。

| 状況 | 動作 | 実装の場所 |
| - | - | - |
| 1つの情報源の取得に失敗した | 失敗を記録し、その情報源の処理位置を進めない。`consecutiveFailures` を1増やし、2回目以降は `nextAttemptAfter` を `min(2^(n-2), 7)` 日後にする。5回続けて失敗したら、実行の記録の `pending` に書く。他の情報源の処理は続ける | `collect.ts`、adopt の手順10 |
| 1つの項目に矛盾がある | その項目を保留（`conflicted`）にし、確認済みの値を維持する。`fix-conflict` タスクを作る | `resolve.ts` |
| 公開内容に変化がない | 処理状況（タスク、実行の記録、費用）を保存して正常に終える。ビルドはするが、公開内容ハッシュが同じなのでデプロイしない | adopt、`check-publish.ts` |
| データを保存した後にビルドが失敗した | 公開中のサイトはそのまま残る。次の実行で、保存済みのデータを含む HEAD からビルドし直す | ワークフロー |
| ビルドの後にデプロイが失敗した | 次の実行で、新しいデータがなくても、公開中の manifest と内容が異なるのでデプロイする | `check-publish.ts` |
| 実行時間か費用の上限に達した | 途中までの結果を出力し、採用ジョブが保存する。残りのタスクは `deferred` として次回に回す | `budget.ts`、`execute.ts` |
| 調査ジョブが異常終了した | `if: always()` で出力を成果物にする。採用ジョブは、終わったタスクの結果と費用を保存する | update.yml、`adopt.ts` |
| 採用ジョブの検証（check:data）に失敗した | 何もコミットせずに失敗する。処理位置は進まないので、次の実行で同じ項目を扱い直す。build は起動時のコミットで動き、必要なら再公開する | `adopt.ts` |
| 再実行や取得の重複 | 記事 URL、作品 ID、Claim の内容ハッシュ、タスクの ID で二重登録を防ぐ。採用ジョブは同じ調査結果を2回反映しない | ID の規則、adopt の手順1 |
| コミットが競合した | 強制 push はしない。最新の状態を読み直して再評価する（3回まで）。3回とも失敗したら、ジョブを失敗させる | `adopt.ts` |
| 定期実行が遅れた、飛ばされた | 次の実行で通常どおり続ける。期限の判定は日時で行い、「毎日必ず実行される」ことを前提にしない | 全体 |
| LLM の API に障害がある | 呼び出しの失敗したタスクを `failed` か `deferred` にする。collect の結果は保存する | `opencode-go.ts`、`execute.ts` |
| OpenCode Go のプランの利用上限に達した | 残りのタスクを `deferred` にして終える（`stopReason: 'provider-limit'`）。次の実行で続きを扱う | `opencode-go.ts`、`budget.ts` |

各実行の終わりに、追加した作品、更新した項目、関連づけた記事、コレクションの変化、保留事項、費用、公開の状態を `state/runs/YYYY-MM.json` に記録する（[04](04-data-model.md) §4.8.5）。同じ内容を、GitHub Actions のジョブの要約（`$GITHUB_STEP_SUMMARY`）にも Markdown で書く。

## 7.8 監視

| 対象 | 方法 |
| - | - |
| 実行の失敗 | GitHub の通知（ワークフローの失敗をリポジトリの管理者にメールで知らせる設定）を使う |
| 定期更新の最終成功時刻 | `watchdog.yml` が毎日、`gh run list --workflow update.yml --branch main --status success --limit 1` で最後の成功を調べる。36時間より古ければ、ラベル `ops-alert` の Issue を作る（すでに開いていればコメントを足す） |
| 公開サイトの稼働 | 外部の死活監視サービスで、`{SITE_URL}{BASE_PATH}` と `build-manifest.json` を監視する（任意） |
| 費用 | 実行の記録の `cost` と `state/usage/` の月の合計。月の上限（`budget.monthlyLimit`）の80%を超えたら、ジョブの要約に警告を出す。正確な利用額は OpenCode のコンソールで、月に1回確かめる |

`watchdog.yml` の権限は `actions: read` と `issues: write` だけにする。

公開リポジトリでは、60日間活動がないと定期実行が無効になる。bot のコミットが活動として扱われない可能性があり、watchdog も同時に止まる。運用の手順として、月に1回以上、人がリポジトリにコミットするか、ワークフローを手動で実行する。

## 7.9 リポジトリの設定

最初に1回だけ行う。手順は P1-12 と P3-01 で実施し、結果を [11](11-open-decisions.md) の決定ログに書く。

| 設定 | 値 |
| - | - |
| Pages の公開元 | Settings → Pages → Source を「GitHub Actions」にする |
| ワークフローの既定の権限 | Settings → Actions → General → Workflow permissions を「Read repository contents and packages permissions」にする。書き込みはジョブごとに付与する |
| 環境 `research` | `OPENCODE_API_KEY` をこの環境のシークレットにする。デプロイできるブランチを `main` に限る |
| 環境 `github-pages` | デプロイできるブランチを `main` に限る |
| Variables | `SITE_URL`（例: `https://owner.github.io`）、`BASE_PATH`（例: `/indieatlas/`）、`INDIEATLAS_LLM_ENABLED`（`true`） |
| `main` のルール | 強制 push と削除を禁止する。採用ジョブが直接 push するため、PR の必須化は行わない（人の変更は PR で行う運用にする） |
| CODEOWNERS | `config/`、`.github/`、`schema/`、`scripts/pipeline/validate/`、`.claude/skills/`、`AGENTS.md`、`CLAUDE.md` に運営者を指定する |
| OpenCode Go | OpenCode のコンソールで Go（または Go Plus）を契約し、API キーを発行する。プライバシーの設定の Regions で **Global** を選ぶ（DeepSeek のモデルを使う条件）。「学習にリクエストを使う有料のエンドポイント」は許可しないままにする。**Extra Usage は無効にする**（利用上限を超えた分が従量課金にならないようにする）。Go のワークスペースはメンバーを招待できない。運営者が自分の開発にも同じワークスペースを使う場合は、利用上限を共有することになるため、`budget.monthlyLimit` を低めにするか、Indie Atlas 専用のワークスペースを作る（[11](11-open-decisions.md) D-20） |

`GITHUB_TOKEN` は `.github/workflows/` の変更を push できない（`workflows` の権限がない）。採用ジョブの V-P01 と合わせ、調査の結果がワークフローや検証ルールを変更できない構成にする。

## 7.10 運用の手順

| 場面 | 手順 |
| - | - |
| LLM だけを止める | Variables の `INDIEATLAS_LLM_ENABLED` を `false` にする。収集と公開は続く |
| すべてを止める | Actions の画面で update ワークフローを無効にする |
| 手動で更新する | Actions → update → Run workflow で `full` を選ぶ |
| 公開だけをやり直す | `publish-only` を選び、必要なら `force_deploy` を有効にする |
| レビュー待ちを処理する | `state/review-queue.json` の項目の `status` を `accepted` か `rejected` にする PR を作る。次の実行で反映される |
| 情報の訂正依頼に対応する | 誤った Claim の `status` を `retracted`、`statusReason` を `retracted-by-human` にする PR を作る。調査が必要なら、`fix-reported-error` タスクを `state/tasks.json` に追加する |
| 掲載の停止依頼に対応する | 作品の `status` を `hidden` にし、`statusReason` を書く PR を作る |
| 情報源を追加する | 利用条件を確認し、`config/sources.json` に `rights` を書いて PR を作る |
| 設定を変える | `config/runtime.json` を PR で変更する。`check:data` がスキーマを検証する |
| 手動でデータを集める、ページを作る | コーディングエージェントで、スキル（`ia-add-game`、`ia-collect`、`ia-link-article`、`ia-edit-collection`、`ia-fix-data`、`ia-add-source`）を使う。結果を確かめてから PR にする（[12](12-agent-skills.md)） |

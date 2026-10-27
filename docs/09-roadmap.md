# 09 段階的な実装

## 9.1 段階の概要

| 段階 | 実装するもの | 完了の目安 |
| - | - | - |
| 第1段階 | 初期の作品データ、作品一覧、作品詳細、記事へのリンク、静的な検索、背景の WebGL、Pages での公開 | 人が整えたデータで、サイトを一通り閲覧できる |
| 第2段階 | 情報源の取得、LLM による抽出、作品の同定、根拠の保存、重複の防止 | 手元の実行で、記事から作品の登録または補完まで進む |
| 第3段階 | 定期実行、コミット、ビルド、公開、失敗後の再開 | 人が起動しなくても、更新と公開が続く |
| 第4段階 | 未完了の課題の選択、追加の調査、関連作品、コレクションの改善 | 毎回の仕事が、サイトの状態に応じて変わる |
| 第5段階 | 試行期間の評価、必要な UI の改善、独自ドメインと別ホストへの移行 | 発見の体験と運用に手応えがある |

各チケットは、完了の確認がすべて通ったら完了とする。チケットごとにコミットを分け、関係する文書を更新する。

## 9.2 第1段階: 閲覧できる土台

| ID | 内容 | 完了の確認 |
| - | - | - |
| P1-01 | リポジトリの初期化。Astro、TypeScript（strict）、`tsx`、Zod、Vitest、Playwright、Prettier を入れる。[03](03-architecture.md) §3.2 のディレクトリと、§3.4 の npm scripts（中身が未実装のものは「未実装」と出して終了コード1で終わる）を用意する。`.nvmrc`、`.gitignore`、`tsconfig.json` のパスの別名を設定する | `npm ci && npm run check:types && npm test` が通る |
| P1-02 | `schema/` に [04](04-data-model.md) のスキーマを実装する。`scripts/lib/` に `repo-io`（`writeJson`、`readJson`、並び順）、`ids`、`hash`、`canonicalJson`、`text-normalize`、`partial-date`、`clock` を実装する | 各関数の単体テスト。特に `canonicalJson`、`normalizeTitle`、`PartialDate` の `startOf`、`endOf`、`format`、`hasPassed` |
| P1-03 | `npm run check:data`（[04](04-data-model.md) §4.10 の D-01〜D-14） | `tests/fixtures/repo/` の正しいデータで通り、各ルールに違反するデータの組で、該当するエラーが出る |
| P1-04 | 初期データを作る。(1) `core` のタグを40〜60個。(2) `npm run seed:steam -- --app {id}` を実装する（Steam の作品詳細から candidate の作品、開発者、`release`、`japaneseSupport`、`storeLink`、`image` の Claim を作る。LLM は使わない）。(3) 人が出典を確認した実在の作品を、まず10件、最終的に50件程度登録し、概要、特徴、タグを人が書く。(4) コレクションを4〜6個作る。確認用の作品の条件は [10](10-testing-and-acceptance.md) §10.5.2 | `check:data` が通る。50件のうち、同名作品、別名のある作品、体験版のある作品、複数機種の発売予定、延期の履歴、複数の作品を扱う記事が、それぞれ1件以上含まれる |
| P1-05 | `npm run prepare-site`: `data/` から `.generated/site-data/` を作る（[03](03-architecture.md) §3.7）。この段階では、採用済みの Claim をそのまま使う。派生値（[04](04-data-model.md) §4.9）と公開内容ハッシュ（[07](07-workflows-and-operations.md) §7.4.1）を計算する | 単体テスト: 揮発する項目だけを変えてもハッシュが変わらない。表示に関わる項目を変えるとハッシュが変わる。根拠の抜粋がサイト用データに含まれない |
| P1-06 | デザインシステム（[02](02-ux-and-design.md) §2.6）。`tokens.css`、`base.css`、フォントのサブセット、ライトとダークの切り替え、共通部品 | 部品を並べた確認用のページ（`/dev/components/`。本番のビルドには含めない）で、両方のテーマを目視で確認する。主要な文字色の組み合わせのコントラスト比をテストで確かめる |
| P1-07 | ページ: ホーム、作品一覧（静的な一覧とページ送り）、作品詳細、記事一覧（種別のタブ付き）、コレクション一覧と詳細、運営説明、404、統合済みの作品の転送ページ（[02](02-ux-and-design.md) §2.2〜§2.4） | `npm run build` が通る。E2E で各ページが表示され、「不明」の表示と出典のリンクがある |
| P1-08 | 検索: Pagefind の属性（[03](03-architecture.md) §3.6）、検索 UI（入力、フィルター、並び順、URL との同期、0件のときの表示）。日本語の分かち書きが使えるかを確認し、決定ログに書く | `tests/search/queries.json` の確認がすべて通る（[10](10-testing-and-acceptance.md) §10.4） |
| P1-09 | 背景の WebGL（ステージ）と、ホームの最新情報のカルーセル（[02](02-ux-and-design.md) §2.3.2、§2.7）。2026-10-28 にアトラス v1 から変更 | E2E: キャンバスが1つだけで操作を妨げない。WebGL を無効にした環境で CSS の背景になる。カルーセルを切り替えられ、reduced motion では自動再生しない |
| P1-10 | URL とクローラー向けの出力: `urls.ts`、sitemap、robots.txt、canonical、OGP、JSON-LD、生のリンクを禁じるテスト（[08](08-hosting-and-migration.md) §8.2、§8.3） | `tests/unit/no-raw-links.test.ts` が通る。2種類のベースパスでビルドした結果の canonical が正しい |
| P1-11 | `finalize-dist`（manifest）、`check:dist`（B-01〜B-08）、`check:publish`（[07](07-workflows-and-operations.md) §7.4〜§7.6） | 単体テスト: 公開中の manifest と同じなら `should_deploy=false`、404 やタイムアウトなら `true` |
| P1-12 | ワークフロー: `ci.yml` と、build と deploy だけの `update.yml`（`push` と `workflow_dispatch` で起動。定期実行と research、adopt は P3-01 で加える）。GitHub Pages の設定（[07](07-workflows-and-operations.md) §7.9）。リポジトリの公開範囲とプランで Pages を使えるか確認する | `main` への push でサイトが公開され、2回目の push（内容の変更なし）でデプロイが省略される |
| P1-13 | E2E とアクセシビリティ: スマートフォンの画面幅で検索から作品詳細、ストアのリンクまでたどるテスト、axe による検査、Lighthouse の計測（警告） | 受入基準9と10のテストが通る。axe の serious と critical の違反がない |

## 9.3 第2段階: 情報の取り込み

| ID | 内容 | 完了の確認 |
| - | - | - |
| P2-01 | Fetcher（[05](05-sources-and-editorial-policy.md) §5.4.3）: robots.txt、ホストごとの間隔、大きさと形式の制限、SSRF の防止、リダイレクト、本文の抽出、機械学習の利用を拒否する表示の検出、取得ログ。テスト用の Fake の Fetcher（`tests/fixtures/web/` を返す） | 単体テスト: プライベート IP へのリダイレクトを拒否する。robots.txt で禁止されたパスを取得しない。`noai` のページの本文を返さない |
| P2-02 | 情報源のアダプタ（`rss`、`atom`、`sitemap`、`html-list`、`steam`）と `config/sources.json`。[05](05-sources-and-editorial-policy.md) §5.3 の候補について、取得方法と利用条件を人と一緒に確認し、`rights` に記録する。Steam の、内容に関する記述子の ID を確認する | 各アダプタのフィクスチャを使った単体テスト。確認済みの情報源が5件以上 `enabled: true` になっている |
| P2-03 | URL の正規化、`state/seen-urls.json`、記事 ID（[04](04-data-model.md) §4.2.2、§4.8.3） | 単体テスト: 追跡用のパラメーター付きの URL、`www.` の有無、AMP の URL が同じ ID になる |
| P2-04 | LLM の接続（[06](06-update-pipeline.md) §6.9）: `LlmClient`、OpenCode Go のアダプタ、Fake のアダプタ、利用額の計算 | Fake を使った単体テスト。OpenCode Go のアダプタは、手元で `INDIEATLAS_LLM=opencode-go` にした短い確認用のスクリプト（`scripts/dev/llm-smoke.ts`）で、§6.9 の「要確認」の項目をすべて確かめる: 認証の方式、`x-opencode-session` の受け付け、思考モードの切り替え（`thinking`、`reasoning_effort`）、ツールの呼び出しと `reasoning_content` を含む履歴、`response_format: json_object`、usage のキャッシュのトークン数の項目、利用上限に達したときの応答。結果を §6.9 と決定ログに書く |
| P2-05 | ツール: `fetch_url`、`find_games`、`get_game`、`get_steam_app`、`submit_result`（[06](06-update-pipeline.md) §6.5.3） | 単体テスト: 上限の回数で止まる。外部の文章が `<external_content>` で囲まれ、閉じタグが無害化される |
| P2-06 | 提案のスキーマ（`schema/proposal.ts`）と検証ルール V-S、V-E、V-C、V-I、V-L（[06](06-update-pipeline.md) §6.7） | ルールごとに、通る例と却下される例の単体テストがある |
| P2-07 | 反映と採用: `identity.ts`（[04](04-data-model.md) §4.3）、`apply.ts`、`resolve.ts`（[06](06-update-pipeline.md) §6.8）、`publish-rules.ts`（[05](05-sources-and-editorial-policy.md) §5.5） | 受入基準3〜6のテスト（[10](10-testing-and-acceptance.md) §10.3） |
| P2-08 | `collect`、`triage`、`process-article` と `register-game` の実行、プロンプト（`base.md`、`execute.md` の該当する節） | 統合テスト: Fake の LLM と Fetcher で、記事から既存作品への関連づけ、新規作品の登録、Claim の追加まで通る |
| P2-09 | 手元での通し実行: `npm run research -- --out out/ --llm opencode-go --max-tasks 3` と `npm run adopt -- --in out/ --dry-run`（差分を表示し、書き込まない） | 実在の記事3件で、人が結果を確かめる |
| P2-10 | 小さな比較検証: 実在の記事10件と作品5件で、DeepSeek V4.1 Flash の設定（思考モードの有無、推論の深さ、本文の長さの上限）を比べ、品質（人の評価: 根拠の抜粋の正確さ、日本語の要約の質、同定の正しさ）、利用額、所要時間を記録する。検索なしで、不足の補完（`fill-missing`）がどこまで進むかも記録する。結果で役割ごとの設定と D-05（[11](11-open-decisions.md)）を決める。品質が足りない役割があれば、その役割だけ別のモデル（例: DeepSeek V4 Pro）にする案を利用者に示す | 比較の結果と決定を決定ログに書く |
| P2-11 | 手動の作業: `npm run ia` の CLI（[12](12-agent-skills.md) §12.2）、`ManualResult`、人の判断のコマンド、作品の統合の反映（[06](06-update-pipeline.md) §6.12）、`AGENTS.md` と `CLAUDE.md`、6つのスキルと `RULES.md`（§12.4〜§12.8） | [12](12-agent-skills.md) §12.9 のテストが通る。Claude Code と OpenCode の両方で `ia-add-game` を使い、実在の作品1件を登録できる |

第2段階の完了の確認: 受入基準1〜6のテストが通る。手元の実行で、記事から作品の登録または補完まで進む。

## 9.4 第3段階: 定期実行

| ID | 内容 | 完了の確認 |
| - | - | - |
| P3-01 | `update.yml` を完成させる（[07](07-workflows-and-operations.md) §7.2）: 定期実行、research、adopt、環境 `research` とシークレット、成果物の受け渡し | 手動実行（`full`）が最後まで通る |
| P3-02 | 採用ジョブのコミット: 差分の範囲の確認（V-P01）、push、競合時の読み直しと再評価、重複適用の防止（[06](06-update-pipeline.md) §6.11） | 統合テスト: 同じ成果物を2回反映しても、2回目は何も変わらない。push の競合を模したテストで、読み直して成功する |
| P3-03 | 予算: `budget.ts`、`state/usage/`、緊急停止の変数（[06](06-update-pipeline.md) §6.5.4） | 単体テスト: 月の残りが0なら LLM を呼ばない。1回の上限に達したら残りのタスクが `deferred` になる |
| P3-04 | 失敗時の動作（[07](07-workflows-and-operations.md) §7.7 の表）: 途中までの出力、情報源ごとの失敗とバックオフ、前回の公開状態の補完 | 受入基準7と8のテスト。表の各行に対応するテストか手順がある |
| P3-05 | 実行の記録とジョブの要約（[04](04-data-model.md) §4.8.5、[07](07-workflows-and-operations.md) §7.7） | 手動実行で `state/runs/` とジョブの要約が書かれる |
| P3-06 | 監視: `watchdog.yml`（[07](07-workflows-and-operations.md) §7.8） | 36時間以上の失敗を模して、Issue が作られる |
| P3-07 | 試運転: D-05（[11](11-open-decisions.md)）が決まっていることを確かめてから、手動実行を3回行い、結果を人が確かめる。問題がなければ定期実行を有効にする | 1週間、人が起動せずに更新と公開が続く |

定期実行を有効にする前に、費用の上限（D-05）を必ず確定する。

## 9.5 第4段階: 自律的な仕事の選択

| ID | 内容 | 完了の確認 |
| - | - | - |
| P4-01 | タスクの管理: R1 の定期的なタスクの生成、優先度の計算、baseline の選択と探索枠（[06](06-update-pipeline.md) §6.4） | 単体テスト: 段階の順序が加点で入れ替わらない。探索枠が確保される。同じ作品のタスクが上限を超えない |
| P4-02 | 計画: `plan.ts`（[06](06-update-pipeline.md) §6.5.2）。LLM の出力の検証と、失敗したときに baseline を使う動作 | 単体テスト: 段階1のタスクを外した出力が補正される |
| P4-03 | `check-change`、`fill-missing`、`refresh-game`、`fix-conflict`、`fix-duplicate` の実行とプロンプト | 統合テスト: 延期の告知から `supersedes` 付きの Claim が採用される。矛盾から `fix-conflict` が作られ、新しい公式の根拠で解消される |
| P4-04 | 関連作品: 候補の計算（タグの重なり）、`improve-relations`、作品詳細での表示 | 統合テスト: `similar-play` の条件を満たさない関係が却下される |
| P4-05 | コレクション: `improve-collection`、新しいコレクションの案、レビュー待ちへの投入と反映（[04](04-data-model.md) §4.8.4） | 統合テスト: `rules` を満たさない作品の追加が却下される。`accepted` にしたレビュー待ちが次の実行で反映される |
| P4-06 | 分類の見直し: `review-tags` の提案と反映 | 提案された分類の変更が人のレビューを経て反映される |
| P4-07 | 探索: `discover` の実行、報道の少ない作品の指標、ホームの「まだあまり知られていない作品」 | 実行の記録で、探索のタスクが毎回 `minTaskShare` 以上を占める |

第4段階の完了の確認: 実行の記録を1週間分並べたとき、選ばれたタスクの種類がサイトの状態（未解決の矛盾、不足の項目、新着の量）に応じて変わっている。

## 9.6 第5段階: 評価と移行

| ID | 内容 | 完了の確認 |
| - | - | - |
| P5-01 | 試行期間（2週間）の評価: `npm run report:trial` で指標を集計し、人の評価と合わせて報告書を作る（[10](10-testing-and-acceptance.md) §10.6） | 報告書を `docs/reports/trial-YYYY-MM-DD.md` に置く |
| P5-02 | UI の改善: 評価で見つかった問題の修正。Lighthouse の基準（[02](02-ux-and-design.md) §2.8）を CI の合否の条件にする | Lighthouse の基準を満たす |
| P5-03 | 独自ドメインと別ホストへの移行（[08](08-hosting-and-migration.md) §8.5） | 移行先で受入基準9のテストが通り、旧 URL の転送ページが動く |
| P5-04 | サイトコードの自動改善の設計（実装はしない）: 改善の課題の作成、変更の案、プレビュー、検証、限定的な公開、問題が起きたときに元へ戻す流れを、別の文書にまとめる。通常の調査ジョブが自分の権限や検証ルールを変える構成にしない | 設計の文書を `docs/` に置き、利用者が確認する |
| P5-05 | 訂正依頼の取り込み（任意）: ラベル `correction` の Issue から `fix-reported-error` タスクを作るワークフロー | Issue からタスクが作られる |

初期は、作品の発見と情報の更新に集中する。ユーザーアカウント、クラウド同期のお気に入り、会話型の検索、価格履歴の網羅は、利用状況を見てから追加する。

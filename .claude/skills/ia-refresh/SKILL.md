---
name: ia-refresh
description: Indie Atlas のサイトの内容をまとめて最新にする。作品の発売情報、IGDB の機種とスクリーンショット、Steam のレビュー数と評価、レビューの要約、媒体の新しい記事、催しの日程、記事の画像と反応、コレクションの候補を順に更新し、検証とビルドまで行う。「サイトの内容を全部最新にして」「データをまるっと更新して」「今週分の更新をまとめてやって」「ニュースとイベントと指標を最新にして」のような依頼で使う。作品を1件だけ登録する、記事を1件だけ関連づける、新しいコレクションを作るといった個別の依頼には使わない。
---

# サイトの内容をまとめて最新にする

最初に `.claude/skills/ia-common/RULES.md` を読み、その規則に従う。仕様は `docs/12-agent-skills.md` の §12.6.7 にある。各コマンドの動きは `docs/06-update-pipeline.md` §6.13 にある。

段階 A〜D は外部のサイトと API を読む。段階 C は利用者の確認を挟む。途中で止まっても、`npm run refresh:status` をもう一度実行すれば、残っている作業が分かる。

## 0. 準備

1. `git status --short` を実行する。`data/`、`state/`、`public/media/` に作業前からの変更があれば、利用者に伝え、混ぜてよいかを確かめる。
2. `node_modules/` がなければ `npm ci` を実行する。
3. セッション ID を `local-{YYYYMMDD}-{HHMMSS}-refresh`（日本時間）で決め、以降の `--run` と `createdByRun` に使う。作業用のファイルは `out/refresh/{セッション ID}/` に置く（Git の管理外）。
4. `npm run refresh:status > out/refresh/{セッション ID}/status-before.json` を実行し、内容を読む。
   - `keys.igdb` が `false` なら段階 A の `igdb:sync` を、`keys.llm` が `false` なら要約（`reviews:summarize`、`reactions:summarize`）を飛ばし、最後に利用者に伝える。キーの値を表示したり、ファイルに書いたりしない。
5. 利用者に、これから行う段階と、外部への取得のおおよその量（作品数、情報源の数、LLM の呼び出しの有無）を短く伝える。利用者が範囲を絞った場合は、その段階だけを行う。

## A. 作品の事実

1. `status-before.json` の `releases` のうち `steamAppId` のある作品について、Steam の作品情報を取り直す。
   `npm run seed:steam -- --by agent --run {セッション ID} --app {appId} [--app ...]`
   - 出力の注記（「開発者とパブリッシャーが異なる」など）を控えておく。
   - `git diff --stat -- data/` と、変わった `data/claims/*.json` の `superseded` になった Claim を確かめる。Steam より順位の高い根拠（公式の告知など。`docs/06-update-pipeline.md` §6.8）の Claim を Steam の古い情報で置き換えていたら、その作品の変更を利用者に示し、戻すかを決めてもらう。
   - 新しい開発者（`data/developers/` の新しいファイル）ができていたら、報告に含める。
2. `keys.igdb` が `true` なら `npm run igdb:sync -- --run {セッション ID}` を実行する（Steam 以外の機種の発売情報、スクリーンショット、ストアのリンク。採用済みの Claim は上書きしない）。
3. `npm run media:palettes` を実行する（ヘッダー画像が変わった作品と、新しい作品の色だけを作る）。
4. `releases` のうち `reason: "date-passed"` で、手順1〜2の後も予定日を過ぎた `upcoming` のまま残った機種（Steam 以外の機種など）を控え、段階 C の手順4で扱う。

## B. 指標と要約

1. `npm run metrics:popularity` を実行する。
2. `keys.llm` が `true` なら、Steam のレビューの要約を作る。`metrics.reviewSummaries.oldest` が28日より前なら `npm run reviews:summarize -- --force`、そうでなければ `npm run reviews:summarize`（まだない作品の分だけ）。定期実行（`.github/workflows/refresh-metrics.yml`）と同じく、4週ごとに作り直す扱いである。
3. 要約の変更から数件を選んで読み、`docs/05-sources-and-editorial-policy.md` §5.6.3 の使わない表現がないかを確かめる。あれば報告に含める（要約を手で直さない）。

## C. 判断の要る内容（利用者の確認を挟む）

この段階で書くデータは、`RULES.md` の「`npm run ia` が使えない間の扱い」に従って書く。書く前に、手順ごとに案を表にして利用者に示し、確認を得る。

1. **記事**: `status-before.json` の `sources` の `kind: "media"` の情報源ごとに、`feedUrl` のフィードを取得し、`latestPublishedAt` より新しい項目を集める。
   - インディーの作品を扱う項目だけを残す（収録の対象は `config/policy.md`）。ストアのお知らせ（Steam の告知）は記事にしない。
   - `npm run refresh:status -- --url {URL} [--url ...]` で、登録済み（`articleId` がある）か、以前に扱ったか（`seen`）を調べ、どちらかに当たるものは除く。
   - 残った項目のページを取得し、扱う作品を既存の作品から探して、扱い（`role`）を決める。形式は `docs/04-data-model.md` §4.6。ID は `articleId(canonicalUrl)`。タイトルは原文のまま。`summaryJa` は情報源の `rights.displaySummary` が `true` の場合だけ書く。
   - 記事ごとに `state/seen-urls.json` の項目（`status: "article"`）も加える（`docs/04-data-model.md` §4.8.3）。
   - 収録していない作品が主題の記事は、作品を登録するかを利用者に尋ねる。登録する場合は Steam の作品なら `npm run seed:steam -- --by agent --run {セッション ID} --app {appId}` で候補（candidate）として作る。公開（published）にするのは、公開条件（`docs/05-sources-and-editorial-policy.md` §5.5.1）を満たし、利用者が承認した場合だけ。
2. **催し**: `status-before.json` の `events` を理由ごとに扱う（`docs/06-update-pipeline.md` §6.13.1）。
   - `soon`、`recheck-due`、`tentative`: 案内のページ（`url`）を取得し、日程、時間、会場、状態（中止など）が変わっていないかを確かめる。変わっていれば根拠の抜粋とともに直し、`recheckAfter` を次に確かめる日にする。
   - `ended-no-next`: 主催者のページで次の回の告知を探す。告知があれば、新しい催しとして加える。
   - さらに、`sources` の `kind: "event"` の情報源の一覧のページを取得し、まだない催しを探す。
   - 開始日が変わると催しの ID（`eventId(url, 開始日)`）が変わる。新しい ID のファイルに書き、古いファイルを消す（`npm run check:data` の D-08 で確かめられる）。
   - 出展作品（`games`）には、既存の作品に同定できたものだけを入れる。
3. **作品の事実の残り**: 段階 A の手順4で控えた機種について、公式の告知、ストアのページ、手順1の記事から新しい発売情報を探す。見つかれば `makeClaim` で新しい `release` の Claim を作り、`supersede` で古い Claim を置き換える。見つからなければ変えずに報告する（推測で `released` にしない）。
4. **コレクション**: `gamesWithoutCollection` と、この作業で公開した作品について、既存のコレクションの `criteria` に合うものを探し、追加の案（作品、理由 20〜120字、理由を支える採用済みの Claim の ID）を示す（`docs/04-data-model.md` §4.7.1）。利用者が承認したものだけを加える。新しいコレクションは作らない（`docs/12-agent-skills.md` §12.6.4 の範囲）。
5. 書いた後に `npm run check:data` を実行する。

## D. 記事と催しに付随するもの

1. `npm run media:articles` と `npm run media:events` を実行する（画像を使ってよい情報源の、画像のない記事と催しだけ）。
2. `keys.llm` が `true` なら `npm run reactions:summarize` を実行する（掲載から14日以内の記事と、反応のまだない記事）。

## E. 検証とプレビュー

1. `npm run check:data` と `npm test` を実行する。失敗したら原因を直す。テスト、スキーマ、検証ルールを変えて通さない。
2. `npm run ranking:steam` を実行してから（売れ筋の欄の確認用。結果はコミットしない）、`npm run build` と `npm run check:dist` を実行する。
3. `npm run refresh:status > out/refresh/{セッション ID}/status-after.json` を実行し、`status-before.json` と比べる。残ったもの（取得に失敗した作品、要約できなかった記事など）は報告に含める。
4. 利用者が見たい場合は `npm run preview` を起動し、ホーム、記事一覧（`/articles/`）、カレンダー（`/events/`）、変わった作品の詳細（`/games/{gameId}/`）の URL を示す。

## F. 報告

`docs/12-agent-skills.md` §12.7 の形式で報告する。あわせて次を書く。

- 段階ごとに、実行したコマンドと結果（件数）、飛ばした段階とその理由
- `git diff --stat` の要約
- コミットを頼まれた場合の分け方の案。例: `data: refresh Steam release facts and IGDB platforms`、`data: refresh popularity metrics, review summaries, and article reactions`、`data: add N articles from M outlets`、`data: update event schedules`

コミットと push は、利用者に頼まれたときだけ行う。

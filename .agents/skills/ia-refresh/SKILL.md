---
name: ia-refresh
description: Indie Atlas のサイトの内容をまとめて最新にする。作品の発売情報、IGDB の機種とスクリーンショット、Steam のレビュー数と評価、レビューの要約、媒体の新しい記事、催しの日程、新しい作品の収録と公開、記事の画像と反応、コレクションの項目を順に更新し、検証とビルドまで行う。「サイトの内容を全部最新にして」「データをまるっと更新して」「今週分の更新をまとめてやって」「ニュースとイベントと指標を最新にして」のような依頼で使う。作品を1件だけ登録する、記事を1件だけ関連づける、新しいコレクションを作るといった個別の依頼には使わない。
---

# サイトの内容をまとめて最新にする

最初に `.agents/skills/ia-common/RULES.md` を読み、その規則に従う。仕様は `docs/12-agent-skills.md` の §12.6.7 にある。各コマンドの動きは `docs/06-update-pipeline.md` §6.13 にある。

何を載せるか、どの根拠で何を更新するか、作品を収録して公開するか、誤った情報を撤回するかまで、すべてエージェントが判断して進める（`RULES.md` の規則8）。利用者に選ばせたり、承認を求めたりしない。判断は、最後の報告に根拠とともに書く。

途中で止まっても、`npm run refresh:status` をもう一度実行すれば、残っている作業が分かる。

## 0. 準備

1. `git status --short` を実行する。`data/`、`state/`、`public/media/` に作業前からの変更があれば、混ざることを報告に書く。
2. `node_modules/` がなければ `npm ci` を実行する。
3. セッション ID を `local-{YYYYMMDD}-{HHMMSS}-refresh`（日本時間）で決め、以降の `--run` と `createdByRun` に使う。作業用のファイル（取得したページ、一時的なスクリプト）は `out/refresh/{セッション ID}/` に置く（Git の管理外）。取得したページと、それを読むスクリプトは別のディレクトリに置く。
4. `npm run refresh:status > out/refresh/{セッション ID}/status-before.json` を実行し、内容を読む。
   - `keys.igdb` が `false` なら `igdb:sync` を、`keys.llm` が `false` なら要約（`reviews:summarize`、`reactions:summarize`）を飛ばし、報告に書く。キーの値を表示したり、ファイルに書いたりしない。
5. これから行う段階を利用者に一言伝え、待たずに始める。利用者が範囲を絞っていれば、その段階だけを行う。

## A. 作品の事実

1. `status-before.json` の `releases` のうち、`steamAppId` のある作品の Steam の作品情報を取り直す。
   `npm run seed:steam -- --by agent --run {セッション ID} --app {appId} [--app ...]`
   - 出力の注記を控える。「開発者とパブリッシャーが異なる」は、`indie.reasons` に別の理由（インディーの賞やショーケース、小規模な開発元など。`docs/04-data-model.md` §4.4.3）があるかを確かめ、なければ根拠を探して加える。「期間限定の差し替え（header_alt_assets）」は、セールなどの間だけ差し替わったヘッダー画像を使わなかった（新しい作品では差し替えの前の画像を使った）という意味で、対応は要らない。
   - `superseded` になった Claim を `git diff -- data/claims/` で確かめる。Steam の新しい情報が、公式の告知（`official`）による、より新しい Claim を置き換えていたら、その作品の `data/claims/` の変更を戻し、報告に書く。順位の決まりは `docs/06-update-pipeline.md` §6.8。
   - 新しい開発者（`data/developers/` の新しいファイル）ができていたら、報告に書く。
2. `keys.igdb` が `true` なら `npm run igdb:sync -- --run {セッション ID}` を実行する。Steam 以外の機種の発売情報、スクリーンショット、ストアのリンクが入る。採用済みの Claim は上書きしない。
3. `npm run media:palettes` を実行する。ヘッダー画像が変わった作品と、新しい作品の色だけを作る。
4. `npm run claims:repoint` を実行する。Claim が置き換わると、その Claim を理由の根拠にしているコレクションの項目が `check:data` の D-09 で止まるので、置き換えた先の Claim に付け替える。
5. `releases` に残る作品のうち、`reason: "date-passed"` の作品と、Steam 以外の機種の予定（年や季節だけのものを含む）を控え、段階 C の手順3で扱う。

## B. 指標と要約

1. `npm run metrics:popularity` を実行する。
2. `keys.llm` が `true` なら、Steam のレビューの要約を作る。`metrics.reviewSummaries.oldest` が28日より前なら `npm run reviews:summarize -- --force`、そうでなければ `npm run reviews:summarize`（まだない作品の分だけ）を実行する。定期実行（`.github/workflows/refresh-metrics.yml`）と同じく、4週ごとに作り直す扱いである。発売前の作品は「レビューが10件に満たない」で飛ばされるが、それで正しい。
3. 変わった要約から数件を読み、`docs/05-sources-and-editorial-policy.md` §5.6.3 の使わない表現がないかを確かめる。あれば報告に書く。要約は手で直さない。

## C. 記事、催し、発売情報、コレクション

この段階のデータは、`RULES.md` の「`npm run ia` が使えない間の扱い」に従って、一時的なスクリプトで書く。スクリプトでは、根拠の `quote` が取得したページの本文に含まれることを確かめ、含まれなければ止める。

1. **記事**
   - `npm run refresh:feeds > out/refresh/{セッション ID}/feeds.json` を実行する。取得してよい媒体のフィードを読み、登録済みの最新の記事より新しく、まだ登録も処理もしていない項目を候補として出す。`gameIds` は、タイトルに収録作品の名前が含まれる候補である。`fetched` の `status` が 200 でない情報源（フィードの URL が変わったなど）は、報告に書く。
   - `gameIds` のある候補は、ページを取得して本文を読み、本当にその作品を扱っているかと扱い方（`role`。主題なら `primary`、一部で触れるなら `mention`、まとめ記事内の紹介なら `roundup`）を決める。名前の一部が偶然一致しただけの候補や、作品の名前が別の人や物を指している候補は除く。
   - `gameIds` のない候補も、タイトルを読んで、収録作品の別の表記（略称、日本語の題名）で扱っているものを探す。
   - まとめ記事（週間のまとめなど）に収録作品の記事へのリンクがあれば、リンク先の個別の記事も候補に加える。`npm run refresh:status -- --url {URL}` で登録済みでないことを確かめる。
   - 収録作品が主題でも、セールの告知、グッズ、ストアのお知らせ（Steam の告知）は記事にしない。
   - 形式は `docs/04-data-model.md` §4.6。ID は `articleId(canonicalUrl)`。タイトルは原文のまま（HTML の文字参照は戻す）。`publishedAt` はページの `article:published_time` か、フィードの日時を使う。`outlet` と `lang` は、同じ情報源の既存の記事に合わせる。`summaryJa` は、情報源の `rights.displaySummary` が `true` の場合だけ書く。
   - 記事ごとに、`state/seen-urls.json` の項目（`status: "article"`）も加える（`docs/04-data-model.md` §4.8.3）。
   - 収録していない作品が主題の記事は、手順5（新しい作品）で扱う。
2. **催し**: `status-before.json` の `events` を理由ごとに扱う（`docs/06-update-pipeline.md` §6.13.1）。
   - `soon`、`recheck-due`、`tentative`: 案内のページ（`url`）を取得し、日程、時間、会場、状態（中止など）が変わっていないかを確かめる。変わっていれば、根拠の抜粋とともに直す。
   - `ended-no-next`: 主催者のページで次の回の告知を探す。告知があれば、新しい催しとして加える。
   - `kind: "event"` の情報源の一覧のページも取得し、まだない催しを探す。Steam の予定表（`steam-upcoming-events`）にあるテーマ別のフェスとセールは、まだないものをすべて加える。
   - 確かめた催しには、次に確かめる日を `recheckAfter` に書く。開始の7日前より前なら開始の7日前、それを過ぎていれば開始日、日程が予定（`tentative`）なら1週間後、`ended-no-next` で次の回の告知がなければ1か月後にする。`refresh:status` は、`recheckAfter` が来るまで、その催しを挙げない。
   - 開始日が変わると催しの ID（`eventId(url, 開始日)`）が変わる。新しい ID のファイルに書き、古いファイルを消す（`npm run check:data` の D-08 で確かめられる）。
   - 出展作品（`games`）には、既存の作品に同定できたものだけを入れる。
3. **発売情報**: 段階 A の手順5で控えた作品と、手順1の記事で発売日の決定、延期、配信の終了などが分かった作品について、新しい発売情報を確かめる。
   - 公式の根拠（公式サイト、開発者の告知）を優先して探す。記事に公式の告知へのリンクがあれば、たどって取得する。媒体の記事（順位2）は、公式やストア（順位3）の Claim を置き換えられないためである（`docs/06-update-pipeline.md` §6.8）。媒体の記事は、IGDB（順位1）の Claim を置き換える場合と、公式の根拠に添える2件目の根拠に使う。
   - 機種ごとに `makeClaim` で新しい `release` の Claim を作り、`supersede` で同じ機種の採用済みの Claim を置き換える。公式の根拠なら `basis: "fact"`、媒体の記事だけなら `basis: "reported"` にし、独立した2つの媒体の記事を根拠にする（`originKey` が異なるもの）。
   - 配信の終了は `status: "delisted"` にし、そのストアへのリンク（`storeLink`）の Claim を `status: "retracted"`、`statusReason: "retracted-by-evidence"` にする。
   - 根拠が見つからなければ変えずに報告する。推測で `released` にしない。
4. **コレクション**: `gamesWithoutCollection` と、この作業で公開した作品について、公開中のコレクションの `criteria.rules` に合い、かつ `criteria.text` の趣旨にも合う作品を、既存のコレクションに加える。例えば、発売済みの作品の移植版が予定されているだけなら「早期アクセスと新作」には入れない。理由（20〜120字）は採用済みの紹介文（`summary`）などの Claim に基づいて書き、その Claim の ID を `evidenceClaimIds` に入れる（`docs/04-data-model.md` §4.7.1）。新しいコレクションは作らない（`docs/12-agent-skills.md` §12.6.4 の範囲）。
5. **新しい作品**: 手順1で見つけた、収録していないインディーの作品を登録する。複数の媒体が扱っている、収録作品と同じ層に向けた話題作など、収録する価値の高いものから、1回のセッションで10作品程度までにする。
   - 既存の作品にないことを、タイトル、別名、Steam の ID で確かめる（`RULES.md` の規則6）。
   - Steam の作品なら `npm run seed:steam -- --by agent --run {セッション ID} --app {appId}` で候補（candidate）として作る。Steam の ID は、ストアの検索（`https://store.steampowered.com/api/storesearch/?term={名前}&cc=jp&l=japanese`）で探す。
   - 紹介文（`summary`、60〜160字）とタグ（`data/taxonomy/tags.json` の既存のタグ）を、ストアの作品紹介を根拠に Claim として書く（`basis: "editorial"`）。インディーの理由がなければ根拠を探して加える。
   - 公開条件（`docs/05-sources-and-editorial-policy.md` §5.5.1 の P-1〜P-6。`scripts/pipeline/publish-rules.ts` の `canPublish`）を満たせば `status: "published"`、`addedAt` を今日にする。満たさなければ candidate のまま残し、足りない条件を報告する。
   - その作品を扱う記事も、手順1と同じ形式で登録する。
6. **レビュー待ちとタスク**: `counts.pendingReviews` や `counts.openTasks` があれば、`state/review-queue.json` と `state/tasks.json` の各項目を根拠に照らして判断し、反映する。
7. `npm run claims:repoint` と `npm run check:data` を実行する。

## D. 記事と催しに付随するもの

1. `npm run media:articles` と `npm run media:events` を実行する。画像を使ってよい情報源の、画像のない記事と催しだけが対象である。Steam の予定表のように OGP 画像のないページは「OGP 画像がない」になるが、対応は要らない。
2. `keys.llm` が `true` なら `npm run reactions:summarize` を実行する。掲載から14日以内の記事と、反応のまだない記事が対象である。`refresh:status` の `metrics.articleReactions.missing` には、はてなブックマークがまだない記事も含まれるので、残っていても問題ではない。

## E. 検証とプレビュー

1. `npm run check:data` と `npm test` を実行する。失敗したら原因を直す。テスト、スキーマ、検証ルールを変えて通さない。
2. `npm run ranking:steam`（売れ筋の欄の確認用。結果はコミットしない）、`npm run build`、`npm run check:dist` を実行する。
3. 変えた作品の詳細（`dist/games/{gameId}/index.html`）で、新しい発売情報や記事が出ていることを確かめる。
4. `npm run refresh:status > out/refresh/{セッション ID}/status-after.json` を実行し、`status-before.json` と比べる。残ったもの（取得に失敗した作品、要約できなかった記事など）は報告に書く。
5. 利用者が見たいと言えば `npm run preview` を起動し、ホーム、記事一覧（`/articles/`）、カレンダー（`/events/`）、変えた作品の詳細（`/games/{gameId}/`）の URL を示す。

## F. 報告

`docs/12-agent-skills.md` §12.7 の形式で報告する。あわせて次を書く。

- 段階ごとに、実行したコマンドと結果（件数）、飛ばした段階とその理由
- 判断したこと（載せなかった記事の種類、置き換えた発売情報とその根拠、加えたコレクションの項目）
- 判断の根拠を確かめきれず、変えずに残したもの（次の回で扱う）
- `git diff --stat` の要約
- コミットを頼まれた場合の分け方の案。例: `data: refresh Steam release facts and IGDB platforms`、`data: refresh popularity metrics, review summaries, and article reactions`、`data: add N articles from M outlets`、`data: update event schedules`

コミットと push は、利用者に頼まれたときだけ行う。

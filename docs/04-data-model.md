# 04 データモデル

この章のスキーマは Zod 4 の API で書いている。実装では `schema/` 以下にこのまま置き、必要な補助関数を加える。

## 4.1 共通の規約

### 4.1.1 ファイルの形式

- 文字コードは UTF-8、改行は LF、ファイルの末尾に改行を1つ置く。
- JSON は2スペースで字下げする。キーの順番は Zod スキーマの定義順とする。`scripts/lib/repo-io.ts` の `writeJson(schema, path, value)` が、`schema.parse(value)` の結果を `JSON.stringify(_, null, 2) + "\n"` で書く。書き込みは必ずこの関数を通す。
- 配列のうち、順番に意味がないものは、この章で定める並び順に並べてから書く。同じデータからは常に同じバイト列ができるようにし、Git の差分を最小にするためである。
- すべてのファイルに `schemaVersion` を置く。スキーマを互換性のない形で変えるときは番号を上げ、`scripts/run/migrate-data.ts` を用意する。

### 4.1.2 日付と時刻

| 種類 | 形式 | 例 | 用途 |
| - | - | - | - |
| 日時 | UTC の ISO 8601（末尾 `Z`、秒まで） | `2026-10-27T00:17:05Z` | 作成、更新、取得、確認の時刻 |
| 日付 | `YYYY-MM-DD`（日本時間の暦日） | `2026-10-27` | 収録日、情報の時点（`asOf`）、再確認日 |
| 不完全な日付 | `PartialDate`（§4.5.4） | `{ "precision": "season", "year": 2027, "season": "spring" }` | 発売日 |

現在時刻は `scripts/lib/clock.ts` の `now()` だけから得る。環境変数 `INDIEATLAS_NOW` で固定できるようにし、テストの結果を決定的にする。

### 4.1.3 共通の型（`schema/common.ts`）

```ts
import { z } from 'zod';

export const GameId = z.string().regex(/^g_\d{6}$/);
export const DeveloperId = z.string().regex(/^dev_\d{6}$/);
export const ArticleId = z.string().regex(/^a_[0-9a-f]{16}$/);
export const ClaimId = z.string().regex(/^c_[0-9a-f]{16}$/);
export const CollectionId = z.string().regex(/^col_\d{4}$/);
export const RelationId = z.string().regex(/^r_[0-9a-f]{16}$/);
export const TaskId = z.string().regex(/^t_[0-9a-f]{16}$/);
export const ReviewId = z.string().regex(/^rv_[0-9a-f]{16}$/);
export const SourceId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(40);
export const TagId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(40);
export const RunId = z.string().regex(/^(\d+|local-[0-9a-z-]+)$/);

export const IsoDateTime = z.iso.datetime();               // UTC。オフセットは付けない
export const IsoDate = z.iso.date();                       // YYYY-MM-DD
export const HttpUrl = z.url({ protocol: /^https?$/ });
export const Lang = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/); // BCP 47 の簡易形
export const Sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const Platform = z.enum([
  'pc',            // Windows PC。出典が「PC」とだけ書く場合もこれにする
  'mac', 'linux', 'switch', 'switch2', 'ps5', 'ps4', 'xbox-series', 'xbox-one',
  'ios', 'android', 'browser', 'meta-quest', 'other',
]);
export const Region = z.enum(['global', 'jp', 'asia', 'na', 'eu', 'other']);
export const Store = z.enum([
  'steam', 'itch', 'epic', 'gog', 'nintendo-eshop', 'playstation-store', 'microsoft-store',
  'app-store', 'google-play', 'meta-quest-store', 'humble', 'official', 'other',
]);
export const ReleaseStatus = z.enum(['released', 'early-access', 'upcoming', 'tba', 'cancelled', 'delisted']);
export const Support = z.enum(['yes', 'no', 'planned', 'unknown']);
export const PlayerMode = z.enum(['single', 'local-coop', 'online-coop', 'local-pvp', 'online-pvp', 'async', 'mmo']);
export const EvidenceKind = z.enum(['official', 'store', 'media', 'database', 'event']);
export const ArticleKind = z.enum([
  'announcement', 'news', 'preview', 'review', 'interview', 'devlog',
  'feature', 'roundup', 'press-release', 'video', 'other',
]);
export const ArticleRole = z.enum(['primary', 'mention', 'roundup']);   // 主題、一部で言及、まとめ記事内の紹介
export const TagGroup = z.enum(['genre', 'mechanic', 'play-style', 'theme', 'mood', 'setting', 'art-style']);
export const RelationKind = z.enum(['similar-play', 'same-series', 'spiritual-successor', 'shared-theme', 'often-compared']);
export const Actor = z.enum(['human', 'llm', 'agent', 'system']);   // agent: 運営者が操作するコーディングエージェント（12）
```

機種の一覧のような基礎的な分類を変えるときは、通常のコンテンツ更新とは別に、人がスキーマの変更として扱う。

## 4.2 ID と URL

### 4.2.1 ID の作り方

| 対象 | 形式 | 作り方 | 再利用 |
| - | - | - | - |
| 作品 | `g_` と6桁の数字 | 採用ジョブが、既存の全ファイル（統合済みを含む）の最大値に1を足して割り当てる | しない |
| 開発者 | `dev_` と6桁の数字 | 同上 | しない |
| コレクション | `col_` と4桁の数字 | 同上 | しない |
| 記事 | `a_` と16桁の16進数 | `sha256(normalizeUrl(canonicalUrl))` の先頭16桁 | 同じ URL なら常に同じ ID |
| Claim | `c_` と16桁の16進数 | `sha256(gameId + "\|" + field + "\|" + canonicalJson(scope) + "\|" + canonicalJson(value))` の先頭16桁 | 同じ主張なら同じ ID になり、根拠が追記される |
| 作品間の関係 | `r_` と16桁の16進数 | `sha256(a + "\|" + b + "\|" + kind)`（`a < b`） | 同上 |
| タスク | `t_` と16桁の16進数 | `sha256(type + "\|" + targetKey)`。`targetKey` はタスクの種類ごとに §4.8.2 で定める | 同じ目的のタスクは重複しない |
| レビュー待ち | `rv_` と16桁の16進数 | `sha256(kind + "\|" + canonicalJson(payload))` | 同上 |

- `canonicalJson` は、オブジェクトのキーを辞書順に並べ、`undefined` の項目を除いてから `JSON.stringify` する。
- 調査ジョブ（LLM）は数字の ID を割り当てない。新しい作品には `new:1` のような一時 ID を使い、採用ジョブが正式な ID に置き換える。

### 4.2.2 URL の正規化（`scripts/lib/url-normalize.ts`）

記事の重複防止と ID の計算に使う。

1. スキームとホスト名を小文字にする。`http` は `https` に揃える。
2. ホスト名の先頭の `www.` と `m.`、`amp.` を外す。
3. 既定のポート（`:80`、`:443`）を外す。
4. フラグメント（`#…`）を外す。
5. 次のクエリパラメーターを外す: `utm_*`、`fbclid`、`gclid`、`dclid`、`msclkid`、`mc_cid`、`mc_eid`、`igshid`、`ref`、`ref_src`、`cmpid`、`spm`、`amp`、`output=amp`。
6. 残ったクエリパラメーターを名前の辞書順に並べる。
7. パスの連続したスラッシュを1つにまとめ、末尾の `/amp/` と `/amp` を外す。
8. ルート以外のパスでは、末尾のスラッシュを外す。

記事を取得したあと、ページ内の `<link rel="canonical">` が同じ登録可能ドメイン（eTLD+1）を指していれば、それを `canonicalUrl` とする。正規化前の URL は `urlAliases` に入れ、`state/seen-urls.json` にも両方のハッシュを登録する。

### 4.2.3 公開 URL

- 作品詳細は `/games/{gameId}/` とする。タイトルを変えても URL は変わらない。
- 作品を統合したら、旧 ID の URL に転送ページを残す（[02](02-ux-and-design.md) §2.2）。
- 将来 `/games/{gameId}/{slug}/` のような読みやすい URL を加える場合も、ID だけの URL を正とし、slug つきの URL には canonical を付ける。

## 4.3 作品の同定（`scripts/pipeline/identity.ts`）

### 4.3.1 照合に使うキー

| 種類 | キー | 例 |
| - | - | - |
| 強いキー | ストアの ID、itch.io の URL、公式サイトの URL | `steam:1234560`、`itch:smallharbor.itch.io/lantern-tide`、`official:lanterntide.example.com` |
| 弱いキー | 正規化したタイトル（表示名、原題、別名） | `lanterntide` |
| 補助の情報 | 開発者名、発売年 | |

公式サイトの URL は、ホスト名に、トップページでなければパスを加えたものを正規化して使う。ストアや SNS のドメイン（`store.steampowered.com`、`x.com` など）は公式サイトのキーとして扱わない。

### 4.3.2 タイトルの正規化（`scripts/lib/text-normalize.ts`）

1. NFKC で正規化する（全角英数字を半角に揃える）。
2. 英字を小文字にする。
3. `™ ® ©` を外す。
4. 次の記号を空白に置き換える: `: ： - – — _ ・ · . , ! ? ！ ？ ' " 「 」 『 』 ( ) （ ） [ ] 【 】 ~ 〜 /`
5. ひらがなをカタカナに揃える。
6. 単独の語としてのローマ数字（`ii`、`iii`、`iv`、`v`、`vi`）を算用数字に置き換える。`&` は `and` にする。
7. 先頭の `the ` を外す。
8. 空白をすべて取り除いたものを照合のキーにする。

### 4.3.3 照合の手順

入力は、記事やストアから得た作品の手がかり（タイトルの候補、開発者名、URL、ストアの ID）である。

1. 強いキーが、統合済みでない既存作品の強いキーと一致すれば、その作品と判定する（`match`）。
2. 強いキーが既存作品の `associatedApps`（体験版、DLC など）と一致すれば、本編の作品と判定する（`match`、付属アプリであることを示す印を付ける）。
3. Steam のアプリが体験版または DLC で、本編のアプリ ID が分かる場合は、本編のキーに置き換えて 1 からやり直す。
4. 強いキーで一致しない場合は、弱いキーで探す。
   - 一致する作品がなければ、新しい作品（`none`）とする。
   - 1件だけ一致し、開発者名が重なる場合は `probable` とする。開発者名が不明で、発売年の差が1年以内の場合も `probable` とする。
   - それ以外（複数が一致する、開発者が異なる、など）は `ambiguous` とする。
5. 入力に強いキーがあり、既存の作品と同じ種類の強いキーで値が異なり、タイトルだけが一致する場合は、別の作品（同名作品）と判定する（`none`）。両方の作品に、区別のための内部メモ（`disambiguation`）を付ける。

### 4.3.4 判定結果の使い方

| 判定 | 新しい作品の作成（`create-game`）の提案に対する扱い |
| - | - |
| `match` | 作成を取りやめ、一時 ID を既存の作品 ID に置き換える。同じ提案の中の識別情報は「追加だけ」の更新として扱い、Claim は既存の作品に付ける |
| `probable` | 作成を却下し、`fix-duplicate` タスクを作る |
| `ambiguous` | 作成を却下し、手がかりを添えた `register-game` タスクを `blocked` で作る |
| `none` | 作成を検証に進める（[06](06-update-pipeline.md) §6.7） |

弱いキーだけを根拠に、既存の作品どうしを自動で統合することはしない。統合の提案は `state/review-queue.json` に入れ、人が判断する（`publish.autoMergeGames: false` の間）。

### 4.3.5 本編、体験版、DLC

- 作品として登録するのは本編だけとする。体験版、プレイテスト、プロローグ、DLC、サウンドトラックは、本編の `associatedApps` に入れる。
- 本編のストアページがまだなく、体験版だけが公開されている場合は、体験版のページを根拠に本編を登録してよい。この場合、体験版のアプリ ID は `associatedApps` に入れ、`externalIds.steamAppId` は本編のページが分かってから設定する。
- 続編、リマスター、移植の別版は、別の作品として登録し、作品間の関係（`same-series`）で結ぶ。

## 4.4 Game と Developer

### 4.4.1 Game（`schema/game.ts`、`data/games/{gameId}.json`）

作品のファイルには、識別に必要な情報だけを置く。発売日や日本語対応などの個別情報は Claim として別のファイルに置き、サイト用データを作るときに組み合わせる。

```ts
export const GameStatus = z.enum([
  'candidate',  // 公開の条件を満たしていない。サイトに出さない
  'published',  // 公開中
  'hidden',     // 一時的に非公開（誤情報の調査中、権利上の理由など）
  'merged',     // 別の作品に統合済み。旧 URL には転送ページを置く
]);

export const Alias = z.object({
  value: z.string().min(1).max(120),
  lang: Lang.optional(),
  kind: z.enum(['localized', 'abbreviation', 'reading', 'romanization', 'former', 'working-title']),
});

export const IndieReasonCode = z.enum([
  // インディーと判定する理由
  'self-published',         // 開発者とパブリッシャーが同じ
  'independent-publisher',  // パブリッシャーが Developer で independence=independent と登録済み
  'solo-developer',         // 個人開発と公式に明記されている
  'small-team',             // 小規模な体制と公式に明記されている
  'indie-showcase',         // インディー向けのイベントやショーケースへの出展
  'indie-fund',             // インディー向けの助成やファンドの対象
  // インディーではないと判定する理由
  'major-publisher',        // パブリッシャーが Developer で independence=major と登録済み
  'large-studio',           // 大規模な開発体制と公式に明記されている
  'subsidiary',             // 大手企業の子会社
]);

export const IdentityEvidence = z.object({
  field: z.enum(['title', 'aliases', 'externalIds', 'associatedApps', 'officialUrl', 'developers', 'publishers']),
  evidence: Evidence,
});

export const Game = z.object({
  schemaVersion: z.literal(1),
  id: GameId,
  status: GameStatus,
  statusReason: z.string().max(200).optional(),
  mergedInto: GameId.optional(),
  title: z.object({
    display: z.string().min(1).max(120),   // サイトの表示名。日本語の公式表記があればそれ、なければ原題
    original: z.string().min(1).max(120),  // 開発者による正式な表記
    originalLang: Lang,
  }),
  aliases: z.array(Alias).max(30),
  externalIds: z.object({
    steamAppId: z.number().int().positive().optional(),
    itchUrl: HttpUrl.optional(),
    igdbId: z.number().int().positive().optional(),
    epicSlug: z.string().max(120).optional(),
    gogId: z.string().max(40).optional(),
    nintendoNsuid: z.string().max(40).optional(),
    psStoreId: z.string().max(80).optional(),
    msStoreId: z.string().max(40).optional(),
    appStoreId: z.string().max(40).optional(),
    googlePlayId: z.string().max(200).optional(),
  }).strict(),
  associatedApps: z.array(z.object({
    store: Store,
    id: z.string().max(200),
    kind: z.enum(['demo', 'playtest', 'prologue', 'dlc', 'soundtrack', 'other']),
    title: z.string().max(120).optional(),
  })).max(30),
  officialUrl: HttpUrl.optional(),
  developerIds: z.array(DeveloperId).max(10),
  publisherIds: z.array(DeveloperId).max(10),
  indie: z.object({
    assessment: z.enum(['indie', 'not-indie', 'unknown']),  // コードが reasons から計算する（§4.4.3）
    reasons: z.array(z.object({
      code: IndieReasonCode,
      note: z.string().max(200).optional(),
      evidence: z.array(Evidence).min(1).max(5),
    })).max(10),
    assessedAt: IsoDateTime,
  }),
  identityEvidence: z.array(IdentityEvidence).max(50),
  disambiguation: z.string().max(120).optional(),  // 同名作品を区別するための内部メモ。サイトには出さない
  createdAt: IsoDateTime,
  addedAt: IsoDate.optional(),   // 初めて published になった日（収録日）。published、hidden なら必須
  updatedAt: IsoDateTime,
  createdByRun: RunId,
}).superRefine((g, ctx) => {
  if (g.status === 'merged' && !g.mergedInto) ctx.addIssue({ code: 'custom', message: 'merged requires mergedInto' });
  if (g.status !== 'merged' && g.mergedInto) ctx.addIssue({ code: 'custom', message: 'mergedInto only for merged' });
  if ((g.status === 'published' || g.status === 'hidden') && !g.addedAt) ctx.addIssue({ code: 'custom', message: 'published requires addedAt' });
});
```

並び順: `aliases` は `kind`、`value` の順。`associatedApps` は `store`、`id` の順。`identityEvidence` は `field`、`evidence.retrievedAt` の順。`developerIds` と `publisherIds` は出典に書かれた順のまま（意味のある順序として扱う）。

### 4.4.2 Developer（`schema/developer.ts`、`data/developers/{developerId}.json`）

```ts
export const Developer = z.object({
  schemaVersion: z.literal(1),
  id: DeveloperId,
  name: z.object({ display: z.string().min(1).max(80), original: z.string().min(1).max(80) }),
  aliases: z.array(z.string().max(80)).max(20),
  roles: z.array(z.enum(['developer', 'publisher'])).min(1),
  officialUrl: HttpUrl.optional(),
  links: z.array(z.object({
    kind: z.enum(['website', 'x', 'bluesky', 'youtube', 'steam-developer', 'steam-publisher', 'itch', 'press-kit', 'other']),
    url: HttpUrl,
  })).max(20),
  independence: z.object({
    status: z.enum(['independent', 'affiliated', 'major', 'unknown']),
    setBy: Actor,
    note: z.string().max(200).optional(),
    evidence: z.array(Evidence).max(5),
  }),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  createdByRun: RunId,
});
```

- `independence.status` を `independent` または `major` にできるのは人だけとする（`setBy: 'human'`）。LLM がこれらを提案した場合は `state/review-queue.json` に入れる。LLM が設定できるのは `unknown` と `affiliated` だけである。
- 開発者名の照合には、作品のタイトルと同じ正規化（§4.3.2）を使う。

### 4.4.3 インディーかどうかの判定

`Game.indie.assessment` は LLM が直接決めず、`scripts/pipeline/publish-rules.ts` の `assessIndie(game, developers)` が `reasons` から計算する。

1. 否定的な理由（`major-publisher`、`large-studio`、`subsidiary`）のうち、根拠の種類が `official` または `store` のものが1つでもあれば `not-indie` とする。
2. そうでなく、肯定的な理由が1つ以上あれば `indie` とする。ただし、それぞれの根拠が §6.7 の根拠の検証を通っていることが条件である。
3. どちらでもなければ `unknown` とする。

`unknown` の作品は candidate のまま保持し、公開しない（[05](05-sources-and-editorial-policy.md) §5.5）。

### 4.4.4 拠点の国と知名度

- `Developer.country` は開発元の拠点の国（ISO 3166-1 alpha-2）と、それを示す根拠（1〜5件）。根拠がなければ設定しない。開発元のいずれかが `JP` の作品には、サイトで「国産」の印を付ける（`SiteGame.madeInJapan`）。
- `data/metrics/popularity.json`（`schema/media.ts` の `PopularityMetrics`）は、作品ごとの Steam のレビュー数（appdetails の `recommendations.total`）と IGDB の評価を持つ。`npm run metrics:popularity` が更新する。
- 知名度の区分（`SiteGame.prominence`）は Steam のレビュー数で決める（`scripts/build/site-data.ts` の `PROMINENCE_THRESHOLDS`）。

  | 区分 | 条件 | サイトでの表示 | 2026-10-28 時点の件数 |
  | - | - | - | - |
  | `landmark` | 15万件以上 | 「殿堂入り」の金の札と枠。詳しい紹介（Claim の `overview`）を書く | 79作品中16 |
  | `notable` | 3万件以上 | 「人気」の札 | 23 |
  | `standard` | それ以外 | 印なし | 40 |

  境目は、誰もが名前を知る作品（Terraria、Slay the Spire など）が `landmark` に、ジャンルの中で広く知られた作品（Celeste、Hades II など）が `notable` に入るように置いた。収録作品が増えて上位の割合が大きく変わったら見直す。

## 4.5 Claim と Evidence

### 4.5.1 Evidence（`schema/claim.ts`）

```ts
export const Evidence = z.object({
  kind: EvidenceKind,                // official、store、media、database、event
  url: HttpUrl,
  sourceId: SourceId.optional(),     // config/sources.json に登録した情報源なら、その ID
  articleId: ArticleId.optional(),   // kind=media のときは記事の ID
  publishedAt: z.union([IsoDateTime, IsoDate]).optional(),  // 出典が公開、発表された日時
  retrievedAt: IsoDateTime,          // 取得した日時（コードが取得ログから設定する）
  quote: z.string().min(8).max(200).optional(),  // 根拠となる箇所の原文の抜粋。サイトには出さない
  quoteHash: Sha256.optional(),      // evidence.storeQuotes=false のとき、抜粋の代わりに保存する
  locator: z.string().max(200).optional(),  // API の項目など。例: "steam:appdetails.release_date.date"
  originKey: z.string().max(200),    // 独立性を判定するキー（§4.5.3）
  fetchHash: Sha256.optional(),      // 取得した本文のハッシュ
}).superRefine((e, ctx) => {
  if (!e.quote && !e.quoteHash && !e.locator) ctx.addIssue({ code: 'custom', message: 'quote, quoteHash or locator required' });
});
```

根拠の種類は次のとおり。

| 種類 | 対象 | 信頼の順位（§6.8） |
| - | - | - |
| `official` | 開発者やパブリッシャーの公式サイト、公式のプレスリリース、公式ブログ、公式の開発日誌 | 3 |
| `store` | ストアのページと API（Steam、itch.io、各機種のストアなど） | 3 |
| `media` | 媒体の記事 | 2 |
| `event` | イベントの出展一覧、公式の配信の告知 | 2 |
| `database` | IGDB などのデータベース | 1 |

### 4.5.2 Claim（`data/claims/{gameId}.json`）

```ts
export const ClaimStatus = z.enum([
  'adopted',     // 採用済み。サイトに表示する
  'candidate',   // 根拠はあるが、まだ採用の条件を満たしていない
  'conflicted',  // 同じ順位の別の値と矛盾している。確認待ち
  'superseded',  // より新しい、または信頼できる Claim に置き換えられた
  'rejected',    // 検証で採用しないと決めた
  'retracted',   // 誤りと判明した（訂正）
]);
export const ClaimBasis = z.enum(['fact', 'reported', 'editorial']);  // 根拠のある事実、媒体による報道、編集上の解釈
export const ClaimField = z.enum(['release', 'japaneseSupport', 'playerModes', 'summary', 'features', 'tag', 'storeLink', 'image']);
export const ClaimStatusReason = z.enum([
  'highest-rank', 'newer-source', 'higher-tier-source', 'outranked', 'conflict-same-rank',
  'insufficient-evidence', 'paraphrase-only', 'tag-limit', 'retracted-by-evidence', 'retracted-by-human',
  'source-disabled', 'game-merged',
]);

const ClaimBase = z.object({
  id: ClaimId,
  gameId: GameId,
  scope: z.object({ platform: Platform.optional(), region: Region.optional() }).strict(),
  basis: ClaimBasis,
  evidence: z.array(Evidence).min(1).max(20),
  asOf: IsoDate,                        // 情報の時点。出典がその情報を示した日（発表日など）
  status: ClaimStatus,
  statusReason: ClaimStatusReason.optional(),
  supersedes: z.array(ClaimId).max(10).optional(),
  supersededBy: ClaimId.optional(),
  adoptedAt: IsoDateTime.optional(),    // adopted になった日時
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastCheckedAt: IsoDateTime,           // 最後に出典で確認した日時。公開内容ハッシュの計算から除く
  createdBy: Actor,
  createdByRun: RunId,
});

export const ImageValue = z.object({
  url: HttpUrl,
  role: z.enum(['header', 'capsule', 'keyart', 'screenshot', 'logo']),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  alt: z.string().max(120).optional(),
  usage: z.object({
    basis: z.enum(['store-asset', 'official-press-kit', 'developer-provided', 'other-permitted']),
    credit: z.string().max(80).optional(),
    note: z.string().max(200).optional(),
  }),
});

export const Claim = z.discriminatedUnion('field', [
  ClaimBase.extend({
    field: z.literal('release'),
    value: z.object({
      status: ReleaseStatus,
      date: PartialDate.optional(),           // released と early-access では必須。upcoming では任意
      rawText: z.string().max(60).optional(), // 出典の原文の表記。例: 「2027年春」「Q2 2027」
    }),
  }),
  ClaimBase.extend({
    field: z.literal('japaneseSupport'),
    value: z.object({ interface: Support, subtitles: Support, audio: Support }),
  }),
  ClaimBase.extend({
    field: z.literal('playerModes'),
    value: z.object({
      modes: z.array(PlayerMode).min(1),
      minPlayers: z.number().int().min(1).max(1000).optional(),
      maxPlayers: z.number().int().min(1).max(1000).optional(),
    }),
  }),
  ClaimBase.extend({ field: z.literal('summary'), value: z.object({ ja: z.string().min(60).max(160) }) }),
  ClaimBase.extend({ field: z.literal('features'), value: z.object({ ja: z.array(z.string().min(10).max(60)).min(3).max(5) }) }),
  ClaimBase.extend({ field: z.literal('tag'), value: z.object({ tagId: TagId }) }),
  ClaimBase.extend({ field: z.literal('storeLink'), value: z.object({ store: Store, url: HttpUrl }) }),
  ClaimBase.extend({ field: z.literal('image'), value: ImageValue }),
]);

export const ClaimsFile = z.object({
  schemaVersion: z.literal(1),
  gameId: GameId,
  claims: z.array(Claim),
});
```

項目ごとの規則は次のとおり。

| 項目 | 値の数 | 適用範囲（scope） | 使える basis | 備考 |
| - | - | - | - | - |
| `release` | 範囲ごとに1つ | `platform` は必須、`region` は省略時 `global` | `fact`、`reported` | 延期は新しい Claim で `supersedes` を指定する |
| `japaneseSupport` | 範囲ごとに1つ | `platform` は任意（省略時は全機種） | `fact`、`reported` | 「非対応」も根拠が必要 |
| `playerModes` | 1つ | なし | `fact`、`reported` | |
| `summary` | 1つ | なし | `editorial` | 根拠には要約に使った出典を並べる |
| `features` | 1つ | なし | `editorial` | 同上 |
| `tag` | 複数（採用は最大12） | なし | `editorial` | 1つの Claim に1つのタグ |
| `storeLink` | 複数 | `platform` は任意 | `fact` | `value.url` が同じものは1つにまとめる |
| `image` | 複数 | なし | `fact` | 表示には `header` → `capsule` → `keyart` の順で1枚を選ぶ |

並び順: `claims` は `field`（上の表の順）、範囲のキー（`platform`、`region` の順で結合した文字列）、`createdAt`、`id` の順。`evidence` は `retrievedAt`、`url` の順。

### 4.5.3 独立した裏づけの数え方

`originKey` が同じ根拠は、何件あっても裏づけ1件として数える。

| 状況 | `originKey` |
| - | - |
| 公式サイト | `official:{登録可能ドメイン}` |
| ストア | `store:{store}`（例: `store:steam`） |
| 媒体の記事 | `media:{登録可能ドメイン}` |
| 記事がプレスリリースの転載や引き写しと判定された（`Article.derivedFrom` がある） | `pr:{derivedFrom.key}` |
| イベント | `event:{登録可能ドメイン}` |
| データベース | `database:{登録可能ドメイン}` |

同じプレスリリースを転載した3つの媒体の記事は、`pr:` のキーが共通になるため、独立した裏づけは1件になる。

### 4.5.4 PartialDate

```ts
const Year = z.number().int().min(1970).max(2100);
const Month = z.number().int().min(1).max(12);

export const PartialDate = z.discriminatedUnion('precision', [
  z.object({ precision: z.literal('day'), year: Year, month: Month, day: z.number().int().min(1).max(31) }),
  z.object({ precision: z.literal('month'), year: Year, month: Month }),
  z.object({ precision: z.literal('quarter'), year: Year, quarter: z.number().int().min(1).max(4) }),
  z.object({ precision: z.literal('half'), year: Year, half: z.union([z.literal(1), z.literal(2)]) }),
  z.object({ precision: z.literal('season'), year: Year, season: z.enum(['spring', 'summer', 'autumn', 'winter']) }),
  z.object({ precision: z.literal('year'), year: Year }),
]).superRefine((d, ctx) => {
  if (d.precision === 'day' && !isValidCalendarDate(d.year, d.month, d.day)) {
    ctx.addIssue({ code: 'custom', message: 'invalid calendar date' });
  }
});
```

- 「2027年春」は `{ precision: 'season', year: 2027, season: 'spring' }` として保存し、架空の年月日に変換しない。出典の原文は `rawText` に残す。
- `scripts/lib/partial-date.ts` に次の関数を用意する。
  - `startOf(d)`: その期間の最初の日。並び替えに使う。季節は春=3月1日、夏=6月1日、秋=9月1日、冬=その年の12月1日とする。
  - `endOf(d)`: その期間の最後の日。冬はその年の12月から翌年2月末までとする。
  - `hasPassed(d, today)`: `endOf(d) < today`。予定日を過ぎた `upcoming` を見つけ、`check-change` タスクを作るのに使う。
  - `format(d)`: [02](02-ux-and-design.md) §2.4.1 の表示形式。

## 4.6 Article（`schema/article.ts`、`data/articles/{articleId}.json`）

```ts
export const Article = z.object({
  schemaVersion: z.literal(1),
  id: ArticleId,
  url: HttpUrl,                        // 最初に見つけた URL
  canonicalUrl: HttpUrl,               // ID を計算する元の URL（§4.2.2）
  urlAliases: z.array(HttpUrl).max(10),
  sourceId: SourceId.optional(),       // 情報源として登録していない媒体の記事では省略する
  outlet: z.object({ name: z.string().min(1).max(80), domain: z.string().min(3).max(120) }),
  title: z.string().min(1).max(300),   // 原文のタイトル
  lang: Lang,
  kind: ArticleKind,
  publishedAt: IsoDateTime.optional(),
  retrievedAt: IsoDateTime,
  summaryJa: z.string().max(120).optional(),  // 当サイトが書く短い説明。情報源の権利条件が許す場合だけ
  image: z.object({                    // 記事の OGP 画像（2026-10-28 に追加）
    path: z.string(),                  // public/ からの相対パス（media/articles/{id}.webp）
    width: z.number().int(), height: z.number().int(),
    sourceUrl: HttpUrl,                // og:image の元の URL
    retrievedAt: IsoDateTime,
    hash: Sha256,                      // 保存したファイルのハッシュ
  }).optional(),
  derivedFrom: z.object({
    kind: z.literal('press-release'),
    key: z.string().min(3).max(200),   // 同じプレスリリースを識別するキー。元の URL があれば正規化した URL
    url: HttpUrl.optional(),
  }).optional(),
  games: z.array(z.object({
    gameId: GameId,
    role: ArticleRole,
    note: z.string().max(80).optional(),  // 関連づけた理由（内部用）
  })).max(30),
  status: z.enum(['active', 'unavailable']),  // unavailable: リンク切れなど
  contentHash: Sha256.optional(),       // 本文のハッシュ。本文そのものは保存しない
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  createdByRun: RunId,
});
```

- 記事の本文は保存しない。
- 未登録の作品への言及は Article には書かず、`register-game` タスク（対象に `articleId` を含める）にする。そのタスクで作品を登録したら、記事との関連を追加する。
- 並び順: `games` は `role`（primary、roundup、mention の順）、`gameId` の順。

## 4.7 Collection、Relation、Tag

### 4.7.1 Collection（`data/collections/{collectionId}.json`）

```ts
export const CollectionRules = z.object({
  allTags: z.array(TagId).max(5).optional(),       // すべてを満たす
  anyTags: z.array(TagId).max(10).optional(),      // いずれかを満たす
  excludeTags: z.array(TagId).max(10).optional(),
  platforms: z.array(Platform).optional(),         // いずれかの機種で発売中または発売予定
  releaseStatuses: z.array(ReleaseStatus).optional(),
  japaneseInterface: z.array(Support).optional(),
  playerModes: z.array(PlayerMode).optional(),
}).strict();

export const Collection = z.object({
  schemaVersion: z.literal(1),
  id: CollectionId,
  status: z.enum(['draft', 'published', 'archived']),
  title: z.string().min(2).max(40),
  lede: z.string().min(10).max(120),
  description: z.string().max(1000),               // Markdown
  criteria: z.object({
    text: z.string().min(10).max(400),             // 選定条件（人が読む文章）
    rules: CollectionRules.optional(),             // コードで確かめられる部分
  }),
  items: z.array(z.object({
    gameId: GameId,
    reason: z.string().min(20).max(120),           // この作品を含めた理由
    evidenceClaimIds: z.array(ClaimId).max(5),     // 理由を支える採用済みの Claim
    addedAt: IsoDate,
    addedBy: Actor,
    position: z.number().int().min(0),
  })).max(60),
  order: z.enum(['curated', 'added-desc', 'release-desc']),
  featured: z.boolean(),
  createdBy: Actor,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
```

公開中のコレクションは4作品以上を含む。並び順: `items` は `position`、`gameId` の順。

### 4.7.2 GameRelation（`data/relations/game-relations.json`）

```ts
export const GameRelation = z.object({
  id: RelationId,
  a: GameId,                          // a < b（辞書順）
  b: GameId,
  kind: RelationKind,
  reason: z.string().min(10).max(100),  // 両方の作品のページに出すため、どちらから見ても成り立つ文にする
  basis: z.enum(['fact', 'editorial']),
  evidenceClaimIds: z.array(ClaimId).max(10),
  evidence: z.array(Evidence).max(5),
  status: z.enum(['adopted', 'candidate', 'rejected']),
  createdBy: Actor,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  createdByRun: RunId,
});

export const GameRelationsFile = z.object({
  schemaVersion: z.literal(1),
  relations: z.array(GameRelation),   // a、b、kind の順に並べる
});
```

同じ開発者による作品どうしの関係は、`developerIds` からビルド時に計算し、保存しない。

### 4.7.3 Tag（`data/taxonomy/tags.json`）

```ts
export const Tag = z.object({
  id: TagId,                          // 例: roguelike、deck-building、cozy
  label: z.object({ ja: z.string().min(1).max(30), en: z.string().min(1).max(40) }),
  aliases: z.array(z.string().max(40)).max(20),
  group: TagGroup,
  definition: z.string().min(10).max(200),
  status: z.enum(['core', 'candidate', 'deprecated']),
  mergedInto: TagId.optional(),       // deprecated のときの統合先
  createdBy: Actor,
  createdAt: IsoDateTime,
});

export const TagsFile = z.object({ schemaVersion: z.literal(1), tags: z.array(Tag) });  // id の順
```

- `core` のタグは人が定義する。初期データで、ジャンル、遊び方、雰囲気の系統を中心に40〜60個を用意する。
- LLM は `candidate` のタグを追加できる。追加する前に、ラベルと別名を正規化して既存のタグと照合し、一致すれば既存のタグを使う（[06](06-update-pipeline.md) §6.7 の V-C03）。
- `core` の定義の変更、タグの統合（`deprecated` と `mergedInto` の設定）、`candidate` から `core` への昇格は、通常の情報追加とは別に、人が PR で行う。

## 4.8 運用の状態（`state/`）

### 4.8.1 SourceState（`state/sources/{sourceId}.json`）

```ts
export const SourceState = z.object({
  schemaVersion: z.literal(1),
  sourceId: SourceId,
  cursor: z.object({
    lastItemPublishedAt: IsoDateTime.optional(),
    recentItemKeys: z.array(z.string()).max(500),  // 直近に処理した項目の guid、または正規化 URL のハッシュ
    etag: z.string().max(200).optional(),
    lastModified: z.string().max(100).optional(),
  }),
  lastAttemptAt: IsoDateTime.optional(),
  lastSuccessAt: IsoDateTime.optional(),
  consecutiveFailures: z.number().int().min(0),
  lastError: z.object({ at: IsoDateTime, message: z.string().max(500) }).optional(),
  nextAttemptAfter: IsoDateTime.optional(),
});
```

処理位置（`cursor`）は、取得した項目のすべてが記事、タスク、または `state/seen-urls.json` の記録として保存されたときにだけ進める（[07](07-workflows-and-operations.md) §7.7）。

### 4.8.2 Task（`state/tasks.json`）

```ts
export const TaskType = z.enum([
  'fix-conflict', 'fix-duplicate', 'fix-reported-error',   // 段階1: 誤情報と重複の修正
  'check-change', 'process-article',                       // 段階2: 変化の確認、新着記事の処理
  'register-game', 'discover',                             // 段階3: 未登録作品の登録と探索
  'fill-missing', 'refresh-game',                          // 段階4: 不足情報の補完と再確認
  'improve-relations', 'improve-collection', 'review-tags',// 段階5: 関連作品、コレクション、分類の改善
]);
export const TaskOutcome = z.enum(['completed', 'partial', 'not-found', 'blocked', 'irrelevant', 'failed', 'deferred']);

export const Task = z.object({
  id: TaskId,
  type: TaskType,
  target: z.object({
    gameId: GameId.optional(),
    articleId: ArticleId.optional(),
    url: HttpUrl.optional(),
    sourceId: SourceId.optional(),
    collectionId: CollectionId.optional(),
    field: ClaimField.optional(),
    claimIds: z.array(ClaimId).max(10).optional(),
    name: z.string().max(120).optional(),           // 未登録作品の名前など
    hints: z.array(z.string().max(200)).max(10).optional(),
  }).strict(),
  goal: z.string().min(5).max(300),                 // 調査の目的（日本語）
  status: z.enum(['open', 'blocked', 'done', 'dropped']),
  priority: z.number(),                             // 最後に計算した優先度（参考値）
  attempts: z.number().int().min(0),
  lastAttemptAt: IsoDateTime.optional(),
  lastRunId: RunId.optional(),
  blockedReason: z.string().max(300).optional(),
  recheck: z.object({ after: IsoDate.optional(), condition: z.string().max(200).optional() }).optional(),
  createdAt: IsoDateTime,
  createdBy: z.enum(['collector', 'planner', 'executor', 'validator', 'scheduler', 'human', 'agent']),
  resolution: z.object({ at: IsoDateTime, runId: RunId, outcome: TaskOutcome, summary: z.string().max(300) }).optional(),
});

export const TasksFile = z.object({ schemaVersion: z.literal(1), tasks: z.array(Task) });  // id の順
```

タスクの種類ごとの `targetKey`（ID の計算に使う）は次のとおり。

| 種類 | `targetKey` |
| - | - |
| `process-article` | 正規化した URL |
| `register-game` | 強いキーがあればそのキー。なければ正規化したタイトルと、最初の手がかり |
| `discover` | `sourceId` と ISO 週（例: `bitsummit-exhibitors\|2026-W44`） |
| `check-change`、`refresh-game`、`improve-relations` | `gameId` |
| `fill-missing` | `gameId` と `field` |
| `fix-conflict` | `gameId`、`field`、範囲のキー |
| `fix-duplicate` | 対象の作品 ID を辞書順に並べて結合したもの |
| `fix-reported-error` | 報告の識別子（Issue の番号など） |
| `improve-collection` | `collectionId`（新しいコレクションの案は `new` と ISO 週） |
| `review-tags` | ISO 週 |

状態の遷移は次のとおり。

- 実行して `completed`、`irrelevant`、`not-found` になったら `done` にする。`not-found` で再確認の条件があれば `blocked` にして `recheck` を設定する。
- `failed` と `partial` は `attempts` を1増やし、`open` のままにする。`attempts` が3に達したら `blocked` にし、`recheck.after` を14日後にする。
- `recheck.after` を過ぎた `blocked` のタスクは、実行の開始時に `open` に戻す。`attempts` が6に達したら `dropped` にする。
- 費用や時間の上限で実行できなかったもの（`deferred`）は、`attempts` を増やさない。
- `done` と `dropped` から30日（`retention.doneTaskDays`）を過ぎたタスクは、`state/tasks-archive/YYYY-MM.json` に移す。

### 4.8.3 SeenUrls（`state/seen-urls.json`）

```ts
export const SeenUrls = z.object({
  schemaVersion: z.literal(1),
  entries: z.record(
    z.string().regex(/^[0-9a-f]{16}$/),   // 正規化した URL の sha256 の先頭16桁
    z.object({
      status: z.enum(['article', 'task', 'irrelevant', 'failed']),
      articleId: ArticleId.optional(),
      taskId: TaskId.optional(),
      sourceId: SourceId.optional(),
      attempts: z.number().int().min(0),
      firstSeenAt: IsoDate,
      lastSeenAt: IsoDate,
    }),
  ),
});
```

- `article`、`task`、`irrelevant` の URL は、次からの取得で読み飛ばす。
- `failed` の URL は再び取得を試みる。`attempts` が3に達したら `irrelevant` として扱う。
- `irrelevant` と `failed` の項目は、`lastSeenAt` から180日（`retention.seenUrlDays`）を過ぎたら消す。

### 4.8.4 ReviewItem（`state/review-queue.json`）

人の判断を待つ提案を置く。

```ts
export const ReviewItem = z.object({
  id: ReviewId,
  kind: z.enum(['merge-games', 'developer-independence', 'core-tag-change', 'collection-publish', 'other']),
  operation: Operation,              // 06 §6.6 の Operation をそのまま保存する
  reason: z.string().max(500),
  createdAt: IsoDateTime,
  createdByRun: RunId,
  status: z.enum(['open', 'accepted', 'rejected', 'applied']),
  decidedAt: IsoDateTime.optional(),
  note: z.string().max(500).optional(),
});
export const ReviewQueue = z.object({ schemaVersion: z.literal(1), items: z.array(ReviewItem) });
```

人は PR でこのファイルの `status` を `accepted` または `rejected` に変える。次の実行の採用ジョブが、`accepted` の項目を通常の検証に通したうえで反映し、`applied` にする。

### 4.8.5 RunSummary（`state/runs/YYYY-MM.json`）と UsageLedger（`state/usage/YYYY-MM.json`）

```ts
export const RunSummary = z.object({
  runId: RunId,
  runAttempt: z.number().int().min(1),
  researchAttempt: z.number().int().min(1).optional(),  // 採用した調査結果の試行番号
  trigger: z.enum(['schedule', 'workflow_dispatch', 'push', 'local']),
  mode: z.enum(['full', 'collect-only', 'publish-only', 'manual']),   // manual: npm run ia -- apply（12）
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime,
  triggerCommit: z.string().regex(/^[0-9a-f]{40}$/),
  dataCommit: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  outcome: z.enum(['success', 'partial', 'no-change', 'failed']),
  stopReason: z.enum(['completed', 'soft-deadline', 'hard-deadline', 'cost-budget', 'provider-limit', 'error', 'llm-disabled']),
  counts: z.object({
    sourcesFetched: z.number().int(), sourcesFailed: z.number().int(),
    articlesCollected: z.number().int(), articlesLinked: z.number().int(),
    gamesCreated: z.number().int(), gamesPublished: z.number().int(),
    claimsAdded: z.number().int(), claimsAdopted: z.number().int(), claimsConflicted: z.number().int(),
    relationsAdded: z.number().int(), collectionsChanged: z.number().int(),
    tasksCreated: z.number().int(), tasksDone: z.number().int(), tasksBlocked: z.number().int(),
    operationsRejected: z.number().int(),
  }),
  cost: z.object({
    llmUsd: z.number(),
    inputTokens: z.number().int(), outputTokens: z.number().int(),
    cachedInputTokens: z.number().int(), reasoningTokens: z.number().int(),
  }),
  publish: z.object({
    status: z.enum(['pending', 'deployed', 'skipped-unchanged', 'failed', 'unknown']),
    contentHash: Sha256.optional(),
  }),
  pending: z.array(z.string().max(200)).max(20),   // 保留事項の要約
  rejections: z.array(z.object({ rule: z.string(), count: z.number().int() })).max(50),
});
export const RunsFile = z.object({ schemaVersion: z.literal(1), runs: z.array(RunSummary) });  // startedAt の順

export const UsageLedger = z.object({
  schemaVersion: z.literal(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),   // 日本時間の暦月
  entries: z.array(z.object({ runId: RunId, runAttempt: z.number().int(), at: IsoDateTime, llmUsd: z.number() })),
  totalUsd: z.number(),
});
```

`publish.status` は、採用ジョブがコミットする時点では `pending` になる。次の実行の採用ジョブが、公開中の manifest（[07](07-workflows-and-operations.md) §7.4）を読み、前回の記録を `deployed`、`skipped-unchanged`、`failed` のいずれかに更新する。

## 4.9 派生値

ビルド時に `scripts/build/site-data.ts` が計算し、保存はしない。

| 値 | 計算方法 |
| - | - |
| 全体の発売状況 | [02](02-ux-and-design.md) §2.4.2 の優先順位 |
| `platforms` | 採用済みの `release` Claim のうち `cancelled`、`delisted` でないものの機種と、`storeLink` の機種の和集合 |
| `enrichedAt` | 次のうち最も新しい日付。ただし `addedAt` より後のものに限る。(1) 主要項目（`release`、`japaneseSupport`、`playerModes`、`summary`、`features`、`image`）の Claim の `adoptedAt`。(2) `role: primary` で関連づいた記事の `createdAt` |
| `enrichedNote` | `enrichedAt` を決めた変更の種類を表示用の文にしたもの（例:「発売日が更新」「日本語対応を確認」「紹介記事を追加」） |
| `coverage.filledFields` | 次の7項目のうち値がある数: release、japaneseSupport、playerModes、summary、features、タグ3件以上、image |
| `coverage.articleCount` | 関連づいた記事の数（扱いを問わない） |
| 同じ開発者の作品 | `developerIds` が重なる公開中の作品 |

## 4.10 整合性の検証（`npm run check:data`）

`scripts/run/check-data.ts` は次の項目を検証し、1つでも違反があれば終了コード1で終わる。CI、採用ジョブのコミット前、ビルドの前に実行する。

| 番号 | 検証内容 |
| - | - |
| D-01 | すべてのファイルがスキーマに合い、ファイル名が `id` と一致する |
| D-02 | ファイルの内容が `writeJson` で書き直した結果と1バイトも違わない（書式と並び順） |
| D-03 | 参照先が存在する（開発者、Claim の作品、記事の作品、コレクションの作品、関係の作品、タグの Claim のタグ、`mergedInto`） |
| D-04 | 統合済みの作品の `mergedInto` は統合済みでない作品を指し、連鎖しない。統合済みの作品には、採用済みの Claim、記事の関連、コレクションの項目、関係が残っていない |
| D-05 | 統合済みでない作品どうしで、強いキー（§4.3.1）が重複しない。`associatedApps` の ID も他の作品の強いキーと重複しない |
| D-06 | 公開中の作品が公開の条件（[05](05-sources-and-editorial-policy.md) §5.5）を満たす |
| D-07 | Claim の ID が §4.2.1 の計算と一致する。値が1つの項目では、範囲ごとに採用済みの Claim が1つ以下である。`superseded` には `supersededBy` がある |
| D-08 | 記事の ID が `canonicalUrl` から計算した値と一致する。ストアの告知（`store.steampowered.com`、`steamcommunity.com` の更新のお知らせ）は記事として登録しない |
| D-09 | 公開中のコレクションは4作品以上を含み、すべての作品が公開中で、`rules` を満たす。`evidenceClaimIds` はその作品の採用済みの Claim である |
| D-10 | 作品間の関係は `a < b` で、`(a, b, kind)` が重複しない |
| D-11 | タグの ID が重複しない。`mergedInto` が存在する。正規化したラベルと別名が、タグどうしで重複しない |
| D-12 | タスクとレビュー待ちの ID が重複しない。状態と項目が矛盾しない（`done` には `resolution` がある、など） |
| D-13 | `config/sources.json` で `enabled: true` の情報源には `rights.checkedAt` がある |
| D-14 | `data/`、`state/`、`config/` に機密情報らしい文字列がない（`sk-ant-`、`ghp_`、`github_pat_`、`-----BEGIN`、`AKIA` で始まる値など） |

## 4.11 データの例（架空の作品）

`data/games/g_000001.json`

```json
{
  "schemaVersion": 1,
  "id": "g_000001",
  "status": "published",
  "title": { "display": "ランタンタイド", "original": "Lantern Tide", "originalLang": "en" },
  "aliases": [
    { "value": "ランタン・タイド", "lang": "ja", "kind": "localized" },
    { "value": "Lantern Tide", "lang": "en", "kind": "romanization" }
  ],
  "externalIds": { "steamAppId": 900001 },
  "associatedApps": [
    { "store": "steam", "id": "900002", "kind": "demo", "title": "Lantern Tide Demo" }
  ],
  "officialUrl": "https://lanterntide.example.com/",
  "developerIds": ["dev_000001"],
  "publisherIds": ["dev_000001"],
  "indie": {
    "assessment": "indie",
    "reasons": [
      {
        "code": "self-published",
        "evidence": [
          {
            "kind": "store",
            "url": "https://store.steampowered.com/app/900001/",
            "retrievedAt": "2026-10-20T00:20:11Z",
            "locator": "steam:appdetails.developers,publishers",
            "originKey": "store:steam"
          }
        ]
      }
    ],
    "assessedAt": "2026-10-20T00:25:00Z"
  },
  "identityEvidence": [],
  "createdAt": "2026-10-20T00:25:00Z",
  "addedAt": "2026-10-20",
  "updatedAt": "2026-10-27T00:31:40Z",
  "createdByRun": "local-seed"
}
```

`data/claims/g_000001.json`（延期の例。抜粋）

```json
{
  "schemaVersion": 1,
  "gameId": "g_000001",
  "claims": [
    {
      "id": "c_5d1e0a9b3c7f2e41",
      "gameId": "g_000001",
      "scope": { "platform": "pc", "region": "global" },
      "basis": "fact",
      "evidence": [
        {
          "kind": "official",
          "url": "https://lanterntide.example.com/news/release-window",
          "publishedAt": "2026-06-10",
          "retrievedAt": "2026-06-11T00:18:02Z",
          "quote": "Lantern Tide launches on PC in Winter 2026.",
          "originKey": "official:lanterntide.example.com"
        }
      ],
      "asOf": "2026-06-10",
      "status": "superseded",
      "statusReason": "newer-source",
      "supersededBy": "c_8a2f4c6e1b9d0375",
      "adoptedAt": "2026-06-11T00:30:00Z",
      "createdAt": "2026-06-11T00:30:00Z",
      "updatedAt": "2026-10-27T00:31:40Z",
      "lastCheckedAt": "2026-10-01T00:20:00Z",
      "createdBy": "llm",
      "createdByRun": "18803311",
      "field": "release",
      "value": { "status": "upcoming", "date": { "precision": "season", "year": 2026, "season": "winter" }, "rawText": "Winter 2026" }
    },
    {
      "id": "c_8a2f4c6e1b9d0375",
      "gameId": "g_000001",
      "scope": { "platform": "pc", "region": "global" },
      "basis": "fact",
      "evidence": [
        {
          "kind": "official",
          "url": "https://lanterntide.example.com/news/new-release-window",
          "publishedAt": "2026-10-24",
          "retrievedAt": "2026-10-27T00:22:15Z",
          "quote": "we have decided to move the PC launch of Lantern Tide to Spring 2027",
          "originKey": "official:lanterntide.example.com"
        }
      ],
      "asOf": "2026-10-24",
      "status": "adopted",
      "statusReason": "newer-source",
      "supersedes": ["c_5d1e0a9b3c7f2e41"],
      "adoptedAt": "2026-10-27T00:31:40Z",
      "createdAt": "2026-10-27T00:31:40Z",
      "updatedAt": "2026-10-27T00:31:40Z",
      "lastCheckedAt": "2026-10-27T00:22:15Z",
      "createdBy": "llm",
      "createdByRun": "19533107",
      "field": "release",
      "value": { "status": "upcoming", "date": { "precision": "season", "year": 2027, "season": "spring" }, "rawText": "Spring 2027" }
    }
  ]
}
```

（例の ID は説明用の値で、§4.2.1 の計算結果ではない。キーの順番は `ClaimBase` の後に `field` と `value` が来る。`discriminatedUnion` の各要素で `extend` した順になるためである。）

`data/articles/a_3f9c2e1b7d4a5c60.json`

```json
{
  "schemaVersion": 1,
  "id": "a_3f9c2e1b7d4a5c60",
  "url": "https://news.example.jp/articles/2026/10/25/lantern-tide-delay?utm_source=rss",
  "canonicalUrl": "https://news.example.jp/articles/2026/10/25/lantern-tide-delay",
  "urlAliases": ["https://news.example.jp/articles/2026/10/25/lantern-tide-delay?utm_source=rss"],
  "sourceId": "example-news-jp",
  "outlet": { "name": "Example News", "domain": "news.example.jp" },
  "title": "海洋探索ADV『Lantern Tide』PC版の発売が2027年春に延期",
  "lang": "ja",
  "kind": "news",
  "publishedAt": "2026-10-25T03:00:00Z",
  "retrievedAt": "2026-10-27T00:21:40Z",
  "summaryJa": "PC版の発売時期を2026年冬から2027年春へ変更したことを伝えるニュース。",
  "games": [{ "gameId": "g_000001", "role": "primary" }],
  "status": "active",
  "createdAt": "2026-10-27T00:31:40Z",
  "updatedAt": "2026-10-27T00:31:40Z",
  "createdByRun": "19533107"
}
```

/** サイト名や説明文。SITE_URL と BASE_PATH は環境変数から astro.config.mjs で設定する */
export const site = {
  name: 'Indie Atlas',
  nameJa: 'インディーアトラス',
  tagline: 'まだ知らないインディーゲームに出会う',
  description:
    'Indie Atlas は、インディーゲームのライブラリ兼ショーケースです。出典に基づく作品の情報、関連記事、テーマ別のコレクションから、遊び方や雰囲気で作品を探せます。',
  // 訂正依頼の窓口（D-10 の既定値: リポジトリが公開なら GitHub の Issue のフォーム）
  correctionUrl: 'https://github.com/uakihir0/indieatlas/issues/new?template=correction.yml',
  repositoryUrl: 'https://github.com/uakihir0/indieatlas',
};

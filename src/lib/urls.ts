/** サイト内の URL はすべてここから作る（08 §8.2） */
function normalizeBase(base: string): string {
  return base.endsWith('/') ? base : `${base}/`;
}

const base = normalizeBase(import.meta.env.BASE_URL);
const site = import.meta.env.SITE;

export const BASE_PATH = base;

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
  articleKind: (kind: string, page = 1) =>
    page === 1 ? `articles/kind/${kind}/` : `articles/kind/${kind}/page/${page}/`,
  collections: () => 'collections/',
  collection: (id: string) => `collections/${id}/`,
  events: () => 'events/',
  developers: () => 'developers/',
  developer: (id: string) => `developers/${id}/`,
  publishers: () => 'publishers/',
  publisher: (id: string) => `publishers/${id}/`,
  about: () => 'about/',
};

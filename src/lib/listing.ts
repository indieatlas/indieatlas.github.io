/** 一覧の1ページあたりの件数（02 §2.3.4、§2.3.6） */
export const GAMES_PER_PAGE = 48;
export const ARTICLES_PER_PAGE = 30;

export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage));
}

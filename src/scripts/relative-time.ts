/**
 * time[data-relative] を「3時間前」「2日前」のような表示にする。7日より前なら日付のまま。
 * 静的なページなので、表示の時点で計算する。JS がなければビルド時の日付が出る
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function relativeLabel(iso: string, now: number): string | undefined {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  const d = now - t;
  if (d < 0) return undefined;
  if (d < HOUR) return `${Math.max(1, Math.floor(d / 60_000))}分前`;
  if (d < DAY) return `${Math.floor(d / HOUR)}時間前`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}日前`;
  return undefined;
}

export function applyRelativeTimes(root: ParentNode = document, now = Date.now()): void {
  for (const el of root.querySelectorAll<HTMLTimeElement>('time[data-relative]')) {
    const label = relativeLabel(el.dateTime, now);
    if (label) el.textContent = label;
  }
}

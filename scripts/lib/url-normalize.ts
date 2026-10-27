const DROP_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref',
  'ref_src',
  'cmpid',
  'spm',
  'amp',
]);

/** 記事の重複防止と ID の計算に使う URL の正規化（04 §4.2.2） */
export function normalizeUrl(input: string): string {
  const u = new URL(input);
  // 1. スキームとホスト名を小文字にし、http は https に揃える
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`unsupported protocol: ${input}`);
  u.protocol = 'https:';
  // 2. 先頭の www.、m.、amp. を外す
  u.hostname = u.hostname.toLowerCase().replace(/^(?:www|m|amp)\./, '');
  // 3. 既定のポートを外す
  if (u.port === '80' || u.port === '443') u.port = '';
  // 4. フラグメントを外す
  u.hash = '';
  // 5〜6. 追跡用のパラメーターを外し、残りを名前の辞書順に並べる
  const params = [...u.searchParams.entries()].filter(([name, value]) => {
    const n = name.toLowerCase();
    if (n.startsWith('utm_')) return false;
    if (DROP_PARAMS.has(n)) return false;
    if (n === 'output' && value.toLowerCase() === 'amp') return false;
    return true;
  });
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  // 7. 連続したスラッシュをまとめ、末尾の /amp/ と /amp を外す
  let path = u.pathname.replace(/\/{2,}/g, '/').replace(/\/amp\/?$/, '/');
  // 8. ルート以外では末尾のスラッシュを外す
  if (path.length > 1) path = path.replace(/\/+$/, '');
  if (path === '') path = '/';
  const query = params.length
    ? '?' + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';
  return `https://${u.host}${path}${query}`;
}

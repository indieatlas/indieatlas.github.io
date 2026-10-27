/**
 * オブジェクトのキーを辞書順に並べ、undefined の項目を除いてから JSON.stringify する（04 §4.2.1）。
 * 配列の順番は保つ。
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sortKeys(v)));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** 指定したキーを、どの深さにあっても取り除いた複製を返す */
export function omitKeysDeep(value: unknown, keys: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => omitKeysDeep(v, keys));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (keys.includes(k)) continue;
      out[k] = omitKeysDeep(v, keys);
    }
    return out;
  }
  return value;
}

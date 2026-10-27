/**
 * 現在時刻はこのモジュールの now() だけから得る（04 §4.1.2）。
 * 環境変数 INDIEATLAS_NOW（ISO 8601）で固定できる。
 */
export function now(): Date {
  const fixed = process.env.INDIEATLAS_NOW;
  if (fixed) {
    const d = new Date(fixed);
    if (Number.isNaN(d.getTime())) throw new Error(`INDIEATLAS_NOW is not a valid date: ${fixed}`);
    return d;
  }
  return new Date();
}

/** UTC の ISO 8601（秒まで、末尾 Z） */
export function toIsoDateTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function nowIso(): string {
  return toIsoDateTime(now());
}

/** 日本時間の暦日（YYYY-MM-DD） */
export function toJstDate(d: Date): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function todayJst(): string {
  return toJstDate(now());
}

/** 日本時間の暦月（YYYY-MM） */
export function monthJst(d: Date = now()): string {
  return toJstDate(d).slice(0, 7);
}

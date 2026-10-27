import type { PartialDate, Platform, ReleaseStatus, Store } from '../../schema/common.ts';
import { format } from '../lib/partial-date.ts';

/** 発売状況のラベル（02 §2.4.2） */
export function releaseLabel(status: ReleaseStatus, date?: PartialDate): string {
  switch (status) {
    case 'released':
      return date ? `発売中（${format(date)} 発売）` : '発売中';
    case 'early-access':
      return '早期アクセス中';
    case 'upcoming':
      return date ? `発売予定（${format(date)}）` : '発売予定';
    case 'tba':
      return '発売日未定';
    case 'cancelled':
      return '開発中止';
    case 'delisted':
      return '配信終了';
  }
}

/** 基本情報の表などで使う短い表記 */
export function releaseEntryLabel(status: ReleaseStatus, date?: PartialDate): string {
  switch (status) {
    case 'released':
      return date ? `${format(date)} 発売` : '発売済み';
    case 'early-access':
      return date ? `${format(date)} から早期アクセス` : '早期アクセス中';
    case 'upcoming':
      return date ? `${format(date)} 発売予定` : '発売予定（時期未定）';
    case 'tba':
      return '発売日未定';
    case 'cancelled':
      return '開発中止';
    case 'delisted':
      return '配信終了';
  }
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  pc: 'Windows',
  mac: 'Mac',
  linux: 'Linux',
  switch: 'Nintendo Switch',
  switch2: 'Nintendo Switch 2',
  ps5: 'PlayStation 5',
  ps4: 'PlayStation 4',
  'xbox-series': 'Xbox Series X|S',
  'xbox-one': 'Xbox One',
  ios: 'iOS',
  android: 'Android',
  browser: 'ブラウザ',
  'meta-quest': 'Meta Quest',
  other: 'その他',
};

export const STORE_LABELS: Record<Store, string> = {
  steam: 'Steam',
  itch: 'itch.io',
  epic: 'Epic Games Store',
  gog: 'GOG',
  'nintendo-eshop': 'ニンテンドーeショップ',
  'playstation-store': 'PlayStation Store',
  'microsoft-store': 'Microsoft Store',
  'app-store': 'App Store',
  'google-play': 'Google Play',
  'meta-quest-store': 'Meta Quest Store',
  humble: 'Humble Store',
  official: '公式サイト',
  other: 'その他のストア',
};

import fs from 'node:fs';
import path from 'node:path';
import { AmazonRanking } from '../../schema/amazon.ts';
import { AMAZON_RANKING_FILE } from '../build/prepare-site.ts';
import { nowIso } from '../lib/clock.ts';
import { rankingFromItems, type CreatorsItem } from '../sources/amazon.ts';

// E2E テスト用に、架空の商品の売れ筋を .generated/amazon/ranking.json に書く（10 §10.5.1）。
// 実際の API の応答と同じ形から rankingFromItems を通すので、除外の規則も確かめられる
const titles = [
  'ランタンの森 - Switch 2',
  'ニンテンドープリペイド番号 3000円',
  '星屑のアトリエ - PS5',
  '霧の灯台 - Switch',
  'PlayStation Store チケット 5000円',
  '潮騒の街 - PS4',
  'コントローラー 充電スタンド',
  '空飛ぶ郵便局 - Switch',
  '雪の鐘 - Switch 2',
  '砂時計の迷宮 - PS5',
  '小さな鍛冶屋 - Switch',
  '月夜の図書館 - PS5',
  '帆船の庭 - Switch',
];
const items: CreatorsItem[] = titles.map((title, i) => {
  const asin = `B0FAKE${String(i).padStart(4, '0')}`;
  return {
    asin,
    detailPageURL: `https://www.amazon.co.jp/dp/${asin}?tag=pspken-22`,
    itemInfo: { title: { displayValue: title }, classifications: { productGroup: { displayValue: 'Video Games' } } },
    browseNodeInfo: { websiteSalesRank: { salesRank: (i + 1) * 10 } },
  };
});
const ranking = AmazonRanking.parse(rankingFromItems(items, nowIso()));
fs.mkdirSync(path.dirname(AMAZON_RANKING_FILE), { recursive: true });
fs.writeFileSync(AMAZON_RANKING_FILE, JSON.stringify(ranking, null, 2) + '\n');
console.log(`fake-amazon-ranking: ${ranking.items.length} item(s)`);

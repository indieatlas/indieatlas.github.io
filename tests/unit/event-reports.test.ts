import { describe, expect, it } from 'vitest';
import type { IndieEvent } from '../../schema/event.ts';
import type { FetchResult, HttpClient } from '../../scripts/fetch/http.ts';
import {
  blogPlatform,
  collectEventReports,
  fillReportImages,
  hatenaSearchUrl,
  isReportOf,
  mentionsEvent,
  noteHashtagFeedUrl,
  noteHashtags,
  parseBlogPage,
  parseHatenaSearchFeed,
  parseNoteHashtagFeed,
  reportImage,
  reportTargets,
} from '../../scripts/pipeline/event-reports.ts';

// 架空の催し（10 §10.5.1）
const ev: IndieEvent = {
  schemaVersion: 1,
  id: 'ev_0000000000000001',
  status: 'scheduled',
  name: 'ランタン祭14',
  aliases: ['ラン祭14'],
  kind: 'exhibition',
  format: 'in-person',
  start: { precision: 'day', year: 2026, month: 10, day: 31 },
  location: { venue: '架空ホール', city: '東京都', country: 'JP' },
  url: 'https://lantern.example/fest/',
  summary: '架空のインディーゲームの展示会。個人と小規模なチームの作品を試遊できる。',
  games: [],
  evidence: [
    {
      kind: 'official',
      url: 'https://lantern.example/fest/',
      retrievedAt: '2026-10-01T00:00:00Z',
      quote: '2026年10月31日開催',
      originKey: 'official:lantern.example',
    },
  ],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  createdBy: 'agent',
  createdByRun: 'test',
};

const noteRss = `<?xml version="1.0"?><rss xmlns:note="https://note.com"><channel><title>#ランタン祭14タグ</title>
<item><title>ランタン祭１４に行ってきた</title><description><![CDATA[<p>試遊したゲームの感想</p>]]></description>
<media:thumbnail>https://assets.st-note.com/production/uploads/images/1/eyecatch.png?width=800</media:thumbnail>
<note:creatorName>架空の書き手</note:creatorName><pubDate>Sun, 01 Nov 2026 20:00:00 +0900</pubDate>
<link>https://note.com/writer/n/n0123456789ab?magazine_key=x</link></item>
<item><title>ランタン祭14に出展します</title><pubDate>Thu, 29 Oct 2026 20:00:00 +0900</pubDate>
<link>https://note.com/writer/n/n0123456789ac</link></item>
<item><title>ランタン祭15の出展が決まった</title><pubDate>Mon, 02 Nov 2026 20:00:00 +0900</pubDate>
<link>https://note.com/writer/n/n0123456789ad</link></item>
<item><title>出展者向けの身だしなみ講座</title><pubDate>Mon, 02 Nov 2026 20:00:00 +0900</pubDate>
<link>https://note.com/writer/n/n0123456789ae</link></item>
</channel></rss>`;

const hatenaRss = `<rdf:RDF><item rdf:about="https://diary.hatenablog.com/entry/1"><title>ランタン祭14 試遊メモ - 架空日記</title>
<link>https://diary.hatenablog.com/entry/1</link><dc:date>2026-11-02T03:00:00Z</dc:date></item>
<item><title>ランタン祭14 試遊レポート - 架空ニュース</title><link>https://news.example.jp/lantern14</link>
<dc:date>2026-11-02T03:00:00Z</dc:date></item></rdf:RDF>`;

const blogHtml = `<html><head><meta property="og:title" content="ランタン祭14 試遊メモ">
<meta property="og:site_name" content="架空日記"><meta property="og:image" content="https://diary.example/ogp.png"><meta property="article:published_time" content="2026-11-01T21:00:00+09:00">
</head></html>`;

function fake(routes: Record<string, string>): HttpClient & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    async get(url: string): Promise<FetchResult> {
      requested.push(url);
      const text = routes[url];
      const bytes = new TextEncoder().encode(text ?? '');
      return {
        url,
        status: text ? 200 : 404,
        contentType: '',
        text: text ?? '',
        bytes,
        fetchHash: '',
        retrievedAt: new Date(),
      };
    },
  };
}

describe('催しの感想（06 §6.13.8）', () => {
  it('この回の名前と、番号のない呼び名を見分ける', () => {
    expect(mentionsEvent(ev, '【ランタン祭14】準備と当日の振り返り')).toBe('edition');
    expect(mentionsEvent(ev, 'ラン祭１４ 試遊プレイ感想')).toBe('edition');
    expect(mentionsEvent(ev, '10月の日記：ランタン祭など')).toBe('series');
    expect(mentionsEvent(ev, 'ランタン祭15の出展が決まった')).toBeUndefined();
    expect(mentionsEvent(ev, '出展者向けの身だしなみ講座')).toBeUndefined();
  });

  it('ハッシュタグは名前と番号を外した名前', () => {
    expect(noteHashtags(ev)).toEqual(['ランタン祭14', 'ランタン祭', 'ラン祭14']);
  });

  it('始まる前と、終わって30日より後の記事は感想にしない', () => {
    const c = { title: 'ランタン祭14 行ってきた', description: '遊んだゲームのまとめ' };
    expect(isReportOf(ev, c, '2026-10-30T12:00:00Z')).toBe(false);
    expect(isReportOf(ev, c, '2026-10-31T03:00:00Z')).toBe(true);
    expect(isReportOf(ev, c, '2026-11-30T03:00:00Z')).toBe(true);
    expect(isReportOf(ev, c, '2026-12-01T03:00:00Z')).toBe(false);
    // 番号のない呼び名だけなら14日まで
    const s = { title: 'ランタン祭に行った', description: '試遊の記録' };
    expect(isReportOf(ev, s, '2026-11-10T03:00:00Z')).toBe(true);
    expect(isReportOf(ev, s, '2026-11-20T03:00:00Z')).toBe(false);
    // ゲームの話でないもの（同人誌の即売会の買い物の記録など）は除く
    expect(isReportOf(ev, { title: 'ランタン祭14 戦利品' }, '2026-11-01T03:00:00Z')).toBe(false);
  });

  it('会場の催しで、終わってから30日以内のものだけを探す', () => {
    expect(reportTargets([ev], '2026-11-07').map((e) => e.id)).toEqual([ev.id]);
    expect(reportTargets([ev], '2026-10-30')).toEqual([]);
    expect(reportTargets([ev], '2026-12-01')).toEqual([]);
    expect(reportTargets([{ ...ev, format: 'online', location: undefined }], '2026-11-07')).toEqual([]);
  });

  it('note の RSS を読み、URL から問い合わせを外す', () => {
    const items = parseNoteHashtagFeed(noteRss);
    expect(items[0]).toEqual({
      url: 'https://note.com/writer/n/n0123456789ab',
      title: 'ランタン祭１４に行ってきた',
      author: '架空の書き手',
      image: 'https://assets.st-note.com/production/uploads/images/1/eyecatch.png?width=640',
      publishedAt: '2026-11-01T11:00:00Z',
      description: '試遊したゲームの感想',
      platform: 'note',
      foundVia: 'note-hashtag',
    });
  });

  it('画像を設定していない記事に付く共通の画像は使わない', () => {
    expect(
      reportImage('https://assets.st-note.com/poc-image/manual/note-common-images/production/svg/production.png'),
    ).toBeUndefined();
    expect(reportImage('https://blog.example/images/noimage.png')).toBeUndefined();
  });

  it('画像のない感想は、記事のページの OGP 画像で補う', async () => {
    const http = fake({ 'https://diary.hatenablog.com/entry/1': blogHtml });
    const report = {
      url: 'https://diary.hatenablog.com/entry/1',
      title: 'ランタン祭14 試遊メモ',
      platform: 'hatena-blog' as const,
      foundVia: 'hatena-bookmark' as const,
      foundAt: '2026-11-02T00:00:00Z',
      status: 'shown' as const,
    };
    expect(await fillReportImages(http, [report], '2026-11-07T00:00:00Z')).toEqual([
      { url: report.url, image: 'https://diary.example/ogp.png' },
    ]);
    // 見つけてから30日を過ぎたものは試さない
    expect(await fillReportImages(http, [report], '2026-12-20T00:00:00Z')).toEqual([]);
  });

  it('はてなブックマークの検索からは個人のブログだけを拾う', () => {
    expect(parseHatenaSearchFeed(hatenaRss).map((c) => c.url)).toEqual(['https://diary.hatenablog.com/entry/1']);
    expect(blogPlatform('https://news.example.jp/a')).toBeUndefined();
    expect(blogPlatform('https://someone.hateblo.jp/entry/x')).toBe('hatena-blog');
    expect(parseBlogPage(blogHtml)).toEqual({
      image: 'https://diary.example/ogp.png',
      publishedAt: '2026-11-01T12:00:00Z',
      author: '架空日記',
      title: 'ランタン祭14 試遊メモ',
    });
  });

  it('集めた候補から、この回の感想だけを返す。登録済みの URL は拾い直さない', async () => {
    const http = fake({
      [noteHashtagFeedUrl('ランタン祭14')]: noteRss,
      [hatenaSearchUrl('ランタン祭14')]: hatenaRss,
      'https://diary.hatenablog.com/entry/1': blogHtml,
    });
    const known = new Map([[ev.id, new Set(['https://note.com/writer/n/n0123456789ac'])]]);
    const r = await collectEventReports(http, [ev], known, '2026-11-07T00:00:00Z');
    expect(r.errors).toEqual([]);
    expect(r.added.map((a) => [a.report.url, a.report.author, a.report.publishedAt])).toEqual([
      ['https://note.com/writer/n/n0123456789ab', '架空の書き手', '2026-11-01T11:00:00Z'],
      ['https://diary.hatenablog.com/entry/1', '架空日記', '2026-11-01T12:00:00Z'],
    ]);
    expect(r.added[1]!.report.title).toBe('ランタン祭14 試遊メモ');
    expect(r.added.map((a) => a.report.image)).toEqual([
      'https://assets.st-note.com/production/uploads/images/1/eyecatch.png?width=640',
      'https://diary.example/ogp.png',
    ]);
  });
});

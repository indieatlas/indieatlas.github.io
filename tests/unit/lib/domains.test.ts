import { describe, expect, it } from 'vitest';
import {
  canBeOfficialSite,
  evidenceKindForUrl,
  originKeyFor,
  registrableDomain,
} from '../../../scripts/lib/domains.ts';

describe('domains', () => {
  it.each([
    ['https://news.example.jp/a', 'example.jp'],
    ['https://www.game.example.co.jp/a', 'example.co.jp'],
    ['https://smallharbor.itch.io/lantern-tide', 'smallharbor.itch.io'],
    ['store.steampowered.com', 'steampowered.com'],
  ])('registrableDomain(%s) = %s', (input, expected) => {
    expect(registrableDomain(input)).toBe(expected);
  });

  it('根拠の種類（05 §5.4.4）', () => {
    const ctx = {
      officialUrls: ['https://lanterntide.example.com/'],
      sources: [{ homepage: 'https://events.example.org/', evidenceKind: 'event' as const }],
    };
    expect(evidenceKindForUrl('https://lanterntide.example.com/news/1', ctx)).toBe('official');
    expect(evidenceKindForUrl('https://store.steampowered.com/app/900001/', ctx)).toBe('store');
    expect(evidenceKindForUrl('https://events.example.org/2026', ctx)).toBe('event');
    expect(evidenceKindForUrl('https://news.example.jp/a', ctx)).toBe('media');
  });

  it('独立性のキー（04 §4.5.3）', () => {
    expect(originKeyFor('store', 'https://store.steampowered.com/app/1/')).toBe('store:steam');
    expect(originKeyFor('media', 'https://www.news.example.jp/a')).toBe('media:example.jp');
    expect(originKeyFor('media', 'https://news.example.jp/a', 'https://pr.example.com/x')).toBe(
      'pr:https://pr.example.com/x',
    );
  });

  it('ストアと SNS は公式サイトのキーにしない', () => {
    expect(canBeOfficialSite('https://store.steampowered.com/app/1/')).toBe(false);
    expect(canBeOfficialSite('https://x.com/dev')).toBe(false);
    expect(canBeOfficialSite('https://lanterntide.example.com/')).toBe(true);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { FetchLogEntry } from '../../schema/research-output.ts';
import type { Fetcher } from '../fetch/fetcher.ts';
import type { HttpClient } from '../fetch/http.ts';
import { toIsoDateTime } from '../lib/clock.ts';
import { registrableDomain } from '../lib/domains.ts';
import type { RepoData } from '../lib/repo-io.ts';
import { strongKeys } from '../lib/strong-keys.ts';
import { normalizeTitle } from '../lib/text-normalize.ts';
import type { ToolSpec } from '../llm/client.ts';
import {
  fetchAppDetails,
  isAdultSexualContent,
  platformsFrom,
  playerModesFrom,
  releaseFrom,
  stableImageUrl,
  storeUrl,
} from '../sources/steam.ts';

/** LLM に渡すツール（06 §6.5.3）。取得のたびに取得ログ（out/fetch-log/）を書く */

export interface ToolEnv {
  repo: RepoData;
  fetcher: Fetcher;
  steamHttp?: HttpClient; // S1 の情報源が有効な場合だけ
  logDir: string;
  nextFetchId: () => string;
}

export interface TaskTools {
  tools: ToolSpec<any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  fetched: () => number;
}

const MAX_STEAM_PER_TASK = 8; // get_steam_app と search_steam の合計
const MAX_LINKS = 40;

/** 外部の文章を <external_content> で囲む。閉じタグは無害な形に置き換える（06 §6.10） */
export function wrapExternal(attrs: Record<string, string>, text: string): string {
  const safe = text.replace(/<\/?\s*external_content[^>]*>/gi, (m) => m.replace(/</g, '＜').replace(/>/g, '＞'));
  const a = Object.entries(attrs)
    .map(([k, v]) => `${k}="${v.replace(/"/g, '&quot;')}"`)
    .join(' ');
  return `<external_content ${a}>\n${safe}\n</external_content>`;
}

function writeLog(env: ToolEnv, entry: FetchLogEntry): void {
  fs.mkdirSync(env.logDir, { recursive: true });
  fs.writeFileSync(
    path.join(env.logDir, `${entry.fetchId}.json`),
    JSON.stringify(FetchLogEntry.parse(entry), null, 1) + '\n',
  );
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function gameSummary(repo: RepoData, id: string) {
  const g = repo.games.find((x) => x.id === id)!;
  const devs = g.developerIds.map((d) => repo.developers.find((x) => x.id === d)?.name.display).filter(Boolean);
  return {
    gameId: g.id,
    status: g.status,
    display: g.title.display,
    original: g.title.original,
    aliases: g.aliases.map((a) => a.value),
    developers: devs,
    strongKeys: strongKeys(g),
  };
}

export function findGames(repo: RepoData, query: string) {
  const q = normalizeTitle(query);
  if (!q) return [];
  const scored: { id: string; score: number }[] = [];
  for (const g of repo.games.filter((x) => x.status !== 'merged')) {
    const names = [g.title.display, g.title.original, ...g.aliases.map((a) => a.value)].map(normalizeTitle);
    const devs = g.developerIds.flatMap((d) => {
      const dev = repo.developers.find((x) => x.id === d);
      return dev ? [dev.name.display, dev.name.original, ...dev.aliases].map(normalizeTitle) : [];
    });
    let score = 0;
    if (names.includes(q)) score = 3;
    else if (names.some((n) => n.length >= 2 && (n.includes(q) || q.includes(n)))) score = 2;
    else if (devs.some((d) => d.length >= 2 && (d === q || d.includes(q)))) score = 1;
    if (score) scored.push({ id: g.id, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    .slice(0, 10)
    .map((s) => gameSummary(repo, s.id));
}

export function getGame(repo: RepoData, id: string) {
  const g = repo.games.find((x) => x.id === id);
  if (!g) return undefined;
  const claims = (repo.claims.get(id)?.claims ?? [])
    .filter((c) => c.status === 'adopted' || c.status === 'candidate' || c.status === 'conflicted')
    .map((c) => ({
      claimId: c.id,
      field: c.field,
      scope: c.scope,
      value: c.value,
      status: c.status,
      basis: c.basis,
      asOf: c.asOf,
      evidenceUrls: c.evidence.map((e) => e.url).slice(0, 3),
    }));
  return {
    ...gameSummary(repo, id),
    officialUrl: g.officialUrl,
    externalIds: g.externalIds,
    associatedApps: g.associatedApps,
    indie: { assessment: g.indie.assessment, reasons: g.indie.reasons.map((r) => r.code) },
    claims,
    articles: repo.articles
      .filter((a) => a.games.some((x) => x.gameId === id))
      .slice(-10)
      .map((a) => ({ title: a.title, url: a.canonicalUrl, publishedAt: a.publishedAt })),
    openTasks: repo.tasks.tasks
      .filter((t) => t.target.gameId === id && t.status === 'open')
      .map((t) => ({ type: t.type, goal: t.goal })),
  };
}

export function createTaskTools(env: ToolEnv, task: { id: string }, maxFetches: number): TaskTools {
  let fetches = 0;
  let steamCalls = 0;
  const forbidden = new Set(
    env.repo.sources.sources.filter((s) => !s.rights.allowFetch).map((s) => registrableDomain(s.homepage)),
  );

  const fetchUrl: ToolSpec<{ url: string }> = {
    name: 'fetch_url',
    description:
      'URL のページを取得し、本文、タイトル、canonical、掲載日時、ページ内のリンクを返す。根拠にできるのは、このツールか get_steam_app で取得したページだけ。',
    input: z.object({ url: z.string().url() }),
    run: async ({ url }) => {
      if (fetches >= maxFetches) return { ok: false, error: `fetch limit reached (${maxFetches})` };
      if (forbidden.has(registrableDomain(url))) return { ok: false, error: 'this site does not allow fetching' };
      fetches++;
      const page = await env.fetcher.fetch(url);
      const fetchId = env.nextFetchId();
      const text = page.text.slice(0, env.repo.runtime.fetch.maxTextChars);
      writeLog(env, {
        schemaVersion: 1,
        fetchId,
        taskId: task.id,
        tool: 'fetch_url',
        url,
        finalUrl: page.finalUrl,
        status: page.status,
        retrievedAt: page.retrievedAt,
        contentType: page.contentType.slice(0, 200),
        ...(page.fetchHash ? { fetchHash: page.fetchHash } : {}),
        ...(page.title ? { title: page.title.slice(0, 400) } : {}),
        ...(page.canonicalUrl ? { canonicalUrl: page.canonicalUrl } : {}),
        ...(page.publishedAt ? { publishedAt: page.publishedAt } : {}),
        ...(page.lang ? { lang: page.lang.slice(0, 20) } : {}),
        text,
        noai: page.noai,
        ...(page.blocked ? { blocked: page.blocked } : {}),
      });
      if (page.blocked || page.status < 200 || page.status >= 300) {
        return {
          ok: true,
          content: JSON.stringify({
            fetchId,
            status: page.status,
            finalUrl: page.finalUrl,
            usable: false,
            reason: page.blocked ?? page.error ?? `HTTP ${page.status}`,
          }),
        };
      }
      const meta = {
        fetchId,
        status: page.status,
        finalUrl: page.finalUrl,
        title: page.title,
        canonicalUrl: page.canonicalUrl,
        publishedAt: page.publishedAt,
        lang: page.lang,
        links: page.links.slice(0, MAX_LINKS),
      };
      return {
        ok: true,
        content: `${JSON.stringify(meta)}\n${wrapExternal({ fetch_id: fetchId, url: page.finalUrl, retrieved_at: page.retrievedAt, lang: page.lang ?? '' }, text)}`,
      };
    },
  };

  const findGamesTool: ToolSpec<{ query: string }> = {
    name: 'find_games',
    description: '収録済みの作品（統合済みを除く）を名前や開発者名で探す。新しい作品を登録する前に必ず使う。',
    input: z.object({ query: z.string().min(1).max(120) }),
    run: async ({ query }) => ({ ok: true, content: JSON.stringify(findGames(env.repo, query)) }),
  };

  const getGameTool: ToolSpec<{ gameId: string }> = {
    name: 'get_game',
    description: '収録済みの作品の識別情報、採用済みと保留中の Claim（claimId 付き）、関連記事、未解決のタスクを返す。',
    input: z.object({ gameId: z.string().regex(/^g_\d{6}$/) }),
    run: async ({ gameId }) => {
      const g = getGame(env.repo, gameId);
      return g ? { ok: true, content: JSON.stringify(g) } : { ok: false, error: `${gameId} not found` };
    },
  };

  const tools: ToolSpec<any>[] = [fetchUrl, findGamesTool, getGameTool]; // eslint-disable-line @typescript-eslint/no-explicit-any

  if (env.steamHttp) {
    const http = env.steamHttp;
    const steamTool: ToolSpec<{ appId: number }> = {
      name: 'get_steam_app',
      description:
        'Steam のアプリの作品詳細（種類、本編の ID、名前、開発者、パブリッシャー、発売日、対応機種、ヘッダー画像、公式サイト、作品紹介）を返す。根拠では url に返された storeUrl を、locator に steam:appdetails.{項目} を書く。',
      input: z.object({ appId: z.number().int().positive() }),
      run: async ({ appId }) => {
        if (steamCalls >= MAX_STEAM_PER_TASK) return { ok: false, error: 'get_steam_app limit reached' };
        steamCalls++;
        try {
          const en = await fetchAppDetails(http, appId, 'english');
          const ja = await fetchAppDetails(http, appId, 'japanese').catch(() => undefined);
          const app = en.data;
          const header = app.header_image ? stableImageUrl(app.header_image) : undefined;
          const steam = {
            appId: app.steam_appid,
            type: app.type,
            ...(app.fullgame?.appid ? { fullgameAppId: Number(app.fullgame.appid) } : {}),
            name: app.name,
            ...(ja?.data.name && ja.data.name !== app.name ? { nameJa: ja.data.name } : {}),
            developers: app.developers ?? [],
            publishers: app.publishers ?? [],
            release: releaseFrom(app),
            platforms: platformsFrom(app),
            playerModes: playerModesFrom(app),
            ...(header ? { headerImage: header } : {}),
            ...(app.website ? { website: app.website } : {}),
            genres: (app.genres ?? []).map((g) => g.description),
            adult: isAdultSexualContent(app),
            storeUrl: storeUrl(app.steam_appid),
          };
          // 作品紹介（短い説明と「このゲームについて」）を英語と日本語で渡す。根拠の quote はこの本文と照合する
          const descEn = stripHtml(app.short_description ?? '');
          const descJa = stripHtml(ja?.data.short_description ?? '');
          const aboutEn = stripHtml(app.about_the_game ?? '').slice(0, 4000);
          const aboutJa = stripHtml(ja?.data.about_the_game ?? '').slice(0, 4000);
          const text = [app.name, steam.nameJa ?? '', descEn, descJa, aboutEn, aboutJa].filter(Boolean).join('\n');
          const fetchId = env.nextFetchId();
          writeLog(env, {
            schemaVersion: 1,
            fetchId,
            taskId: task.id,
            tool: 'get_steam_app',
            url: storeUrl(appId),
            finalUrl: storeUrl(app.steam_appid),
            status: 200,
            retrievedAt: toIsoDateTime(en.retrievedAt),
            contentType: 'application/json',
            fetchHash: en.fetchHash,
            title: app.name.slice(0, 400),
            text,
            noai: false,
            steam,
          });
          return {
            ok: true,
            content: `${JSON.stringify({ fetchId, ...steam })}\n${wrapExternal({ fetch_id: fetchId, url: steam.storeUrl, retrieved_at: toIsoDateTime(en.retrievedAt), lang: 'en,ja' }, text)}`,
          };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      },
    };
    tools.push(steamTool);
    // Steam ストア（S1）の中の名前の検索。Web 検索ではない（06 §6.9.4）。結果は手がかりで、根拠には get_steam_app を使う
    const searchTool: ToolSpec<{ term: string }> = {
      name: 'search_steam',
      description:
        'Steam ストアで作品の名前を検索し、候補の appId と名前を最大5件返す。記事にストアのリンクがないときに使う。根拠にはならないので、候補は get_steam_app で確かめる。',
      input: z.object({ term: z.string().min(1).max(120) }),
      run: async ({ term }) => {
        if (steamCalls >= MAX_STEAM_PER_TASK) return { ok: false, error: 'steam call limit reached' };
        steamCalls++;
        try {
          const res = await http.get(
            `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=jp&l=japanese`,
          );
          if (res.status !== 200) return { ok: false, error: `HTTP ${res.status}` };
          const items = ((JSON.parse(res.text) as { items?: { type: string; id: number; name: string }[] }).items ?? [])
            .filter((i) => i.type === 'app')
            .slice(0, 5)
            .map((i) => ({ appId: i.id, name: i.name }));
          return { ok: true, content: JSON.stringify(items) };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      },
    };
    tools.push(searchTool);
  }
  return { tools, fetched: () => fetches };
}

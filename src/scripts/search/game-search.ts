/**
 * 作品の検索 UI（02 §2.3.4、03 §3.6）。Pagefind を動的 import() で読み込む。
 * 状態は URL のクエリと同期し（history.replaceState）、共有と戻る操作に対応する。
 */
interface SearchConfig {
  base: string;
  pagefind: string;
  gamesPath: string;
  placeholder: string;
  genres: string[];
  labels: Record<string, Record<string, string>>;
}

interface PagefindResultData {
  url: string;
  meta: Record<string, string>;
  filters: Record<string, string[]>;
}
interface PagefindApi {
  options(o: Record<string, unknown>): Promise<void>;
  init(): Promise<void>;
  search(
    q: string | null,
    o?: { filters?: Record<string, unknown>; sort?: Record<string, 'asc' | 'desc'> },
  ): Promise<{ results: { id: string; data(): Promise<PagefindResultData> }[] }>;
}

export const FILTER_KEYS = ['tag', 'platform', 'release', 'ja', 'mode'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
export interface SearchState {
  q: string;
  sort: '' | 'updated' | 'added' | 'released' | 'popular';
  filters: Record<FilterKey, string[]>;
}

const PAGE = 24;
const ALL_RELEASE = ['released', 'early-access', 'upcoming', 'tba', 'cancelled', 'delisted', 'unknown'];

/** URL のクエリから状態を読む */
export function stateFromParams(params: URLSearchParams): SearchState {
  const filters = Object.fromEntries(
    FILTER_KEYS.map((k) => [k, params.getAll(k).filter(Boolean)]),
  ) as SearchState['filters'];
  const sort = params.get('sort');
  return {
    q: params.get('q') ?? '',
    sort: sort === 'updated' || sort === 'added' || sort === 'released' || sort === 'popular' ? sort : '',
    filters,
  };
}

/** 状態を URL のクエリにする（空の項目は書かない） */
export function paramsFromState(s: SearchState): URLSearchParams {
  const p = new URLSearchParams();
  if (s.q.trim()) p.set('q', s.q.trim());
  for (const k of FILTER_KEYS) for (const v of s.filters[k]) p.append(k, v);
  if (s.sort) p.set('sort', s.sort);
  return p;
}

/** 全角英数字などを揃えてから検索する（Pagefind は NFKC の違いを同一視しない） */
export function normalizeQuery(q: string): string {
  return q.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

/** Pagefind に渡す絞り込み。タグはすべてを満たし、それ以外はいずれかを満たす */
export function pagefindFilters(f: SearchState['filters']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.tag.length) out.tag = { all: f.tag };
  for (const k of ['platform', 'release', 'ja', 'mode'] as const) if (f[k].length) out[k] = { any: f[k] };
  return out;
}

const CJK = /[\u3040-\u30ff\u3400-\u9fff]/;
type Result = { id: string; data(): Promise<PagefindResultData & { content?: string }> };

const toKatakana = (s: string) => s.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/**
 * 日本語の分かち書きは、索引と入力で語の切れ目が一致しないことがある（例: 「ローグライク」が
 * 「ローグ」と「ライク」に分かれて索引される）。入力の先頭2文字で候補を広く取り、
 * 本文に入力の文字列そのものを含む作品を、通常の結果の後ろに加える。
 */
async function withSubstringMatches(
  pf: PagefindApi,
  q: string,
  filters: Record<string, unknown>,
  primary: Result[],
): Promise<Result[]> {
  const head = [...q.replace(/\s+/g, '')].slice(0, 2).join('');
  if (head.length < 2) return primary;
  const wide = (await pf.search(head, { filters })).results as Result[];
  const known = new Set(primary.map((r) => r.id));
  const needle = toKatakana(q.replace(/\s+/g, '')).toLowerCase();
  const extra: Result[] = [];
  for (const r of wide) {
    if (known.has(r.id)) continue;
    const d = await r.data();
    const hay = toKatakana(`${d.meta.title ?? ''} ${d.content ?? ''}`.replace(/\s+/g, '')).toLowerCase();
    if (hay.includes(needle)) extra.push(r);
  }
  return [...primary, ...extra];
}

const hasFilters = (s: SearchState) => FILTER_KEYS.some((k) => s.filters[k].length > 0);

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const PLATFORM_SHORT: Record<string, string> = {
  pc: 'Win',
  mac: 'Mac',
  linux: 'Linux',
  switch: 'Switch',
  switch2: 'Switch 2',
  ps5: 'PS5',
  ps4: 'PS4',
  'xbox-series': 'XSX|S',
  'xbox-one': 'XB1',
  ios: 'iOS',
  android: 'Android',
  browser: 'Web',
  'meta-quest': 'Quest',
  other: '他',
};
const JA_BADGE: Record<string, [string, string]> = {
  yes: ['full', '対応'],
  partial: ['partial', '一部'],
  planned: ['planned', '対応予定'],
  no: ['none', '非対応'],
  unknown: ['unknown', '不明'],
};

/** 検索結果のカード。GameCard.astro と同じクラスを使う */
export function renderCard(d: PagefindResultData, cfg: SearchConfig): string {
  const m = d.meta;
  const id = m.id ?? '';
  const platforms = (m.platforms ?? '').split(',').filter(Boolean);
  const shown = platforms.slice(0, 4);
  const [jaClass, jaLabel] = JA_BADGE[m.ja ?? 'unknown'] ?? JA_BADGE.unknown!;
  const release = (m.release ?? '発売時期不明')
    .replace(/^発売中（(.+) 発売）$/, '$1 発売')
    .replace(/^発売予定（(.+)）$/, '$1 発売予定');
  const added = (m.updated ?? m.added ?? '').replace(/-/g, '/');
  const img = m.image
    ? `<img src="${esc(m.image)}" alt="${esc(m.title ?? '')} の画像" width="460" height="215" loading="lazy" decoding="async" data-fallback style="view-transition-name: game-${esc(id)}">`
    : `<img src="${esc(cfg.placeholder)}" alt="" width="460" height="215" loading="lazy" decoding="async">`;
  const gi = cfg.genres.indexOf(m.genre ?? '');
  const genreColor = gi < 0 ? 'var(--genre-neutral)' : `var(--genre-c${gi})`;
  const prominence = m.prominence === 'landmark' || m.prominence === 'notable' ? m.prominence : '';
  const badge = prominence === 'landmark' ? `<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M2 5l3 3 3-5 3 5 3-3-1.2 7H3.2z"/><rect x="3" y="13" width="10" height="1.6"/></svg>殿堂入り` : prominence === 'notable' ? '人気' : '';
  return `<li class="card-slot"><a class="game-card${prominence ? ` is-${prominence}` : ''}" href="${esc(d.url)}" data-game-id="${esc(id)}" style="--genre-color: ${genreColor}">
<div class="game-card__media"><div class="game-image">${img}</div>${badge ? `<span class="game-card__badge">${badge}</span>` : ''}</div>
<div class="game-card__body">
<h2 class="game-card__title">${esc(m.title ?? '')}</h2>
${m.original && m.original !== m.title ? `<p class="game-card__original">${esc(m.original)}</p>` : ''}
<p class="game-card__developer${m.developer ? '' : ' is-unknown'}">${esc(m.developer || '開発者不明')}</p>
<p class="game-card__release"><span class="release-label">${esc(release)}</span></p>
<div class="game-card__meta">
<ul class="platform-list" aria-label="機種">${shown.map((p) => `<li title="${esc(cfg.labels.platform?.[p] ?? p)}"><span aria-hidden="true">${esc(PLATFORM_SHORT[p] ?? p)}</span><span class="visually-hidden">${esc(cfg.labels.platform?.[p] ?? p)}</span></li>`).join('')}${platforms.length > 4 ? `<li class="more">+${platforms.length - 4}</li>` : ''}</ul>
<span class="ja-badge ja-${jaClass}">日本語: ${jaLabel}</span>
</div>
${added ? `<p class="game-card__added">${m.updated ? '更新' : '収録'} <time datetime="${esc(m.updated ?? m.added!)}">${esc(added)}</time></p>` : ''}
</div></a></li>`;
}

export function defineGameSearch(): void {
  if (customElements.get('game-search')) return;
  customElements.define(
    'game-search',
    class extends HTMLElement {
      private cfg!: SearchConfig;
      private pagefind?: Promise<PagefindApi>;
      private form!: HTMLFormElement;
      private seq = 0;
      private all: { data(): Promise<PagefindResultData> }[] = [];
      private shownCount = 0;

      connectedCallback() {
        this.cfg = JSON.parse(this.querySelector('[data-search-config]')!.textContent!);
        this.form = this.querySelector('[data-search-form]')!;
        this.writeForm(stateFromParams(new URLSearchParams(location.search)));
        let timer: number | undefined;
        this.form.addEventListener('input', (e) => {
          const target = e.target as HTMLElement;
          window.clearTimeout(timer);
          timer = window.setTimeout(() => this.update(), target.id === 'search-input' ? 200 : 0);
        });
        this.form.addEventListener('submit', (e) => {
          e.preventDefault();
          this.toggleFilters(false);
          this.update();
        });
        this.querySelector('[data-open-filters]')!.addEventListener('click', () => this.toggleFilters());
        this.querySelector('[data-close-filters]')!.addEventListener('click', () => this.toggleFilters(false));
        this.querySelector('[data-clear-filters]')!.addEventListener('click', () => {
          const s = this.readForm();
          for (const k of FILTER_KEYS) s.filters[k] = [];
          this.writeForm(s);
          this.update();
        });
        window.addEventListener('popstate', () => {
          this.writeForm(stateFromParams(new URLSearchParams(location.search)));
          this.update(false);
        });
        this.update(false);
      }

      private toggleFilters(open?: boolean) {
        const panel = this.querySelector<HTMLElement>('[data-filters]')!;
        const next = open ?? !panel.hasAttribute('data-open');
        panel.toggleAttribute('data-open', next);
        this.querySelector('[data-open-filters]')!.setAttribute('aria-expanded', String(next));
      }

      private readForm(): SearchState {
        return stateFromParams(new URLSearchParams(new FormData(this.form) as unknown as Record<string, string>));
      }

      private writeForm(s: SearchState) {
        (this.form.elements.namedItem('q') as HTMLInputElement).value = s.q;
        (this.form.elements.namedItem('sort') as HTMLSelectElement).value = s.sort;
        for (const input of this.form.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) {
          input.checked = s.filters[input.name as FilterKey]?.includes(input.value) ?? false;
        }
      }

      private loadPagefind(): Promise<PagefindApi> {
        this.pagefind ??= (async () => {
          const pf = (await import(/* @vite-ignore */ this.cfg.pagefind)) as PagefindApi;
          await pf.options({ baseUrl: this.cfg.base });
          await pf.init();
          return pf;
        })();
        return this.pagefind;
      }

      private async update(push = true) {
        const state = this.readForm();
        const params = paramsFromState(state);
        if (push) {
          const qs = params.toString();
          history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
        }
        const count = FILTER_KEYS.reduce((n, k) => n + state.filters[k].length, 0);
        this.querySelector('[data-filter-count]')!.textContent = count ? String(count) : '';
        this.renderActive(state);

        const staticSlot = this.querySelector<HTMLElement>('[data-static-slot]')!;
        const results = this.querySelector<HTMLElement>('[data-results]')!;
        const status = this.querySelector<HTMLElement>('[data-status]')!;
        const q = normalizeQuery(state.q);
        if (!q && !hasFilters(state) && !state.sort) {
          staticSlot.hidden = false;
          results.hidden = true;
          status.textContent = '';
          return;
        }
        const seq = ++this.seq;
        status.textContent = '検索しています…';
        try {
          const pf = await this.loadPagefind();
          const sort = state.sort || (q ? '' : 'updated');
          // 入力も絞り込みもない並び替えだけの場合は、全作品に当てはまる条件で一覧を出す
          const filters = hasFilters(state) || q ? pagefindFilters(state.filters) : { release: { any: ALL_RELEASE } };
          const search = await pf.search(q || null, {
            filters,
            ...(sort ? { sort: { [sort]: 'desc' as const } } : {}),
          });
          if (seq !== this.seq) return;
          this.all = q && CJK.test(q) ? await withSubstringMatches(pf, q, filters, search.results) : search.results;
          if (seq !== this.seq) return;
          this.shownCount = 0;
          staticSlot.hidden = true;
          results.hidden = false;
          results.innerHTML = '';
          if (this.all.length === 0) {
            status.textContent = '条件に合う作品が見つかりませんでした。';
            this.renderEmpty(results, state);
            return;
          }
          status.textContent = `${this.all.length}作品が見つかりました。`;
          await this.renderMore(results);
        } catch (e) {
          if (seq !== this.seq) return;
          status.textContent = '検索を読み込めませんでした。下の一覧から探せます。';
          staticSlot.hidden = false;
          results.hidden = true;
          console.error(e);
        }
      }

      private async renderMore(results: HTMLElement) {
        const next = this.all.slice(this.shownCount, this.shownCount + PAGE);
        const data = await Promise.all(next.map((r) => r.data()));
        let list = results.querySelector('ul.game-grid');
        if (!list) {
          list = document.createElement('ul');
          list.className = 'game-grid';
          list.setAttribute('data-search-results', '');
          results.append(list);
        }
        list.insertAdjacentHTML('beforeend', data.map((d) => renderCard(d, this.cfg)).join(''));
        this.shownCount += next.length;
        results.querySelector('[data-more]')?.remove();
        if (this.shownCount < this.all.length) {
          const more = document.createElement('button');
          more.type = 'button';
          more.className = 'button more-button';
          more.dataset.more = '';
          more.textContent = `さらに表示（残り${this.all.length - this.shownCount}作品）`;
          more.addEventListener('click', () => this.renderMore(results));
          results.append(more);
        }
      }

      /** 0件のとき、条件を1つずつ外すボタンを出す */
      private renderEmpty(results: HTMLElement, state: SearchState) {
        const box = document.createElement('div');
        box.className = 'search-empty';
        box.innerHTML =
          '<p class="search-empty__title">条件に合う作品が見つかりませんでした</p><p>条件を減らすと見つかるかもしれません。</p>';
        const row = document.createElement('div');
        row.className = 'chip-row';
        if (state.q) row.append(this.removeButton(`「${state.q}」を外す`, () => this.setQuery('')));
        for (const k of FILTER_KEYS) {
          for (const v of state.filters[k]) {
            row.append(this.removeButton(`${this.cfg.labels[k]?.[v] ?? v} を外す`, () => this.removeFilter(k, v)));
          }
        }
        box.append(row);
        results.append(box);
      }

      private renderActive(state: SearchState) {
        const box = this.querySelector<HTMLElement>('[data-active-filters]')!;
        box.innerHTML = '';
        for (const k of FILTER_KEYS) {
          for (const v of state.filters[k]) {
            box.append(
              this.removeButton(
                `${this.cfg.labels[k]?.[v] ?? v} ×`,
                () => this.removeFilter(k, v),
                `絞り込み「${this.cfg.labels[k]?.[v] ?? v}」を外す`,
              ),
            );
          }
        }
        box.hidden = box.childElementCount === 0;
      }

      private removeButton(label: string, onClick: () => void, aria?: string): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'button chip-button';
        b.textContent = label;
        if (aria) b.setAttribute('aria-label', aria);
        b.addEventListener('click', onClick);
        return b;
      }

      private setQuery(q: string) {
        (this.form.elements.namedItem('q') as HTMLInputElement).value = q;
        this.update();
      }

      private removeFilter(k: FilterKey, v: string) {
        for (const input of this.form.querySelectorAll<HTMLInputElement>(`input[name="${k}"]`)) {
          if (input.value === v) input.checked = false;
        }
        this.update();
      }
    },
  );
}

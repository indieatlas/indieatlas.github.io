/** 表示テーマの切り替え。選択は localStorage に保存し、<html data-theme> に反映する */
export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'indieatlas-theme';
const ORDER: ThemeChoice[] = ['system', 'light', 'dark'];
const LABELS: Record<ThemeChoice, string> = {
  system: 'システム設定に従う',
  light: 'ライト',
  dark: 'ダーク',
};

export function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // localStorage が使えない環境
  }
  return 'system';
}

export function applyChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  root.dataset.themeChoice = choice;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  document.dispatchEvent(new CustomEvent('themechange', { detail: choice }));
}

export function initThemeToggle(): void {
  if (customElements.get('theme-toggle')) return;
  customElements.define(
    'theme-toggle',
    class extends HTMLElement {
      connectedCallback() {
        const button = this.querySelector('button')!;
        const sync = (c: ThemeChoice) =>
          button.setAttribute('aria-label', `表示テーマ: ${LABELS[c]}（押して切り替え）`);
        sync(readChoice());
        button.addEventListener('click', () => {
          const next = ORDER[(ORDER.indexOf(readChoice()) + 1) % ORDER.length]!;
          try {
            localStorage.setItem(KEY, next);
          } catch {
            // 保存できなくても、このページでは切り替える
          }
          applyChoice(next);
          sync(next);
        });
      }
    },
  );
}

/** 現在のテーマがダークか（WebGL の合成方法の切り替えに使う） */
export function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t) return t === 'dark';
  return !window.matchMedia('(prefers-color-scheme: light)').matches;
}

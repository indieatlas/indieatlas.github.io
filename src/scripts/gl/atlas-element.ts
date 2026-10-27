/**
 * ホームのアトラス（02 §2.7）の読み込み係。描画層は待機状態になってから動的 import() で読み込む。
 * WebGL2 を使えない、データ節約モード、などの環境では読み込まず、静的な表示のままにする。
 */
export function shouldUseWebGL(): { ok: boolean; reducedMotion: boolean } {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return { ok: false, reducedMotion };
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) return { ok: false, reducedMotion };
    probe.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return { ok: false, reducedMotion };
  }
  return { ok: true, reducedMotion };
}

function whenIdle(fn: () => void): void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 3000 });
  else window.setTimeout(fn, 1500);
}

export function defineAtlasElement(): void {
  if (customElements.get('atlas-canvas')) return;
  customElements.define(
    'atlas-canvas',
    class extends HTMLElement {
      connectedCallback() {
        const { ok, reducedMotion } = shouldUseWebGL();
        if (!ok) {
          this.dataset.state = 'static';
          return;
        }
        whenIdle(async () => {
          try {
            const { mountAtlas } = await import('./atlas.ts');
            await mountAtlas(this, {
              src: this.dataset.src!,
              gameBase: this.dataset.gameBase!,
              reducedMotion,
            });
          } catch (e) {
            this.dataset.state = 'static';
            console.warn('atlas: falling back to the static view', e);
          }
        });
      }
    },
  );
}

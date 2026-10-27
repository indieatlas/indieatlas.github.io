/**
 * [data-rotator] の中の [data-page] を一定の間隔で切り替える。
 * 操作の部品を出し、自動の切り替えは止められる（WCAG 2.2.2）。動きを減らす設定では自動で切り替えない。
 * ポインターやフォーカスが中にある間は止まる
 */
const INTERVAL_MS = 6000;

export function startRotators(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-rotator]')) setup(el);
}

function setup(el: HTMLElement): void {
  const pages = [...el.querySelectorAll<HTMLElement>('[data-page]')];
  const controls = el.querySelector<HTMLElement>('[data-controls]');
  if (pages.length < 2 || !controls) return;
  const dots = [...controls.querySelectorAll<HTMLButtonElement>('[data-dot]')];
  const pause = controls.querySelector<HTMLButtonElement>('[data-pause]')!;
  controls.hidden = false;
  let current = 0;
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let hover = false;
  let timer: number | undefined;

  const show = (i: number) => {
    current = (i + pages.length) % pages.length;
    pages.forEach((p, k) => {
      const on = k === current;
      p.toggleAttribute('inert', !on);
      if (on) p.removeAttribute('aria-hidden');
      else p.setAttribute('aria-hidden', 'true');
    });
    dots.forEach((d, k) => d.setAttribute('aria-pressed', String(k === current)));
  };
  const schedule = () => {
    window.clearTimeout(timer);
    if (paused || hover) return;
    timer = window.setTimeout(() => {
      show(current + 1);
      schedule();
    }, INTERVAL_MS);
  };
  const setPaused = (v: boolean) => {
    paused = v;
    pause.setAttribute('aria-pressed', String(v));
    pause.setAttribute('aria-label', v ? '自動の切り替えを再開する' : '自動の切り替えを止める');
    schedule();
  };

  dots.forEach((d, k) =>
    d.addEventListener('click', () => {
      show(k);
      schedule();
    }),
  );
  pause.addEventListener('click', () => setPaused(!paused));
  el.addEventListener('pointerenter', () => {
    hover = true;
    schedule();
  });
  el.addEventListener('pointerleave', () => {
    hover = false;
    schedule();
  });
  el.addEventListener('focusin', () => {
    hover = true;
    schedule();
  });
  el.addEventListener('focusout', () => {
    hover = false;
    schedule();
  });
  setPaused(paused);
}

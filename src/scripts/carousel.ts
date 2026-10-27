/**
 * ホームのカルーセル。スクロールスナップの一覧を、前後のボタン、番号、自動再生で操作できるようにする。
 * 自動再生は reduced motion の環境では行わず、ポインターを置いたときとフォーカスがあるときは止める。
 * WCAG 2.2.2 のため、自動再生を止めるボタンを置く。
 */
const INTERVAL = 7000;

export function defineCarousel(): void {
  for (const root of document.querySelectorAll<HTMLElement>('[data-carousel]')) {
    if (root.dataset.ready) continue;
    root.dataset.ready = '1';
    setup(root);
  }
}

function setup(root: HTMLElement) {
  const track = root.querySelector<HTMLElement>('[data-track]')!;
  const slides = [...root.querySelectorAll<HTMLElement>('[data-slide]')];
  const dots = [...root.querySelectorAll<HTMLButtonElement>('[data-goto]')];
  const pauseBtn = root.querySelector<HTMLButtonElement>('[data-pause]')!;
  const controls = root.querySelector<HTMLElement>('[data-controls]')!;
  if (slides.length < 2) return;
  controls.hidden = false;
  root.style.setProperty('--carousel-interval', `${INTERVAL}ms`);

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = 0;
  let timer = 0;
  let userPaused = reduced;
  let hover = false;
  let focus = false;

  const mark = (i: number) => {
    index = i;
    slides.forEach((s, j) => {
      s.toggleAttribute('data-active', j === i);
      s.setAttribute('aria-hidden', String(j !== i));
      for (const el of s.querySelectorAll<HTMLElement>('a, button')) el.tabIndex = j === i ? 0 : -1;
    });
    dots.forEach((d, j) => d.setAttribute('aria-current', String(j === i)));
  };
  const go = (i: number, smooth = true) => {
    const n = (i + slides.length) % slides.length;
    track.scrollTo({ left: slides[n]!.offsetLeft, behavior: smooth && !reduced ? 'smooth' : 'auto' });
    mark(n);
    schedule();
  };
  const playing = () => !userPaused && !hover && !focus && document.visibilityState === 'visible';
  function schedule() {
    window.clearTimeout(timer);
    root.classList.toggle('carousel-playing', playing());
    // 進み具合の帯のアニメーションを最初からにする
    for (const d of dots) {
      const bar = d.querySelector<HTMLElement>('.bar');
      if (bar) {
        bar.style.animation = 'none';
        void bar.offsetWidth;
        bar.style.animation = '';
      }
    }
    if (playing()) timer = window.setTimeout(() => go(index + 1), INTERVAL);
  }

  root.querySelector('[data-prev]')!.addEventListener('click', () => go(index - 1));
  root.querySelector('[data-next]')!.addEventListener('click', () => go(index + 1));
  dots.forEach((d, i) => d.addEventListener('click', () => go(i)));
  pauseBtn.addEventListener('click', () => {
    userPaused = !userPaused;
    pauseBtn.setAttribute('aria-pressed', String(userPaused));
    pauseBtn.textContent = userPaused ? '自動再生を始める' : '自動再生を止める';
    schedule();
  });
  if (reduced) {
    pauseBtn.setAttribute('aria-pressed', 'true');
    pauseBtn.textContent = '自動再生を始める';
  }
  root.addEventListener('pointerenter', () => {
    hover = true;
    schedule();
  });
  root.addEventListener('pointerleave', () => {
    hover = false;
    schedule();
  });
  root.addEventListener('focusin', () => {
    focus = true;
    schedule();
  });
  root.addEventListener('focusout', (e) => {
    if (!root.contains(e.relatedTarget as Node)) {
      focus = false;
      schedule();
    }
  });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(index + 1);
    if (e.key === 'ArrowLeft') go(index - 1);
  });
  // スワイプやスクロールで動かしたとき、表示中のスライドに合わせる
  let scrollTimer = 0;
  track.addEventListener(
    'scroll',
    () => {
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        const i = Math.round(track.scrollLeft / track.clientWidth);
        if (i !== index) {
          mark(Math.max(0, Math.min(slides.length - 1, i)));
          schedule();
        }
      }, 120);
    },
    { passive: true },
  );
  document.addEventListener('visibilitychange', schedule);
  mark(0);
  schedule();
}

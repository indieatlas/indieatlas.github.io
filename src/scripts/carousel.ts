/**
 * ホームのカルーセル。スクロールスナップの一覧を、前後のボタンと自動再生で1件ずつ送る。
 * 自動再生は reduced motion の環境では行わず、ポインターを置いたときとフォーカスがあるときは止める。
 * WCAG 2.2.2 のため、自動再生を止めるボタンを置く。
 */
const INTERVAL = 6000;

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
  const pauseBtn = root.querySelector<HTMLButtonElement>('[data-pause]')!;
  const controls = root.querySelector<HTMLElement>('[data-controls]')!;
  const counter = root.querySelector<HTMLElement>('[data-counter]')!;
  const progress = root.querySelector<HTMLElement>('[data-progress]')!.parentElement!;
  if (slides.length < 2) return;
  controls.hidden = false;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timer = 0;
  let userPaused = reduced;
  let hover = false;
  let focus = false;

  const step = () => (slides[1] ? slides[1].offsetLeft - slides[0]!.offsetLeft : track.clientWidth);
  const visible = () => Math.max(1, Math.round(track.clientWidth / step()));
  const maxIndex = () => Math.max(0, slides.length - visible());
  const current = () => Math.round(track.scrollLeft / step());

  const update = () => {
    const i = Math.min(current(), maxIndex());
    counter.textContent = String(i + 1).padStart(2, '0');
    const m = maxIndex();
    progress.style.setProperty('--progress', `${((i + visible()) / slides.length) * 100}%`);
    root.dataset.index = String(i);
    root.dataset.max = String(m);
  };
  const go = (i: number) => {
    const m = maxIndex();
    const n = i > m ? 0 : i < 0 ? m : i;
    track.scrollTo({ left: n * step(), behavior: reduced ? 'auto' : 'smooth' });
    schedule();
  };
  const playing = () => !userPaused && !hover && !focus && document.visibilityState === 'visible';
  function schedule() {
    window.clearTimeout(timer);
    if (playing()) timer = window.setTimeout(() => go(current() + 1), INTERVAL);
  }

  root.querySelector('[data-prev]')!.addEventListener('click', () => go(current() - 1));
  root.querySelector('[data-next]')!.addEventListener('click', () => go(current() + 1));
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
    if (e.key === 'ArrowRight') go(current() + 1);
    if (e.key === 'ArrowLeft') go(current() - 1);
  });
  track.addEventListener('scroll', () => window.requestAnimationFrame(update), { passive: true });
  window.addEventListener('resize', update);
  document.addEventListener('visibilitychange', schedule);
  update();
  schedule();
}

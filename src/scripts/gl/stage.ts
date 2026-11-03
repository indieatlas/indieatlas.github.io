/**
 * ページの背景の WebGL（02 §2.7）。ページの色のグラデーションに、重なってうねる半透明の波と、
 * 画面全体に散らばる大小の光の粒を、全画面の三角形1枚で描く（携帯ゲーム機のメニューの背景のように）。
 * 本文は不透明度の高い面（main）に載せ、この背景の上に文字を直接置かない。
 * 1ページに1つのキャンバスだけを使う。描けない環境では body の CSS の背景のままにする。
 */
const VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform vec2 uRes;      // 描画バッファの大きさ
uniform float uScale;   // CSS ピクセルあたりの描画ピクセル
uniform float uTime;
uniform float uScroll;  // スクロール量（CSS ピクセル）
uniform vec2 uPointer;  // -1〜1
uniform vec3 uBg;
uniform vec3 uSignal;
uniform vec3 uWarm;
uniform vec3 uInk;
uniform vec3 uTint;
uniform float uDark;
out vec4 o;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec2 px = gl_FragCoord.xy / uScale;           // CSS ピクセル（下から上）
  vec2 res = uRes / uScale;
  vec2 uv = px / res;
  float aspect = res.x / res.y;
  float t = uTime;
  bool dark = uDark > 0.5;
  vec3 tint = mix(uSignal, uTint, 0.75);         // ページの色（作品詳細では作品の色）

  // 1. 地: 上が深く、中ほどが明るい、ページの色のグラデーション
  vec3 col;
  if (dark) {
    vec3 top = uBg * 0.6;
    vec3 midc = mix(uBg, tint, 0.38);
    vec3 bottom = mix(uBg, tint, 0.16);
    col = mix(midc, top, smoothstep(0.45, 1.0, uv.y));
    col = mix(bottom, col, smoothstep(0.0, 0.5, uv.y));
  } else {
    vec3 top = mix(uBg, tint, 0.18);
    vec3 midc = mix(vec3(1.0), uBg, 0.4);
    col = mix(midc, top, smoothstep(0.4, 1.0, uv.y));
    col = mix(mix(uBg, tint, 0.1), col, smoothstep(0.0, 0.45, uv.y));
  }
  col += tint * (noise(uv * vec2(aspect, 1.0) * 2.0 + vec2(t * 0.03, 0.0)) - 0.5) * (dark ? 0.06 : 0.03);

  // 2. 波。重なった半透明の帯が、上下に大きくうねりながら横へ流れる（携帯ゲーム機のメニューの背景のように）
  float x = uv.x * aspect + uPointer.x * 0.04;
  float lift = uScroll * 0.00006 + uPointer.y * 0.01;
  vec3 waves = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float y = 0.5 + lift + (fi - 2.5) * 0.018
      + 0.15 * sin(x * (0.75 + fi * 0.06) + t * (0.2 + fi * 0.025) + fi * 1.7)
      + 0.06 * sin(x * (1.8 - fi * 0.08) - t * (0.28 + fi * 0.02) + fi * 0.9)
      + 0.025 * sin(x * 4.1 + t * 0.5 + fi * 2.3);
    float d = uv.y - y;
    float width = 0.0055 + fi * 0.0012;
    float line = exp(-pow(d / width, 2.0));
    float halo = exp(-pow(d / 0.035, 2.0));
    float sheet = d < 0.0 ? exp(d * (7.0 + fi * 1.5)) : exp(-d * 45.0);
    float w = 1.0 - fi * 0.1;
    waves += (mix(tint, vec3(1.0), 0.7) * line * 0.2 + mix(tint, vec3(1.0), 0.45) * halo * 0.05 + mix(tint, vec3(1.0), 0.2) * sheet * 0.07) * w;
  }
  col = dark ? col + waves : mix(col, col + waves * 0.9, 0.85);

  // 3. 光の粒。大きさの違う3層を画面全体に散らし、ゆっくり漂わせて瞬かせる。大きな粒はぼかして玉のように見せる
  vec3 dust = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float cell = 26.0 + fk * 34.0;               // 小さい粒ほど細かく
    vec2 sp = px + vec2(t * (6.0 + fk * 5.0), t * (2.0 + fk * 1.5)) + uPointer * (4.0 + fk * 10.0);
    vec2 id = floor(sp / cell);
    vec2 f = fract(sp / cell) - 0.5;
    float h = hash(id + fk * 31.7);
    vec2 off = vec2(hash(id + 3.1 + fk), hash(id + 7.7 + fk)) - 0.5;
    float r = mix(0.025, 0.09, hash(id + 11.3)) * (1.0 + fk * 0.6);
    float dd = length(f - off * 0.4);
    float core = smoothstep(r, r * 0.2, dd);
    // にじみはセルの端より内側で消し、セルの境目が見えないようにする
    float bloom = exp(-dd * dd / (r * r * (fk + 1.5) * 1.8)) * 0.35 * smoothstep(0.3, 0.1, dd);
    float tw = 0.45 + 0.55 * sin(t * (0.6 + h * 1.8) + h * 50.0);
    float on = step(0.72 - fk * 0.08, h);
    float bright = (0.18 + 0.12 * fk) * tw * on * (fk > 1.5 ? 0.6 : 1.0);
    dust += mix(vec3(1.0), mix(tint, vec3(1.0), 0.5), fk * 0.4) * (core + bloom) * bright;
  }
  col += dust * (dark ? 0.75 : 0.45) * mix(0.55, 1.0, smoothstep(0.0, 0.6, uv.y));

  // 4. 粒子のノイズと周辺の減光
  col += (hash(px + fract(t) * 37.0) - 0.5) * (dark ? 0.025 : 0.015);
  float vig = smoothstep(1.35, 0.3, length((uv - vec2(0.5, 0.5)) * vec2(1.1, 1.0)));
  col *= mix(dark ? 0.6 : 0.95, 1.0, vig);
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

type Rgb = [number, number, number];
const COLORS_KEY = 'indieatlas-stage-colors';
const CLOCK_KEY = 'indieatlas-stage-clock';
const COLOR_FADE_MS = 900;

function hexToRgb(hex: string): Rgb {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return [0.5, 0.5, 0.5];
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function isDarkTheme(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t) return t === 'dark';
  return !window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function canUseStage(): boolean {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return false;
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export function mountStage(): void {
  if (document.querySelector('canvas.stage') || !canUseStage()) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = document.createElement('canvas');
  canvas.className = 'stage';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
  });
  if (!gl) return;

  const prog = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, VS],
    [gl.FRAGMENT_SHADER, FS],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('stage:', gl.getShaderInfoLog(s));
      return;
    }
    gl.attachShader(prog, s);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);
  gl.bindVertexArray(gl.createVertexArray());
  const U = (n: string) => gl.getUniformLocation(prog, n);
  const u = {
    res: U('uRes'),
    scale: U('uScale'),
    time: U('uTime'),
    scroll: U('uScroll'),
    pointer: U('uPointer'),
    bg: U('uBg'),
    signal: U('uSignal'),
    warm: U('uWarm'),
    ink: U('uInk'),
    tint: U('uTint'),
    dark: U('uDark'),
  };

  // 色は前のページの色から滑らかに移す。ページをまたいで覚えておく
  type Colors = { bg: Rgb; signal: Rgb; warm: Rgb; ink: Rgb; tint: Rgb; dark: number };
  const readColors = (): Colors => {
    const css = getComputedStyle(document.documentElement);
    const tint = document.body.dataset.stageTint;
    const v = (name: string) => css.getPropertyValue(name);
    // 色は #rrggbb か、CSS の変数名（例: --genre-c3）で指定する
    const tintHex = tint?.startsWith('--')
      ? v(tint)
      : tint && /^#[0-9a-f]{6}$/i.test(tint)
        ? tint
        : v('--color-signal');
    return {
      bg: hexToRgb(v('--color-bg')),
      signal: hexToRgb(v('--color-signal')),
      warm: hexToRgb(v('--color-accent-warm')),
      ink: hexToRgb(v('--color-text')),
      tint: hexToRgb(tintHex),
      dark: isDarkTheme() ? 1 : 0,
    };
  };
  let to = readColors();
  let from = to;
  let fadeStart = 0;
  const continueFromSaved = () => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(COLORS_KEY) ?? 'null') as Colors | null;
      // 明暗が同じときだけ引き継ぐ
      if (saved && saved.dark === to.dark && !reduced.matches) {
        from = saved;
        fadeStart = performance.now();
      }
    } catch {
      // 前の色がなければ、そのまま描く
    }
  };
  continueFromSaved();
  let current = to;
  const mixColors = (now: number): boolean => {
    const k = fadeStart ? Math.min(1, (now - fadeStart) / COLOR_FADE_MS) : 1;
    const e = 1 - Math.pow(1 - k, 3);
    const m = (a: Rgb, b: Rgb): Rgb => [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
    current = {
      bg: m(from.bg, to.bg),
      signal: m(from.signal, to.signal),
      warm: m(from.warm, to.warm),
      ink: m(from.ink, to.ink),
      tint: m(from.tint, to.tint),
      dark: to.dark,
    };
    gl.uniform3f(u.bg, ...current.bg);
    gl.uniform3f(u.signal, ...current.signal);
    gl.uniform3f(u.warm, ...current.warm);
    gl.uniform3f(u.ink, ...current.ink);
    gl.uniform3f(u.tint, ...current.tint);
    gl.uniform1f(u.dark, current.dark);
    if (k >= 1) fadeStart = 0;
    return k < 1;
  };
  const applyColors = () => {
    from = current;
    to = readColors();
    fadeStart = from.dark === to.dark && !reduced.matches ? performance.now() : 0;
    request();
  };
  const saveColors = () => {
    try {
      sessionStorage.setItem(COLORS_KEY, JSON.stringify(current));
    } catch {
      // 保存できなければ、次のページでは色を引き継がない
    }
  };

  // 背景は細部が不要なので、デバイスピクセル比を抑えて描く
  let scale = Math.min(window.devicePixelRatio || 1, 1);
  const resize = () => {
    canvas.width = Math.max(1, Math.round(window.innerWidth * scale));
    canvas.height = Math.max(1, Math.round(window.innerHeight * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    request();
  };

  let pointer = [0, 0];
  let target = [0, 0];
  let raf = 0;
  let last = 0;
  let animate = !reduced.matches;
  // 波の位相をページをまたいでつなぐ。長く開いたままなら1時間ごとに数え直す（シェーダーの精度のため）
  let epoch = Date.now();
  try {
    const saved = Number(sessionStorage.getItem(CLOCK_KEY));
    if (saved && epoch - saved < 3_600_000) epoch = saved;
    else sessionStorage.setItem(CLOCK_KEY, String(epoch));
  } catch {
    // 保存できなければ、ページごとに始めから動かす
  }
  const times: number[] = [];

  const frame = (now: number) => {
    raf = 0;
    if (document.visibilityState !== 'visible') return;
    // 直近2秒の平均フレーム時間が 24ms を超えたら解像度を下げ、33ms を超えたら止める
    if (last && animate) {
      times.push(now - last);
      let sum = times.reduce((a, b) => a + b, 0);
      while (sum > 2000 && times.length > 1) sum -= times.shift()!;
      if (sum >= 2000) {
        const avg = sum / times.length;
        if (avg > 33 && scale <= 0.5) animate = false;
        else if (avg > 24 && scale > 0.5) {
          scale = 0.5;
          resize();
        }
        times.length = 0;
      }
    }
    last = now;
    pointer = [pointer[0]! + (target[0]! - pointer[0]!) * 0.06, pointer[1]! + (target[1]! - pointer[1]!) * 0.06];
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform1f(u.scale, scale);
    gl.uniform1f(u.time, animate ? (Date.now() - epoch) / 1000 : 12);
    const fading = mixColors(now);
    gl.uniform1f(u.scroll, window.scrollY);
    gl.uniform2f(u.pointer, pointer[0]!, pointer[1]!);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (animate || fading) raf = requestAnimationFrame(frame);
  };
  function request() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pageswap', saveColors);
  window.addEventListener('pagehide', saveColors);
  // 戻る・進むでキャッシュから戻ったときも、直前のページの色から移す
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    continueFromSaved();
    request();
  });
  window.addEventListener(
    'pointermove',
    (e) => {
      if (reduced.matches) return;
      target = [(e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1];
      request();
    },
    { passive: true },
  );
  window.addEventListener('scroll', () => request(), { passive: true });
  document.addEventListener('visibilitychange', () => {
    last = 0;
    request();
  });
  document.addEventListener('themechange', () => requestAnimationFrame(applyColors));
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyColors);
  reduced.addEventListener('change', () => {
    animate = !reduced.matches;
    request();
  });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    canvas.remove();
  });

  // 最初の1枚はすぐに描き、遷移の間に背景が地の色だけにならないようにする
  document.body.prepend(canvas);
  canvas.width = Math.max(1, Math.round(window.innerWidth * scale));
  canvas.height = Math.max(1, Math.round(window.innerHeight * scale));
  gl.viewport(0, 0, canvas.width, canvas.height);
  frame(performance.now());
  last = 0;
  request();
  document.documentElement.classList.add('has-stage');
}

/**
 * 背景を始める。ページを移るたびに背景が地の色だけになって見えないよう、待たずにすぐ描く。
 * ほかのページから来たときは、キャンバスをフェードインさせない
 */
export function startStage(): void {
  try {
    if (sessionStorage.getItem(COLORS_KEY)) document.documentElement.classList.add('stage-continued');
  } catch {
    // 保存できなければ、毎回フェードインする
  }
  mountStage();
}

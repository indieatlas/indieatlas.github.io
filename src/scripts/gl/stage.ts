/**
 * ページの背景の WebGL（02 §2.7）。斜めに流れる帯、網点、粒子のノイズを、全画面の三角形1枚で描く。
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
  vec2 px = gl_FragCoord.xy / uScale;           // CSS ピクセル
  vec2 res = uRes / uScale;
  px.y = res.y - px.y;                           // 上から下へ
  vec2 par = uPointer * vec2(14.0, 10.0);        // 視差
  vec3 col = uBg;

  // 斜めの帯（115度）。ゆっくり流れ、スクロールとポインターで少しずれる
  float ang = radians(-25.0);
  mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 q = rot * (px + par + vec2(0.0, uScroll * 0.25));
  float t = uTime;
  float w = res.x;
  float b1 = q.x - w * 0.62 - t * 6.0;
  float band1 = smoothstep(0.0, 2.0, mod(b1, w * 1.4)) * (1.0 - smoothstep(w * 0.16, w * 0.16 + 2.0, mod(b1, w * 1.4)));
  float b2 = q.x - w * 0.35 + t * 3.5 + par.x * 1.5;
  float band2 = smoothstep(0.0, 1.5, mod(b2, w * 1.1)) * (1.0 - smoothstep(10.0, 11.5, mod(b2, w * 1.1)));
  float b3 = q.x - w * 0.9 - t * 9.0;
  float band3 = smoothstep(0.0, 1.5, mod(b3, w * 1.7)) * (1.0 - smoothstep(3.0, 4.5, mod(b3, w * 1.7)));

  vec3 sig = mix(uSignal, uTint, 0.35);
  col = mix(col, sig, band1 * (uDark > 0.5 ? 0.34 : 0.16));
  col = mix(col, uWarm, band2 * (uDark > 0.5 ? 0.55 : 0.35));
  col = mix(col, uInk, band3 * 0.12);

  // 網点。左下と右上ほど大きく、ゆっくり脈打つ
  float cell = 12.0;
  vec2 g = mod(px + vec2(t * 2.0, 0.0), cell) - cell * 0.5;
  vec2 uv = px / res;
  float corner = max(smoothstep(0.55, 1.0, (1.0 - uv.x) * 0.6 + uv.y * 0.7), smoothstep(0.6, 1.0, uv.x * 0.8 + (1.0 - uv.y) * 0.5));
  float pulse = 0.85 + 0.15 * sin(t * 0.6 + uv.x * 6.0);
  float r = cell * 0.42 * corner * pulse;
  float dotMask = 1.0 - smoothstep(r - 0.8, r + 0.8, length(g));
  col = mix(col, sig, dotMask * (uDark > 0.5 ? 0.22 : 0.12));

  // 霧のようなむら
  float n = noise(px / 260.0 + vec2(t * 0.02, -t * 0.015));
  col = mix(col, sig, smoothstep(0.55, 1.0, n) * (uDark > 0.5 ? 0.10 : 0.05));

  // 粒子のノイズと周辺の減光
  float grain = (hash(px + fract(t) * 37.0) - 0.5) * (uDark > 0.5 ? 0.035 : 0.025);
  float vig = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(1.2, 1.0)));
  col = col * mix(uDark > 0.5 ? 0.72 : 0.94, 1.0, vig) + grain;
  o = vec4(col, 1.0);
}`;

function hexToRgb(hex: string): [number, number, number] {
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

  const applyColors = () => {
    const css = getComputedStyle(document.documentElement);
    const tint = document.body.dataset.stageTint;
    const v = (name: string) => css.getPropertyValue(name);
    gl.uniform3f(u.bg, ...hexToRgb(v('--color-bg')));
    gl.uniform3f(u.signal, ...hexToRgb(v('--color-signal')));
    gl.uniform3f(u.warm, ...hexToRgb(v('--color-accent-warm')));
    gl.uniform3f(u.ink, ...hexToRgb(v('--color-text')));
    // 色は #rrggbb か、CSS の変数名（例: --genre-c3）で指定する
    const tintHex = tint?.startsWith('--')
      ? v(tint)
      : tint && /^#[0-9a-f]{6}$/i.test(tint)
        ? tint
        : v('--color-signal');
    gl.uniform3f(u.tint, ...hexToRgb(tintHex));
    gl.uniform1f(u.dark, isDarkTheme() ? 1 : 0);
    request();
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
  const start = performance.now();
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
    gl.uniform1f(u.time, animate ? (now - start) / 1000 : 12);
    gl.uniform1f(u.scroll, window.scrollY);
    gl.uniform2f(u.pointer, pointer[0]!, pointer[1]!);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (animate) raf = requestAnimationFrame(frame);
  };
  function request() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
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

  document.body.prepend(canvas);
  resize();
  applyColors();
  document.documentElement.classList.add('has-stage');
}

/** 待機状態になってから背景を始める */
export function startStageWhenIdle(): void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  const go = () => mountStage();
  if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 2000 });
  else window.setTimeout(go, 600);
}

import type { AtlasData } from '../../../schema/site-data.ts';
import { isDark } from '../theme.ts';
import { scaleOf, screenToWorld, SpatialGrid, worldToScreen, zoomAt, type Frame, type View } from './spatial-grid.ts';

/**
 * WebGL2 で描くアトラス（02 §2.7.2、§2.7.3）。three.js は使わず、点群と全画面の背景だけを描く。
 * キャンバスは装飾として aria-hidden にし、同じ作品群へは HTML のリンクでたどれるようにしている。
 */
interface Options {
  src: string;
  gameBase: string;
  reducedMotion: boolean;
}

const BG_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() { vUv = P[gl_VertexID] * 0.5 + 0.5; gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;

const BG_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform float uTime;
uniform vec2 uRes;
uniform vec3 uA;
uniform vec3 uB;
uniform float uStrength;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec2 p = vUv * vec2(uRes.x / uRes.y, 1.0) * 2.2;
  float t = uTime * 0.012;
  float n = fbm(p + vec2(t, -t * 0.6));
  float m = fbm(p * 1.7 - vec2(t * 0.4, t));
  vec3 c = uA * smoothstep(0.45, 0.95, n) + uB * smoothstep(0.55, 1.0, m) * 0.7;
  float a = clamp((c.r + c.g + c.b) * uStrength, 0.0, 0.6);
  o = vec4(c * uStrength, a);
}`;

const PT_VS = `#version 300 es
in vec2 aPos;
in vec3 aColor;
in float aSize;
in float aSeed;
uniform vec4 uView;   // cx, cy, scale(px/world), dpr
uniform vec4 uFrame;  // ox, oy, width, height（CSS px）
uniform float uTime;
uniform float uMotion;
uniform float uHover;
out vec3 vColor;
out float vGlow;
void main() {
  float ph = aSeed * 6.2831;
  vec2 drift = vec2(sin(uTime * 0.18 + ph), cos(uTime * 0.15 + ph * 1.3)) * 0.006 * uMotion;
  vec2 w = aPos + drift;
  vec2 px = vec2(uFrame.x + (w.x - uView.x) * uView.z, uFrame.y - (w.y - uView.y) * uView.z);
  vec2 clip = px / uFrame.zw * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float twinkle = 1.0 + 0.18 * sin(uTime * (0.6 + aSeed) + ph) * uMotion;
  float hovered = float(gl_VertexID) == uHover ? 1.0 : 0.0;
  float zoomBoost = pow(clamp(uView.z / 300.0, 0.5, 4.0), 0.3);
  gl_PointSize = aSize * twinkle * zoomBoost * (1.0 + hovered * 0.9) * uView.w;
  vColor = aColor;
  vGlow = hovered;
}`;

const PT_FS = `#version 300 es
precision mediump float;
in vec3 vColor;
in float vGlow;
uniform float uDark;
out vec4 o;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = smoothstep(0.42, 0.0, d);
  float halo = pow(1.0 - d, 2.2) * (0.55 + vGlow * 0.45);
  float a = clamp(core + halo, 0.0, 1.0);
  vec3 c = mix(vColor, vec3(1.0), core * 0.55 * uDark);
  o = uDark > 0.5 ? vec4(c * a, a) : vec4(c * a, a * 0.92);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return [0.8, 0.82, 0.9];
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export async function mountAtlas(host: HTMLElement, opts: Options): Promise<void> {
  const res = await fetch(opts.src);
  if (!res.ok) throw new Error(`atlas.json: HTTP ${res.status}`);
  const data = (await res.json()) as AtlasData;
  if (data.points.length === 0) return;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.tabIndex = -1;
  canvas.className = 'atlas-gl';
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    powerPreference: 'low-power',
  });
  if (!gl) throw new Error('webgl2 unavailable');
  const tooltip = document.createElement('div');
  tooltip.className = 'atlas-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.id = 'atlas-tooltip';
  tooltip.hidden = true;
  host.append(canvas, tooltip);

  const n = data.points.length;
  const xs = new Float32Array(data.points.map((p) => p.x));
  const ys = new Float32Array(data.points.map((p) => p.y));
  const grid = new SpatialGrid(xs, ys, 0.04);
  const pos = new Float32Array(n * 2);
  const sizes = new Float32Array(n);
  const seeds = new Float32Array(n);
  data.points.forEach((p, i) => {
    pos[i * 2] = p.x;
    pos[i * 2 + 1] = p.y;
    sizes[i] = p.s === 3 ? 22 : p.s === 2 ? 17 : 13;
    seeds[i] = ((i * 2654435761) % 1000) / 1000;
  });
  const colors = new Float32Array(n * 3);

  const bg = compile(gl, BG_VS, BG_FS);
  const pt = compile(gl, PT_VS, PT_FS);
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const attr = (name: string, arr: Float32Array, size: number) => {
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pt, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    return buf;
  };
  attr('aPos', pos, 2);
  const colorBuf = attr('aColor', colors, 3);
  attr('aSize', sizes, 1);
  attr('aSeed', seeds, 1);
  const U = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);
  const u = {
    bgTime: U(bg, 'uTime'),
    bgRes: U(bg, 'uRes'),
    bgA: U(bg, 'uA'),
    bgB: U(bg, 'uB'),
    bgStrength: U(bg, 'uStrength'),
    view: U(pt, 'uView'),
    frame: U(pt, 'uFrame'),
    time: U(pt, 'uTime'),
    motion: U(pt, 'uMotion'),
    hover: U(pt, 'uHover'),
    dark: U(pt, 'uDark'),
  };

  let dark = isDark();
  let accent: [number, number, number] = [0.5, 0.75, 1];
  let warm: [number, number, number] = [1, 0.72, 0.42];
  const applyTheme = () => {
    dark = isDark();
    const css = getComputedStyle(document.documentElement);
    const palette = Array.from({ length: 8 }, (_, i) => hexToRgb(css.getPropertyValue(`--atlas-c${i}`)));
    const neutral = hexToRgb(css.getPropertyValue('--atlas-neutral'));
    accent = hexToRgb(css.getPropertyValue('--color-accent'));
    warm = hexToRgb(css.getPropertyValue('--color-accent-warm'));
    data.points.forEach((p, i) => colors.set(p.c >= 0 && p.c < 8 ? palette[p.c]! : neutral, i * 3));
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    requestDraw();
  };

  // 表示の状態
  let view: View = { zoom: 1, cx: 0, cy: 0 };
  let frame: Frame = { ox: 0, oy: 0, span: 1 };
  let width = 0;
  let height = 0;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  let maxDpr = coarse ? 1.5 : 2;
  let dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  let hover = -1;
  let pinned = -1; // タップで選んだ点（2回目のタップで移動する）

  const resize = () => {
    const r = host.getBoundingClientRect();
    width = Math.max(1, r.width);
    height = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    // 広い画面ではパネルの右側に、狭い画面では上側に地図を置く
    if (width > 760) frame = { ox: width * 0.66, oy: height / 2, span: Math.min(width * 0.56, height * 0.95) };
    else {
      const top = Math.min(height, width * 0.56);
      frame = { ox: width / 2, oy: top / 2, span: Math.min(width, top) };
    }
    requestDraw();
  };

  // 描画
  let running = false;
  let visible = true;
  let animate = !opts.reducedMotion;
  let raf = 0;
  let needsDraw = true;
  const start = performance.now();
  const frameTimes: number[] = [];
  let last = 0;
  let stopped = false;

  function draw(now: number) {
    const t = animate ? (now - start) / 1000 : 0;
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.enable(gl!.BLEND);
    gl!.blendFunc(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);
    gl!.useProgram(bg);
    gl!.uniform1f(u.bgTime, t);
    gl!.uniform2f(u.bgRes, canvas.width, canvas.height);
    gl!.uniform3f(u.bgA, ...accent);
    gl!.uniform3f(u.bgB, ...warm);
    gl!.uniform1f(u.bgStrength, dark ? 0.22 : 0.1);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    gl!.useProgram(pt);
    // ダークテーマでは加算合成で光らせ、ライトテーマでは通常の合成にする
    if (dark) gl!.blendFunc(gl!.ONE, gl!.ONE);
    else gl!.blendFunc(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);
    gl!.bindVertexArray(vao);
    gl!.uniform4f(u.view, view.cx, view.cy, scaleOf(frame, view.zoom), dpr);
    gl!.uniform4f(u.frame, frame.ox, frame.oy, width, height);
    gl!.uniform1f(u.time, t);
    gl!.uniform1f(u.motion, animate ? 1 : 0);
    gl!.uniform1f(u.hover, hover);
    gl!.uniform1f(u.dark, dark ? 1 : 0);
    gl!.drawArrays(gl!.POINTS, 0, n);
  }

  function loop(now: number) {
    raf = 0;
    if (!visible || stopped) {
      running = false;
      return;
    }
    if (last) monitor(now - last);
    last = now;
    draw(now);
    needsDraw = false;
    if (animate) raf = requestAnimationFrame(loop);
    else running = false;
  }

  function requestDraw() {
    needsDraw = true;
    if (!running && visible && !stopped) {
      running = true;
      last = 0;
      raf = requestAnimationFrame(loop);
    }
  }

  // 直近2秒の平均フレーム時間が 24ms を超えたら解像度を下げ、33ms を超えたら静止画にする
  let lowered = false;
  function monitor(dt: number) {
    if (dt > 200) return; // タブの切り替えなどの空白
    frameTimes.push(dt);
    let sum = frameTimes.reduce((a, b) => a + b, 0);
    while (sum > 2000 && frameTimes.length > 1) sum -= frameTimes.shift()!;
    if (sum < 2000) return;
    const avg = sum / frameTimes.length;
    if (avg > 33 && lowered) {
      animate = false;
      frameTimes.length = 0;
    } else if (avg > 24 && !lowered) {
      lowered = true;
      maxDpr = 1;
      frameTimes.length = 0;
      resize();
    }
  }

  // 画面外とタブが非表示のときは描画を止める
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting) && document.visibilityState === 'visible';
    if (visible) requestDraw();
  });
  io.observe(host);
  document.addEventListener('visibilitychange', () => {
    visible = document.visibilityState === 'visible';
    if (visible) requestDraw();
  });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stopped = true;
    cancelAnimationFrame(raf);
    canvas.remove();
    tooltip.remove();
    host.dataset.state = 'static';
    host.closest('.atlas-hero')?.classList.remove('atlas-ready');
  });

  // ツールチップ
  function showTooltip(i: number) {
    if (i < 0) {
      tooltip.hidden = true;
      canvas.style.cursor = '';
      return;
    }
    const p = data.points[i]!;
    tooltip.innerHTML = `${p.i ? `<img src="${esc(p.i)}" alt="" width="460" height="215" data-fallback>` : ''}
<p class="atlas-tooltip__title">${esc(p.t)}</p>
${p.tags.length ? `<p class="atlas-tooltip__tags">${p.tags.map(esc).join(' ・ ')}</p>` : ''}
<p class="atlas-tooltip__release">${esc(p.r)}</p>
<p class="atlas-tooltip__hint">${coarse ? 'もう一度タップで詳細へ' : 'クリックまたは Enter で詳細へ'}</p>`;
    const [sx, sy] = worldToScreen(view, frame, p.x, p.y);
    tooltip.hidden = false;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const left = Math.min(Math.max(8, sx + 14), width - tw - 8);
    const top = sy - th - 14 < 8 ? sy + 14 : sy - th - 14;
    tooltip.style.transform = `translate(${left}px, ${Math.min(top, height - th - 8)}px)`;
    canvas.style.cursor = 'pointer';
  }
  const setHover = (i: number) => {
    if (i === hover) return;
    hover = i;
    showTooltip(i);
    requestDraw();
  };
  const hitAt = (clientX: number, clientY: number): number => {
    const r = canvas.getBoundingClientRect();
    const [wx, wy] = screenToWorld(view, frame, clientX - r.left, clientY - r.top);
    return grid.nearest(wx, wy, 16 / scaleOf(frame, view.zoom));
  };
  const open = (i: number) => {
    location.href = `${opts.gameBase}${data.points[i]!.id}/`;
  };

  // 操作: マウスのドラッグで移動、ホイールとピンチで拡大縮小。1本指の縦のスクロールは妨げない
  const pointers = new Map<number, { x: number; y: number }>();
  let dragged = false;
  let downAt: { x: number; y: number } | null = null;
  let pinch: { d: number; cx: number; cy: number } | null = null;

  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    downAt = { x: e.clientX, y: e.clientY };
    dragged = false;
    if (e.pointerType !== 'touch') canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2 };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (prev) {
      if (pointers.size === 2 && pinch) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const cx = (a!.x + b!.x) / 2;
        const cy = (a!.y + b!.y) / 2;
        const r = canvas.getBoundingClientRect();
        view = zoomAt(view, frame, cx - r.left, cy - r.top, d / Math.max(1, pinch.d));
        const s = scaleOf(frame, view.zoom);
        view = { ...view, cx: view.cx - (cx - pinch.cx) / s, cy: view.cy + (cy - pinch.cy) / s };
        pinch = { d, cx, cy };
        dragged = true;
        requestDraw();
        return;
      }
      if (e.pointerType !== 'touch') {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) dragged = true;
        if (dragged) {
          const s = scaleOf(frame, view.zoom);
          view = { ...view, cx: view.cx - dx / s, cy: view.cy + dy / s };
          setHover(-1);
          requestDraw();
        }
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      return;
    }
    if (e.pointerType === 'mouse') setHover(hitAt(e.clientX, e.clientY));
  });
  const up = (e: PointerEvent) => {
    const was = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!was || dragged) return;
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) return;
    const i = hitAt(e.clientX, e.clientY);
    if (e.pointerType === 'touch') {
      if (i >= 0 && i === pinned) open(i);
      pinned = i;
      setHover(i);
    } else if (i >= 0) open(i);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => {
    pointers.delete(e.pointerId);
    pinch = null;
  });
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !pointers.size) setHover(-1);
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      view = zoomAt(view, frame, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
      setHover(-1);
      requestDraw();
    },
    { passive: false },
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && hover >= 0 && !tooltip.hidden && document.activeElement === document.body) open(hover);
    if (e.key === 'Escape') setHover(-1);
  });

  new ResizeObserver(resize).observe(host);
  document.addEventListener('themechange', applyTheme);
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  resize();
  applyTheme();
  host.dataset.state = 'ready';
  host.closest('.atlas-hero')?.classList.add('atlas-ready');
  void needsDraw;
}

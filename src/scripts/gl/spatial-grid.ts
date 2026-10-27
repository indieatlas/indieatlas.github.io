/** CPU 側の一様グリッド（空間ハッシュ）による当たり判定（02 §2.7.3） */
export class SpatialGrid {
  private cells = new Map<string, number[]>();
  constructor(
    private readonly xs: Float32Array,
    private readonly ys: Float32Array,
    private readonly cell = 0.05,
  ) {
    for (let i = 0; i < xs.length; i++) {
      const k = this.key(xs[i]!, ys[i]!);
      const list = this.cells.get(k);
      if (list) list.push(i);
      else this.cells.set(k, [i]);
    }
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }

  /** 世界座標 (x, y) から半径 r 以内で最も近い点の番号。なければ -1 */
  nearest(x: number, y: number, r: number): number {
    const span = Math.ceil(r / this.cell);
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    let best = -1;
    let bestD = r * r;
    for (let dx = -span; dx <= span; dx++) {
      for (let dy = -span; dy <= span; dy++) {
        for (const i of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const ex = this.xs[i]! - x;
          const ey = this.ys[i]! - y;
          const d = ex * ex + ey * ey;
          if (d <= bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    return best;
  }
}

/** 表示の変換。世界座標 [-1, 1] を、拡大率 zoom と中心 (cx, cy) で画面に写す */
export interface View {
  zoom: number;
  cx: number;
  cy: number;
}

/** 画面上の配置: 地図の中心 (ox, oy) と、地図に使う領域の短い辺 span（CSS ピクセル） */
export interface Frame {
  ox: number;
  oy: number;
  span: number;
}

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 6;

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** 世界座標の1単位あたりの画面のピクセル数（領域の短い辺の半分を世界の 1.15 にする） */
export function scaleOf(f: Frame, zoom: number): number {
  return (f.span / 2 / 1.15) * zoom;
}

export function worldToScreen(v: View, f: Frame, x: number, y: number): [number, number] {
  const s = scaleOf(f, v.zoom);
  return [f.ox + (x - v.cx) * s, f.oy - (y - v.cy) * s];
}

export function screenToWorld(v: View, f: Frame, sx: number, sy: number): [number, number] {
  const s = scaleOf(f, v.zoom);
  return [(sx - f.ox) / s + v.cx, -(sy - f.oy) / s + v.cy];
}

/** 画面上の点 (sx, sy) を固定したまま拡大率を変える */
export function zoomAt(v: View, f: Frame, sx: number, sy: number, factor: number): View {
  const [wx, wy] = screenToWorld(v, f, sx, sy);
  const zoom = clampZoom(v.zoom * factor);
  const s = scaleOf(f, zoom);
  return { zoom, cx: wx - (sx - f.ox) / s, cy: wy + (sy - f.oy) / s };
}

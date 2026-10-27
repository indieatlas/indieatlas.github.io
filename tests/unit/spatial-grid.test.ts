import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  screenToWorld,
  SpatialGrid,
  worldToScreen,
  zoomAt,
  type Frame,
} from '../../src/scripts/gl/spatial-grid.ts';

describe('アトラスの当たり判定と表示の変換', () => {
  const xs = new Float32Array([0, 0.5, -0.5, 0.51]);
  const ys = new Float32Array([0, 0.5, -0.5, 0.5]);
  const grid = new SpatialGrid(xs, ys, 0.05);

  it('半径内で最も近い点を返す', () => {
    expect(grid.nearest(0.01, 0.01, 0.05)).toBe(0);
    expect(grid.nearest(0.509, 0.5, 0.05)).toBe(3);
    expect(grid.nearest(0.3, 0.3, 0.05)).toBe(-1);
  });

  const frame: Frame = { ox: 400, oy: 300, span: 600 };
  it('世界座標と画面座標を相互に変換する', () => {
    const v = { zoom: 2, cx: 0.1, cy: -0.2 };
    const [sx, sy] = worldToScreen(v, frame, 0.3, 0.4);
    const [wx, wy] = screenToWorld(v, frame, sx, sy);
    expect(wx).toBeCloseTo(0.3);
    expect(wy).toBeCloseTo(0.4);
  });

  it('拡大縮小は 0.5〜6 倍で、指定した画面上の点を固定する', () => {
    expect(clampZoom(10)).toBe(6);
    expect(clampZoom(0.1)).toBe(0.5);
    const v = { zoom: 1, cx: 0, cy: 0 };
    const before = screenToWorld(v, frame, 500, 200);
    const next = zoomAt(v, frame, 500, 200, 2);
    const after = screenToWorld(next, frame, 500, 200);
    expect(next.zoom).toBe(2);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });
});

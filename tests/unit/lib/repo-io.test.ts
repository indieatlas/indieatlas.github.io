import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formatJson, readJson, writeJson } from '../../../scripts/lib/repo-io.ts';

const S = z.object({ schemaVersion: z.literal(1), b: z.string(), a: z.number().optional() });

describe('writeJson と readJson（04 §4.1.1）', () => {
  it('キーの順番はスキーマの定義順、2スペースの字下げ、末尾に改行1つ', () => {
    expect(formatJson(S, { a: 1, b: 'x', schemaVersion: 1 })).toBe(
      '{\n  "schemaVersion": 1,\n  "b": "x",\n  "a": 1\n}\n',
    );
  });

  it('スキーマにない項目は書かない', () => {
    expect(formatJson(S, { schemaVersion: 1, b: 'x', extra: true } as never)).not.toContain('extra');
  });

  it('スキーマに合わない値は書かない', () => {
    expect(() => formatJson(S, { schemaVersion: 2, b: 'x' } as never)).toThrow();
  });

  it('書いたものを読み戻せる', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-'));
    const file = path.join(dir, 'sub', 'x.json');
    writeJson(S, file, { schemaVersion: 1, b: 'y' });
    expect(readJson(S, file)).toEqual({ schemaVersion: 1, b: 'y' });
  });
});

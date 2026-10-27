import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

describe('npm scripts（03 §3.4）', () => {
  it.each([
    'dev',
    'prepare-site',
    'build',
    'check:types',
    'check:data',
    'check:dist',
    'check:publish',
    'test',
    'test:e2e',
    'research',
    'adopt',
    'ia',
    'seed:steam',
    'report:trial',
    'format',
  ])('%s が定義されている', (name) => {
    expect(pkg.scripts[name]).toBeTruthy();
  });
});

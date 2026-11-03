import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// .claude/skills/ のスキルの形式（12 §12.4、§12.9）
const SKILLS_DIR = '.claude/skills';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
const skills = fs
  .readdirSync(SKILLS_DIR)
  .filter((d) => fs.existsSync(path.join(SKILLS_DIR, d, 'SKILL.md')))
  .sort();
const documents = fs
  .readdirSync(SKILLS_DIR)
  .flatMap((d) => ['SKILL.md', 'RULES.md'].map((f) => path.join(SKILLS_DIR, d, f)).filter((f) => fs.existsSync(f)));

function frontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return {};
  return Object.fromEntries(
    m[1]!.split('\n').map((line) => {
      const i = line.indexOf(':');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
}

describe('スキル（12 §12.4）', () => {
  it('スキルがある', () => {
    expect(skills).toContain('ia-refresh');
  });

  it.each(skills)('%s の frontmatter は name と description だけで、name がディレクトリ名と一致する', (dir) => {
    const fm = frontmatter(fs.readFileSync(path.join(SKILLS_DIR, dir, 'SKILL.md'), 'utf8'));
    expect(Object.keys(fm).sort()).toEqual(['description', 'name']);
    expect(fm.name).toBe(dir);
    expect(fm.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(fm.name!.length).toBeLessThanOrEqual(64);
    expect(fm.description!.length).toBeGreaterThan(0);
    expect(fm.description!.length).toBeLessThanOrEqual(1024);
  });

  it.each(documents)('%s に書いた npm run のコマンドと docs/ のファイルが実在する', (file) => {
    const text = fs.readFileSync(file, 'utf8');
    for (const [, name] of text.matchAll(/npm run ([\w:-]+)/g)) {
      expect(pkg.scripts[name!], `npm run ${name}`).toBeTruthy();
    }
    for (const [doc] of text.matchAll(/docs\/[\w-]+\.md/g)) {
      expect(fs.existsSync(doc), doc).toBe(true);
    }
    for (const [, rel] of text.matchAll(/`((?:scripts|config|\.claude)\/[\w./-]+\.(?:ts|md|json))`/g)) {
      expect(fs.existsSync(rel!), rel).toBe(true);
    }
  });
});

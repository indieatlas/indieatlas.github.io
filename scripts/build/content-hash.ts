import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { VOLATILE_KEYS } from '../../schema/site-data.ts';
import { canonicalJson, omitKeysDeep } from '../lib/canonical-json.ts';
import { sha256Hex, sha256Tagged } from '../lib/hash.ts';
import { PROJECT_ROOT } from '../lib/repo-io.ts';

/** 公開に影響するコードの場所（07 §7.4.1） */
export const CODE_PATHS = [
  'src',
  'public',
  'schema',
  'scripts/build',
  'astro.config.mjs',
  'package-lock.json',
] as const;

export interface HashInputs {
  siteData: string;
  code: Record<string, string>;
  env: { SITE_URL: string; BASE_PATH: string };
}

/** サイト用データの全ファイルから、揮発する項目を除いてハッシュを計算する */
export function siteDataHash(files: Record<string, unknown>): string {
  return sha256Tagged(canonicalJson(omitKeysDeep(files, VOLATILE_KEYS)));
}

export function contentHash(inputs: HashInputs): string {
  return sha256Tagged(canonicalJson({ schemaVersion: 1, ...inputs }));
}

function git(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function* walk(p: string): Generator<string> {
  if (!fs.existsSync(p)) return;
  if (fs.statSync(p).isFile()) {
    yield p;
    return;
  }
  for (const name of fs.readdirSync(p).sort()) yield* walk(path.join(p, name));
}

/** 作業ツリーのファイルの内容から計算する（未コミットの変更があるとき） */
function contentTreeHash(rel: string): string {
  const abs = path.join(PROJECT_ROOT, rel);
  const parts: string[] = [];
  for (const file of walk(abs)) {
    parts.push(`${path.relative(abs, file)}\0${sha256Hex(fs.readFileSync(file))}`);
  }
  return `content:${sha256Hex(parts.join('\n'))}`;
}

/**
 * コードのツリーハッシュ。SOURCE_COMMIT（なければ HEAD）の git のツリーまたはブロブのハッシュを使い、
 * 作業ツリーに未コミットの変更がある場所はファイルの内容から計算する。
 */
export function codeHashes(sourceCommit = process.env.SOURCE_COMMIT ?? 'HEAD'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of CODE_PATHS) {
    const dirty = git(['status', '--porcelain', '--', rel]);
    const hash = dirty === '' ? git(['rev-parse', `${sourceCommit}:${rel}`]) : undefined;
    out[rel] = hash ?? contentTreeHash(rel);
  }
  return out;
}

export function sourceCommit(): string {
  return process.env.SOURCE_COMMIT ?? git(['rev-parse', 'HEAD']) ?? 'unknown';
}

import { createHash } from 'node:crypto';

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** `sha256:` を付けた形式（schema の Sha256） */
export function sha256Tagged(input: string | Uint8Array): string {
  return `sha256:${sha256Hex(input)}`;
}

export function shortHash(input: string, length = 16): string {
  return sha256Hex(input).slice(0, length);
}

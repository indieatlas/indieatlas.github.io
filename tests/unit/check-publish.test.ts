import { describe, expect, it } from 'vitest';
import { decidePublish } from '../../scripts/build/publish-check.ts';

const H = 'sha256:' + 'a'.repeat(64);
const ok = (hash: string) => async () => ({ status: 200, body: JSON.stringify({ contentHash: hash }) });

describe('check:publish（07 §7.6、受入基準8）', () => {
  it('公開中の manifest と同じなら、デプロイしない', async () => {
    expect(await decidePublish({ contentHash: H, force: false, fetchRemote: ok(H) })).toMatchObject({
      shouldDeploy: false,
      reason: 'unchanged',
    });
  });

  it('公開中の manifest のハッシュが古ければ、新しいデータがなくてもデプロイする', async () => {
    expect(
      await decidePublish({ contentHash: H, force: false, fetchRemote: ok('sha256:' + 'b'.repeat(64)) }),
    ).toMatchObject({
      shouldDeploy: true,
      reason: 'changed',
    });
  });

  it('404 ならデプロイする', async () => {
    const r = await decidePublish({
      contentHash: H,
      force: false,
      fetchRemote: async () => ({ status: 404, body: '' }),
    });
    expect(r).toMatchObject({ shouldDeploy: true, reason: 'not-deployed' });
  });

  it('タイムアウトは2回まで再試行し、それでも失敗したらデプロイする', async () => {
    let calls = 0;
    const r = await decidePublish({
      contentHash: H,
      force: false,
      fetchRemote: async () => {
        calls++;
        throw new Error('timeout');
      },
    });
    expect(calls).toBe(3);
    expect(r).toMatchObject({ shouldDeploy: true, reason: 'unknown-remote' });
  });

  it('再試行で取得できれば、その結果で判定する', async () => {
    let calls = 0;
    const r = await decidePublish({
      contentHash: H,
      force: false,
      fetchRemote: async () => {
        if (calls++ === 0) return { status: 503, body: '' };
        return { status: 200, body: JSON.stringify({ contentHash: H }) };
      },
    });
    expect(r.reason).toBe('unchanged');
  });

  it('形式が誤っていればデプロイする', async () => {
    const r = await decidePublish({
      contentHash: H,
      force: false,
      fetchRemote: async () => ({ status: 200, body: '<html>' }),
    });
    expect(r).toMatchObject({ shouldDeploy: true, reason: 'unknown-remote' });
  });

  it('FORCE_DEPLOY なら取得せずにデプロイする', async () => {
    const r = await decidePublish({
      contentHash: H,
      force: true,
      fetchRemote: async () => {
        throw new Error('should not be called');
      },
    });
    expect(r).toMatchObject({ shouldDeploy: true, reason: 'forced' });
  });
});

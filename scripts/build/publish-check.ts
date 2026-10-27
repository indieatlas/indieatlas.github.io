/** 公開の判定（07 §7.6）。公開中の manifest と今回のビルドを比べる */
export type PublishReason = 'forced' | 'unchanged' | 'changed' | 'not-deployed' | 'unknown-remote';

export interface RemoteResponse {
  status: number;
  body: string;
}

export interface PublishDecision {
  shouldDeploy: boolean;
  reason: PublishReason;
  contentHash: string;
  remoteHash?: string;
}

export async function decidePublish(opts: {
  contentHash: string;
  force: boolean;
  fetchRemote: () => Promise<RemoteResponse>; // 失敗したら例外を投げる
  retries?: number;
}): Promise<PublishDecision> {
  const { contentHash } = opts;
  if (opts.force) return { shouldDeploy: true, reason: 'forced', contentHash };
  const attempts = (opts.retries ?? 2) + 1;
  for (let i = 0; i < attempts; i++) {
    let res: RemoteResponse;
    try {
      res = await opts.fetchRemote();
    } catch {
      continue; // タイムアウトなど。再試行する
    }
    if (res.status === 404) return { shouldDeploy: true, reason: 'not-deployed', contentHash };
    if (res.status !== 200) continue;
    let remoteHash: unknown;
    try {
      remoteHash = (JSON.parse(res.body) as { contentHash?: unknown }).contentHash;
    } catch {
      return { shouldDeploy: true, reason: 'unknown-remote', contentHash };
    }
    if (typeof remoteHash !== 'string') return { shouldDeploy: true, reason: 'unknown-remote', contentHash };
    if (remoteHash === contentHash) return { shouldDeploy: false, reason: 'unchanged', contentHash, remoteHash };
    return { shouldDeploy: true, reason: 'changed', contentHash, remoteHash };
  }
  return { shouldDeploy: true, reason: 'unknown-remote', contentHash };
}

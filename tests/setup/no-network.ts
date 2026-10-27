import net from 'node:net';

// テストから外部のサイトや LLM に接続しない（10 §10.2）。接続しようとしたら失敗させる
globalThis.fetch = (async (input: unknown) => {
  throw new Error(`network access is not allowed in tests: ${String(input)}`);
}) as typeof fetch;

net.connect = ((...args: unknown[]) => {
  throw new Error(`network access is not allowed in tests: ${JSON.stringify(args[0])}`);
}) as typeof net.connect;
net.createConnection = net.connect;

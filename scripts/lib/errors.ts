/** 利用者に原因を伝えて終了させるためのエラー */
export class UserError extends Error {
  override name = 'UserError';
}

/** 未実装のコマンドの入口で使う。メッセージを出して終了コード1で終わる */
export function notImplemented(command: string, ticket: string): never {
  console.error(`未実装: ${command}（${ticket} で実装する）`);
  process.exit(1);
}

/** CLI の入口を包み、例外を読みやすく表示して終了コード1で終わる */
export async function runMain(main: () => Promise<void> | void): Promise<void> {
  try {
    await main();
  } catch (e) {
    if (e instanceof UserError) console.error(e.message);
    else console.error(e);
    process.exit(1);
  }
}

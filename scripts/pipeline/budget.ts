import type { RuntimeConfig } from '../../schema/config.ts';

/**
 * 時間と費用の予算（06 §6.5.4）。soft の締め切りを過ぎたら新しいタスクを始めず、hard を過ぎたら実行中の
 * 呼び出しを止める。費用は、月の残り、1回の上限、1タスクの上限、探索の確保分で抑える
 */
export class Budget {
  readonly runLimit: number;
  spent = 0;
  private readonly softAt: number;
  private readonly hardAt: number;
  private readonly controller = new AbortController();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly runtime: RuntimeConfig,
    startMs: number,
    readonly monthSpent: number,
    private readonly clock: () => number = Date.now,
  ) {
    this.softAt = startMs + runtime.run.softDeadlineMinutes * 60_000;
    this.hardAt = startMs + runtime.run.hardDeadlineMinutes * 60_000;
    this.runLimit = Math.max(0, Math.min(runtime.budget.perRunLimit, runtime.budget.monthlyLimit - monthSpent));
    const ms = this.hardAt - clock();
    if (ms > 0) {
      this.timer = setTimeout(() => this.controller.abort(), ms);
      this.timer.unref?.();
    }
  }

  /** 月の予算を使い切っている（LLM を使わない collect-only の動作にする） */
  get monthExhausted(): boolean {
    return this.runtime.budget.monthlyLimit - this.monthSpent <= 0;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  softPassed(): boolean {
    return this.clock() >= this.softAt;
  }

  hardPassed(): boolean {
    return this.clock() >= this.hardAt;
  }

  record(usd: number): void {
    this.spent += usd;
  }

  /** 探索以外のタスクが使える上限。探索のタスクが残っている間は、確保分を残す */
  private limitFor(exploration: boolean, explorationPending: boolean): number {
    if (exploration || !explorationPending) return this.runLimit;
    return this.runLimit * (1 - this.runtime.exploration.minTaskShare);
  }

  /** 新しいタスクを始めてよいか */
  canStartTask(exploration: boolean, explorationPending: boolean): 'ok' | 'soft-deadline' | 'cost-budget' {
    if (this.softPassed()) return 'soft-deadline';
    if (this.spent >= this.limitFor(exploration, explorationPending)) return 'cost-budget';
    return 'ok';
  }

  /**
   * 呼び出しの前の確認。taskSpent はそのタスクで使った額。1タスクの上限を超えるときは、
   * 実行の予算に余裕がある場合だけ、結果の提出を促す最後の1回を許す（'final'）
   */
  allowCall(estimate: number, taskSpent: number, exploration: boolean, explorationPending: boolean): boolean | 'final' {
    if (this.hardPassed()) return false;
    if (this.spent + estimate > this.limitFor(exploration, explorationPending)) return false;
    if (taskSpent + estimate > this.runtime.budget.perTaskLimit) return 'final';
    return true;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}

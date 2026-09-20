import { createInterface } from 'node:readline/promises';
import { Browser } from './browser.js';
import { type ActOptions } from './actions.js';
import { Jev, modelConfig } from './jev.js';
import { readCredentials } from './credentials.js';
import { prepareAct, executePlan, planResult } from './semantic.js';
import { savePending, takePending } from './confirmation.js';

type Result = ReturnType<typeof planResult> & { confirmation?: { id: string; expiresAt: number; confirmCommand: string; cancelCommand: string } };

export function formatAct(result: Result): string {
  const { status, plan, uncertainties } = result.data;
  const lines = [status === 'needs_confirmation' ? '需要你确认，尚未执行。' : status === 'resolved' ? '操作预览，尚未执行。' : status === 'cancelled' ? '已取消，尚未执行。' : '操作已执行。',
    `页面：${plan.page}`, `操作：${plan.action}`];
  if (plan.target) lines.push(`目标：${plan.target}`);
  if (plan.value !== undefined) lines.push(`内容：${JSON.stringify(plan.value)}`);
  if (plan.clear !== undefined) lines.push(`原有内容：${plan.clear ? '清空后填写' : '保留并追加'}`, `输入后：${plan.submit ? '按回车提交' : '不提交'}`);
  if (status === 'needs_confirmation') {
    for (const issue of uncertainties) {
      lines.push(`原因：${issue.message}`);
      if (issue.alternatives.length > 1) lines.push(`可能的理解：${issue.alternatives.map(a => `${a.label}（${Math.round(a.probability * 100)}%）`).join('；')}`);
    }
    if (result.confirmation) lines.push('确认后只执行上面这份计划，有效期 5 分钟。',
      `执行：${result.confirmation.confirmCommand}`, `取消：${result.confirmation.cancelCommand}`);
  }
  if (result.data.result !== undefined) lines.push(JSON.stringify(result.data.result));
  return lines.join('\n') + '\n';
}

export async function runAct(options: ActOptions, browser: Browser, context: { session: string; json: boolean }) {
  const startupMs = Math.round(performance.now());
  const print = (result: Result) => process.stdout.write(context.json ? JSON.stringify(result) + '\n' : formatAct(result));
  if (options.confirm || options.cancel) {
    const plan = await takePending((options.confirm || options.cancel)!, context.session);
    print(options.cancel ? planResult(plan, 'cancelled') : await executePlan(plan, browser, true));
    return;
  }
  const jev = new Jev(modelConfig(process.env, readCredentials()));
  const plan = await prepareAct(options, browser, jev);
  const result: Result = await executePlan(plan, browser);
  result.meta.timings.cliStartupMs = startupMs;
  if (result.data.status !== 'needs_confirmation' || options.dryRun) { print(result); return; }
  const pending = await savePending(plan, context.session);
  result.confirmation = { ...pending,
    confirmCommand: `jev-browser page act ${context.session} --confirm ${pending.id}`,
    cancelCommand: `jev-browser page act ${context.session} --cancel ${pending.id}` };
  print(result);
  if (context.json || !process.stdin.isTTY || !process.stdout.isTTY) return;
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const cancel = new AbortController();
  input.once('SIGINT', () => cancel.abort());
  input.once('close', () => cancel.abort());
  try {
    const answer = await input.question('是否执行？[y/N] ', { signal: cancel.signal }).catch(error => {
      if (cancel.signal.aborted) return 'n';
      throw error;
    });
    const saved = await takePending(pending.id, context.session);
    print(/^(y|yes|是|执行)$/i.test(answer.trim()) ? await executePlan(saved, browser, true) : planResult(saved, 'cancelled'));
  } finally { input.close(); }
}

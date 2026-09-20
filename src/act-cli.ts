import { createInterface } from 'node:readline/promises';
import { Browser } from './browser.js';
import { command, type ActOptions } from './actions.js';
import { Jev, modelConfig } from './jev.js';
import { readCredentials } from './credentials.js';
import { prepareAct, executePlan, planResult } from './semantic.js';
import { savePending, takePending } from './confirmation.js';
import { JevError } from './errors.js';

type Result = ReturnType<typeof planResult> & { confirmation?: { id: string; expiresAt: number; confirmCommand: string; cancelCommand: string } };

async function askUrl(): Promise<string | undefined> {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const cancel = new AbortController();
  input.once('SIGINT', () => cancel.abort());
  input.once('close', () => cancel.abort());
  try {
    const value = (await input.question('请输入完整网址（如 https://example.com，直接回车取消）：', { signal: cancel.signal })
      .catch(error => { if (cancel.signal.aborted) return ''; throw error; })).trim();
    if (!value) return;
    command('open', { value });
    return value;
  } finally { input.close(); }
}

export function formatAct(result: Result): string {
  const { status, plan, uncertainties, session, pageContext } = result.data;
  const lines = [status === 'needs_confirmation' ? '需要你确认，尚未执行。' : status === 'resolved' ? '操作预览，尚未执行。' : status === 'cancelled' ? '已取消，尚未执行。' : '操作已执行。'];
  if (session) lines.push(`会话：${session}`);
  if (plan.tabId) lines.push(`标签页：${plan.tabId}`);
  if (plan.title !== undefined) lines.push(`标题：${plan.title || '（无标题）'}`);
  lines.push(`页面：${plan.page}`, `操作：${plan.action}`);
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
  if (status === 'executed' && pageContext && (pageContext.tabId !== plan.tabId || pageContext.url !== plan.page || pageContext.title !== plan.title))
    lines.push(`当前标签页：${pageContext.tabId}`, `当前标题：${pageContext.title || '（无标题）'}`, `当前页面：${pageContext.url}`);
  return lines.join('\n') + '\n';
}

export async function runAct(options: ActOptions, browser: Browser, context: { session: string; json: boolean }) {
  const startupMs = Math.round(performance.now());
  const interactive = !options.nonInteractive && !context.json && process.stdin.isTTY && process.stdout.isTTY;
  const print = (result: Result) => {
    result.data.session = context.session;
    process.stdout.write(context.json ? JSON.stringify(result) + '\n' : formatAct(result));
  };
  if (options.confirm || options.cancel) {
    const plan = await takePending((options.confirm || options.cancel)!, context.session);
    print(options.cancel ? planResult(plan, 'cancelled') : await executePlan(plan, browser, true));
    return;
  }
  const jev = new Jev(modelConfig(process.env, readCredentials()));
  let plan;
  try { plan = await prepareAct(options, browser, jev); }
  catch (error) {
    if (!(error instanceof JevError) || error.code !== 'NEEDS_URL') throw error;
    if (!interactive) {
      error.message += `\nReplace the example URL with your destination and retry: jevb page act ${context.session} "Open https://example.com"${options.dryRun ? ' --dry-run' : ''}${options.nonInteractive ? ' --non-interactive' : ''}${context.json ? ' --json' : ''}`;
      throw error;
    }
    process.stdout.write(error.message + '\n');
    const value = await askUrl();
    if (!value) { process.stdout.write('已取消，尚未执行。\n'); return; }
    plan = await prepareAct({ ...options, op: 'open', value }, browser, jev);
  }
  const result: Result = await executePlan(plan, browser);
  result.meta.timings.cliStartupMs = startupMs;
  if (result.data.status !== 'needs_confirmation') { print(result); return; }
  if (options.dryRun || options.nonInteractive) {
    print(result);
    process.exitCode = 2;
    return;
  }
  const pending = await savePending(plan, context.session);
  result.confirmation = { ...pending,
    confirmCommand: `jev-browser page act ${context.session} --confirm ${pending.id}`,
    cancelCommand: `jev-browser page act ${context.session} --cancel ${pending.id}` };
  print(result);
  if (!interactive) { process.exitCode = 2; return; }
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

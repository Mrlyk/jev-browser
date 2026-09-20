import { operations, targetless, needsValue, valueOptions, operation, command, type ActOptions, type Operation } from './actions.js';
import { asChoice, Jev, type Answer } from './jev.js';
import { snapshot, candidatesFor, assertFresh, type Candidate, type Snapshot } from './snapshot.js';
import { buildQuestions, describe, inputValues } from './questions.js';
import { Browser } from './browser.js';
import { JevError } from './errors.js';

export type Uncertainty = { subject: string; message: string; probability: number; margin: number;
  alternatives: Array<{ label: string; probability: number }> };
export type Plan = {
  operation: Operation; target?: Candidate; value?: string; hiddenValue: boolean; submit: boolean;
  before: Snapshot; scope?: string; dryRun?: boolean; uncertainties: Uncertainty[];
  meta: { modelRequests: number; decisions: Jev['evidence']; timings: Record<string, number>;
    snapshotId: string; candidateCount: number; truncated: boolean; scope?: string; valueSource?: string };
};

async function observe(browser: Browser, scope?: string): Promise<Snapshot> {
  return snapshot(await browser.request(['snapshot', ...(scope ? ['-s', scope] : [])]));
}

function uncertainty(answer: Answer, context: { subject: string; labels: Record<string, string> }, options: ActOptions): Uncertainty | undefined {
  const ranked = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
  const probability = answer.probabilities[answer.choice];
  const margin = probability - Math.max(0, ...ranked.filter(([id]) => id !== answer.choice).map(([, p]) => p));
  if (probability >= options.probability && margin >= options.margin) return;
  return { subject: context.subject, probability, margin,
    message: margin < options.margin ? `关于「${context.subject}」，有多个接近的可能，请核对准备执行的操作。` : `关于「${context.subject}」，还不够确定，请核对后确认。`,
    alternatives: ranked.filter(([, p]) => p > 0).slice(0, 3).map(([id, p]) => ({ label: context.labels[id] ?? id, probability: p })) };
}

export async function prepareAct(options: ActOptions, browser: Browser, jev: Jev): Promise<Plan> {
  const start = performance.now();
  if (options.op && needsValue.has(options.op) && options.value === undefined &&
    !Object.keys(['fill', 'type'].includes(options.op) ? inputValues(options.instruction) : valueOptions(options.op, options.instruction)).length)
    throw new JevError('NEEDS_INPUT', '没有识别出要输入的内容，请用引号标明文字，或使用 --value / --value-stdin。');
  const before = await observe(browser, options.scope);
  const snapshotMs = Math.round(performance.now() - start);
  const built = buildQuestions(options, before);
  const answers = Object.keys(built.questions).length ? (await jev.evaluate(built.state, built.questions)).answers : {};
  const uncertainties: Uncertainty[] = [];
  const pick = (id: string, subject: string): string => {
    const raw = answers[id];
    if (!raw) throw new JevError('NO_MATCH', `没有找到可用于${subject}的候选，请缩小范围或补充描述。`);
    const answer = asChoice(raw);
    const labels = built.questions[id].criteria;
    if (['none', 'ambiguous'].includes(answer.choice)) {
      const alternatives = Object.entries(answer.probabilities).filter(([key, p]) => !['none', 'ambiguous'].includes(key) && p > 0)
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key]) => labels[key]);
      throw new JevError(answer.choice === 'none' ? 'NO_MATCH' : 'AMBIGUOUS',
        `无法确定${subject}，尚未执行。${alternatives.length ? `可能的选项：${alternatives.join('；')}。` : ''}请补充目标或内容描述后重试。`);
    }
    const issue = uncertainty(answer, { subject, labels }, options);
    if (issue) uncertainties.push(issue);
    return answer.choice;
  };
  const intent = options.op ?? pick('operation', '要执行的动作');
  if (intent === 'multi_step') throw new JevError('MULTI_STEP_UNSUPPORTED', '这条指令包含多个独立操作，请拆开调用；同一输入框的输入和回车可以一起完成。');
  if (intent === 'unsupported') throw new JevError('UNSUPPORTED_OPERATION', '这条指令禁止执行或不属于支持的浏览器操作，尚未执行。');
  const clear = intent === 'input' ? pick('clear', '是否清空原有内容') === 'true' : intent === 'fill';
  const submit = intent === 'input' ? pick('submit', '是否输入后回车提交') === 'true' : false;
  const op = intent === 'input' ? (clear ? 'fill' : 'type') : operation(intent);
  if (options.valueStdin && !['fill', 'type', 'select'].includes(op)) throw new JevError('INVALID_VALUE', '--value-stdin 仅支持输入或选择选项。');
  if (!needsValue.has(op) && options.value !== undefined) throw new JevError('INVALID_VALUE', '该动作不接受 --value。');
  let target: Candidate | undefined;
  let candidates: Candidate[] = [];
  if (!targetless.has(op)) {
    candidates = candidatesFor(before, op);
    const ref = pick(intent === 'input' ? 'input_target' : 'target', intent === 'input' ? '要使用的输入框' : '要操作的目标');
    target = candidates.find(c => c.ref === ref);
    if (!target) throw new JevError('INVALID_TARGET', '模型选择的目标不能执行该操作，尚未执行。');
  }
  let value = options.value;
  if (needsValue.has(op) && value === undefined) {
    const id = !options.op && op === 'open' ? 'url' : !options.op && op === 'press' ? 'key' : !options.op && op === 'scroll' ? 'direction' : 'value';
    const selected = pick(id, '要输入或使用的内容');
    value = op === 'press' || op === 'scroll' ? selected : built.questions[id].criteria[selected];
  }
  command(op, { ref: target?.ref, value });
  return { operation: op, target, value, hiddenValue: options.value !== undefined, submit, before,
    scope: options.scope, dryRun: options.dryRun, uncertainties,
    meta: { modelRequests: jev.evidence.length, decisions: jev.evidence, timings: { snapshotMs, totalMs: Math.round(performance.now() - start) },
      snapshotId: before.id, candidateCount: candidates.length, truncated: false, scope: options.scope,
      valueSource: value === undefined ? undefined : options.valueStdin ? 'stdin' : options.value !== undefined ? 'explicit' : 'source-or-enumeration' } };
}

export async function validatePlan(plan: Plan, browser: Browser): Promise<void> {
  const current = await observe(browser, plan.scope);
  if (plan.target) assertFresh(plan.before, current, plan.target);
  else if (plan.before.origin !== current.origin || plan.before.pageId !== current.pageId || plan.before.frameId !== current.frameId)
    throw new JevError('STALE_TARGET', '当前页面已变化，请重新发出指令。');
  if (plan.target && plan.target.role.toLowerCase() !== 'statictext') {
    if ((await browser.request(['is', 'visible', `@${plan.target.ref}`]))?.visible !== true)
      throw new JevError('STALE_TARGET', '目标当前不可见，请重新发出指令。');
    if (!['get_text', 'scrollintoview'].includes(plan.operation) &&
      (await browser.request(['is', 'enabled', `@${plan.target.ref}`]))?.enabled !== true)
      throw new JevError('STALE_TARGET', '目标当前不可用，请重新发出指令。');
  }
}

export function planResult(plan: Plan, status: 'needs_confirmation' | 'resolved' | 'executed' | 'cancelled', result?: unknown) {
  return { success: true, data: { status, operation: plan.operation, target: plan.target,
    plan: { page: plan.before.origin, action: operations[plan.operation],
      target: plan.target ? describe(plan.target) : undefined,
      value: plan.value === undefined ? undefined : plan.hiddenValue ? '（输入内容已隐藏）' : plan.value,
      clear: ['fill', 'type'].includes(plan.operation) ? plan.operation === 'fill' : undefined,
      submit: plan.submit }, uncertainties: plan.uncertainties,
    result: plan.operation === 'get_text' ? result : undefined }, meta: plan.meta };
}

export async function executePlan(plan: Plan, browser: Browser, confirmed = false) {
  const start = performance.now();
  await validatePlan(plan, browser);
  plan.meta.timings.validationMs = Math.round(performance.now() - start);
  if ((plan.uncertainties.length && !confirmed) || plan.dryRun) {
    plan.meta.timings.totalMs += Math.round(performance.now() - start);
    return planResult(plan, plan.uncertainties.length && !confirmed ? 'needs_confirmation' : 'resolved');
  }
  const execution = performance.now();
  let dispatched = false;
  try {
    dispatched = true;
    const result = await browser.request(command(plan.operation, { ref: plan.target?.ref, value: plan.value }), { dispatch: true, privateValue: plan.value });
    if (plan.submit) {
      // Do not submit on a new page or a replaced field after input handlers run.
      await validatePlan(plan, browser);
      await browser.request(['focus', `@${plan.target!.ref}`], { dispatch: true, privateValue: plan.value });
      await validatePlan(plan, browser);
      await browser.request(['press', 'Enter'], { dispatch: true, privateValue: plan.value });
    }
    plan.meta.timings.executionMs = Math.round(performance.now() - execution);
    plan.meta.timings.totalMs += Math.round(performance.now() - start);
    return planResult(plan, 'executed', result);
  } catch (error) {
    if (dispatched && error instanceof JevError)
      throw new JevError(error.code, plan.submit ? '输入或提交过程未完成；可能已填入文字，请检查页面后再操作，不要直接重试。' : error.message, true);
    throw error;
  }
}

export async function act(options: ActOptions, browser: Browser, jev: Jev) {
  return executePlan(await prepareAct(options, browser, jev), browser);
}

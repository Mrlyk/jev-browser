import { operations, targetless, needsValue, valueOptions, operation, command, type ActOptions, type Operation } from './actions.js';
import { asChoice, Jev, type Answer } from './jev.js';
import { snapshot, candidatesFor, assertFresh, pageContext, type PageContext, type Candidate, type Snapshot } from './snapshot.js';
import { buildQuestions, describe, inputValues } from './questions.js';
import { Browser } from './browser.js';
import { JevError, withDecisionMeta } from './errors.js';
import { sites } from './sites.js';

export type Uncertainty = { subject: string; message: string; probability: number; margin: number;
  alternatives: Array<{ label: string; probability: number; ref?: string }> };
export type Plan = {
  operation: Operation; target?: Candidate; value?: string; hiddenValue: boolean; submit: boolean;
  before: Snapshot; scope?: string; dryRun?: boolean; uncertainties: Uncertainty[];
  newTab?: boolean;
  afterPage?: PageContext;
  meta: { modelRequests: number; decisions: Jev['evidence']; timings: Record<string, number>;
    snapshotId: string; candidateCount: number; truncated: boolean; scope?: string; valueSource?: string };
};

async function observe(browser: Browser, scope?: string): Promise<Snapshot> {
  return snapshot(await browser.request(['snapshot', ...(scope ? ['-s', scope] : [])]));
}

async function observeForPlanning(options: ActOptions, browser: Browser) {
  try { return { before: await observe(browser, options.scope), tabGone: undefined }; }
  catch (error) {
    if (!(error instanceof JevError) || error.code !== 'BROWSER_ERROR' ||
      !error.message.startsWith('tab_gone:') || (options.op && options.op !== 'open')) throw error;
    // No page was observed. Only a context-free open instruction may proceed.
    const before: Snapshot = { id: 'tab-gone', origin: '', pageId: '', frameId: null, candidates: [] };
    return { before, tabGone: error };
  }
}

function uncertainty(answer: Answer, context: { subject: string; labels: Record<string, string> }, options: ActOptions): Uncertainty | undefined {
  const ranked = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
  const probability = answer.probabilities[answer.choice];
  const margin = probability - Math.max(0, ...ranked.filter(([id]) => id !== answer.choice).map(([, p]) => p));
  if (probability >= options.probability && margin >= options.margin) return;
  return { subject: context.subject, probability, margin,
    message: margin < options.margin ? `关于「${context.subject}」，有多个接近的可能，请核对准备执行的操作。` : `关于「${context.subject}」，还不够确定，请核对后确认。`,
    alternatives: ranked.filter(([, p]) => p > 0).slice(0, 3).map(([id, p]) => ({ label: context.labels[id] ?? id, probability: p,
      ...(options.interactive && /^e\d+$/.test(id) ? { ref: id } : {}) })) };
}

export async function prepareAct(options: ActOptions, browser: Browser, jev: Jev): Promise<Plan> {
  try { return await prepare(options, browser, jev); }
  catch (error) { throw withDecisionMeta(error, { modelRequests: jev.evidence.length, decisions: jev.evidence }); }
}

async function prepare(options: ActOptions, browser: Browser, jev: Jev): Promise<Plan> {
  const start = performance.now();
  if (options.op && options.op !== 'open' && needsValue.has(options.op) && options.value === undefined &&
    !Object.keys(['fill', 'type'].includes(options.op) ? inputValues(options.instruction) : valueOptions(options.op, options.instruction)).length)
    throw new JevError('NEEDS_INPUT', 'No input value found. Quote the text or provide --value / --value-stdin.');
  const { before, tabGone } = await observeForPlanning(options, browser);
  const snapshotMs = Math.round(performance.now() - start);
  const built = buildQuestions(options, before);
  const answers = Object.keys(built.questions).length ? (await jev.evaluate(built.state, built.questions, options.signal)).answers : {};
  options.signal?.throwIfAborted();
  const uncertainties: Uncertainty[] = [];
  const pick = (id: string, subject: string): string => {
    const raw = answers[id];
    if (!raw) throw new JevError('NO_MATCH', `No candidates available for "${id}". Narrow the scope or provide a more specific instruction.`);
    const answer = asChoice(raw);
    const labels = built.questions[id].criteria;
    if (options.interactive && answer.choice === 'ambiguous' && ['target', 'input_target'].includes(id)) {
      const choices = Object.entries(answer.probabilities).filter(([key]) => /^e\d+$/.test(key))
        .sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (choices.length) {
        uncertainties.push({ subject, message: '请选择具体目标。', probability: 0, margin: 0,
          alternatives: choices.map(([ref, probability]) => ({ ref, label: labels[ref], probability })) });
        return choices[0][0];
      }
    }
    if (['none', 'ambiguous'].includes(answer.choice)) {
      const alternatives = Object.entries(answer.probabilities).filter(([key, p]) => !['none', 'ambiguous'].includes(key) && p > 0)
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key]) => labels[key]);
      throw new JevError(answer.choice === 'none' ? 'NO_MATCH' : 'AMBIGUOUS',
        `Could not resolve "${id}". No action was taken.${alternatives.length ? ` Possible matches: ${alternatives.join('; ')}.` : ''} Provide a more specific instruction and retry.`);
    }
    const issue = uncertainty(answer, { subject, labels }, options);
    if (issue) uncertainties.push(issue);
    return answer.choice;
  };
  const intent = options.op ?? pick('operation', '要执行的动作');
  if (tabGone && intent !== 'open') throw tabGone;
  if (intent === 'multi_step') throw new JevError('MULTI_STEP_UNSUPPORTED', 'Multiple independent actions are not supported. Split them into separate commands; typing and submitting the same input can be combined.');
  if (intent === 'unsupported') throw new JevError('UNSUPPORTED_OPERATION', 'The instruction prohibits execution or does not describe a supported browser action. No action was taken.');
  const clear = intent === 'input' ? pick('clear', '是否清空原有内容') === 'true' : intent === 'fill';
  const submit = intent === 'input' ? pick('submit', '是否输入后回车提交') === 'true' : false;
  const op = intent === 'input' ? (clear ? 'fill' : 'type') : operation(intent);
  if (options.valueStdin && !['fill', 'type', 'select'].includes(op)) throw new JevError('INVALID_VALUE', '--value-stdin is only supported for fill, type, and select.');
  if (!needsValue.has(op) && options.value !== undefined) throw new JevError('INVALID_VALUE', 'This action does not accept --value.');
  let target: Candidate | undefined;
  let candidates: Candidate[] = [];
  if (!targetless.has(op)) {
    candidates = candidatesFor(before, op);
    const ref = pick(intent === 'input' ? 'input_target' : 'target', intent === 'input' ? '要使用的输入框' : '要操作的目标');
    target = candidates.find(c => c.ref === ref);
    if (!target) throw new JevError('INVALID_TARGET', 'The selected target does not support this action. No action was taken.');
  }
  let value = options.value;
  if (needsValue.has(op) && value === undefined) {
    const id = !options.op && op === 'open' ? 'url' : !options.op && op === 'press' ? 'key' : !options.op && op === 'scroll' ? 'direction' : 'value';
    if (op === 'open' && ['none', 'ambiguous'].includes(asChoice(answers[id]).choice))
      throw new JevError('NEEDS_URL', 'Could not resolve the destination. Provide a full URL starting with https:// or http://. No action was taken.');
    const selected = pick(id, op === 'open' ? '要打开的网站或网址' : '要输入或使用的内容');
    value = op === 'press' || op === 'scroll' ? selected : op === 'open' && Object.hasOwn(sites, selected)
      ? sites[selected].url : built.questions[id].criteria[selected];
  }
  command(op, { ref: target?.ref, value });
  return { operation: op, target, value, hiddenValue: options.value !== undefined, submit, before,
    ...(tabGone ? { newTab: true } : {}),
    scope: options.scope, dryRun: options.dryRun, uncertainties,
    meta: { modelRequests: jev.evidence.length, decisions: jev.evidence, timings: { snapshotMs, totalMs: Math.round(performance.now() - start) },
      snapshotId: before.id, candidateCount: candidates.length, truncated: false, scope: options.scope,
      valueSource: value === undefined ? undefined : options.valueStdin ? 'stdin' : options.value !== undefined ? 'explicit' : 'source-or-enumeration' } };
}

export async function validatePlan(plan: Plan, browser: Browser): Promise<void> {
  if (plan.newTab) {
    if (plan.operation !== 'open' || plan.target)
      throw new JevError('INVALID_PLAN', 'Only opening a URL can recover a closed tab.');
    command('open', { value: plan.value });
    return;
  }
  const current = await observe(browser, plan.scope);
  if (plan.target) assertFresh(plan.before, current, plan.target);
  else if (plan.before.origin !== current.origin || plan.before.pageId !== current.pageId || plan.before.frameId !== current.frameId)
    throw new JevError('STALE_TARGET', 'The page has changed. Run the command again to inspect the current page.');
  if (plan.target && plan.target.role.toLowerCase() !== 'statictext') {
    const checkEnabled = !['get_text', 'scrollintoview'].includes(plan.operation);
    const checks = [['is', 'visible', `@${plan.target.ref}`]];
    if (checkEnabled) checks.push(['is', 'enabled', `@${plan.target.ref}`]);
    const [visibility, availability] = await browser.requestBatch(checks);
    if (visibility?.visible !== true)
      throw new JevError('STALE_TARGET', 'The target is no longer visible. Inspect the page before retrying.');
    if (checkEnabled && availability?.enabled !== true)
      throw new JevError('STALE_TARGET', 'The target is no longer enabled. Inspect the page before retrying.');
  }
}

export function planResult(plan: Plan, status: 'needs_confirmation' | 'resolved' | 'executed' | 'cancelled', result?: unknown) {
  return { success: true, data: { status, operation: plan.operation, target: plan.target,
    session: plan.before.pageContext?.session, pageContext: plan.afterPage ?? plan.before.pageContext,
    plan: { page: plan.newTab ? '新标签页' : plan.before.origin,
      action: plan.newTab ? '新建标签页并打开网页' : operations[plan.operation],
      ...(plan.newTab ? { newTab: true } : {}),
      tabId: plan.before.pageContext?.tabId, title: plan.before.pageContext?.title,
      target: plan.target ? describe(plan.target) : undefined,
      value: plan.value === undefined ? undefined : plan.hiddenValue ? '（输入内容已隐藏）' : plan.value,
      clear: ['fill', 'type'].includes(plan.operation) ? plan.operation === 'fill' : undefined,
      submit: plan.submit }, uncertainties: plan.uncertainties,
    result: plan.operation === 'get_text' ? result : undefined }, meta: plan.meta };
}

export async function executePlan(plan: Plan, browser: Browser, confirmed = false) {
  try { return await execute(plan, browser, confirmed); }
  catch (error) { throw withDecisionMeta(error, plan.meta); }
}

async function execute(plan: Plan, browser: Browser, confirmed: boolean) {
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
    const args = plan.newTab ? ['tab', 'new', plan.value!] : command(plan.operation, { ref: plan.target?.ref, value: plan.value });
    const result = await browser.request(args, { dispatch: true, privateValue: plan.value });
    plan.afterPage = pageContext(result?.pageContext);
    if (plan.submit) {
      // Do not submit on a new page or a replaced field after input handlers run.
      await validatePlan(plan, browser);
      await browser.request(['focus', `@${plan.target!.ref}`], { dispatch: true, privateValue: plan.value });
      await validatePlan(plan, browser);
      const submitted = await browser.request(['press', 'Enter'], { dispatch: true, privateValue: plan.value });
      plan.afterPage = pageContext(submitted?.pageContext);
    }
    plan.meta.timings.executionMs = Math.round(performance.now() - execution);
    plan.meta.timings.totalMs += Math.round(performance.now() - start);
    return planResult(plan, 'executed', result);
  } catch (error) {
    if (dispatched && error instanceof JevError)
      throw new JevError(error.code, plan.submit ? 'Input or submission did not complete. Text may already have been entered. Check the page before retrying.' : error.message, true);
    throw error;
  }
}

export async function act(options: ActOptions, browser: Browser, jev: Jev) {
  return executePlan(await prepareAct(options, browser, jev), browser);
}

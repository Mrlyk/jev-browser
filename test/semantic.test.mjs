import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, prepareAct, executePlan } from '../dist/semantic.js';
import { Jev, modelConfig } from '../dist/jev.js';
import { parseArgs } from '../dist/arguments.js';
import { snapshot, candidatesFor } from '../dist/snapshot.js';
import { command, quotedValues } from '../dist/actions.js';
import { JevError } from '../dist/errors.js';

const data = () => ({ origin: 'http://localhost/', pageId: 'p1', frameId: null,
  snapshot: '- document\n  - region "入住信息":\n    - button "确认" [ref=e1]\n    - textbox "姓名" [ref=e2]\n  - region "发票信息":\n    - button "确认" [ref=e3]',
  refs: { e1: { role: 'button', name: '确认', backendNodeId: 1 }, e2: { role: 'textbox', name: '姓名', backendNodeId: 2 }, e3: { role: 'button', name: '确认', backendNodeId: 3 } },
});
const options = (extra = {}) => ({ instruction: '入住信息的确认按钮', op: 'click', probability: 0.85, margin: 0.2, ...extra });
function setup(selections, changed) {
  const requests = [], commands = [];
  let snapshots = 0;
  const jev = new Jev(modelConfig({ TYPESAFE_API_KEY: 'test' }), async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    const answers = Object.fromEntries(Object.entries(request.questions).map(([id, q]) => {
      if (q.type === 'noul') return [id, { type: 'noul', noul: selections[id] ?? (id === 'clear' ? 1 : 0) }];
      const selected = selections[id] ?? (id === 'input_target' ? selections.target : undefined) ?? 'none';
      if (typeof selected === 'object') return [id, { type: 'choice', confidence: 0.5, choice: selected.choice,
        probabilities: { ...Object.fromEntries(Object.keys(q.criteria).map(k => [k, 0])), ...selected.probabilities } }];
      return [id, { type: 'choice', choice: selected, confidence: 1,
        probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === selected ? 1 : 0])) }];
    }));
    return new Response(JSON.stringify({ model: 'jev-fixture', answers }));
  });
  const browser = { request: async (args, config) => {
    commands.push({ args, config });
    if (args[0] === 'snapshot') { snapshots++; return snapshots > 1 && changed ? changed : data(); }
    if (args[0] === 'is') return { visible: true, enabled: true };
    return { text: '订单金额 100', value: args.at(-1) };
  } };
  return { jev, browser, requests, commands };
}

test('同名按钮保留区域，选择正确目标只派发一次', async () => {
  const s = setup({ target: 'e1' });
  const result = await act(options(), s.browser, s.jev);
  assert.equal(result.data.status, 'executed');
  assert.match(s.requests[0].questions.target.criteria.e1, /入住信息/);
  assert.match(s.requests[0].questions.target.criteria.e3, /发票信息/);
  assert.deepEqual(s.commands.filter(c => c.config?.dispatch).map(c => c.args), [['click', '@e1']]);
});

test('dry-run 观察与复核后不派发', async () => {
  const s = setup({ target: 'e1' });
  assert.equal((await act(options({ dryRun: true }), s.browser, s.jev)).data.status, 'resolved');
  assert.equal(s.commands.filter(c => c.config?.dispatch).length, 0);
});

test('none、歧义、多步、否定不执行', async () => {
  for (const [selections, opts, code] of [
    [{ target: 'none' }, options(), 'NO_MATCH'],
    [{ target: 'ambiguous' }, options(), 'AMBIGUOUS'],
    [{ operation: 'multi_step' }, options({ op: undefined, instruction: '点击确认再填写姓名' }), 'MULTI_STEP_UNSUPPORTED'],
    [{ operation: 'unsupported' }, options({ op: undefined, instruction: '不要点击确认' }), 'UNSUPPORTED_OPERATION'],
  ]) {
    const s = setup(selections);
    await assert.rejects(act(opts, s.browser, s.jev), { code });
    assert.equal(s.commands.filter(c => c.config?.dispatch).length, 0);
  }
});

test('页面切换、节点替换、上下文变化均拒绝', async () => {
  for (const mutate of [d => { d.pageId = 'p2'; }, d => { d.refs.e1.backendNodeId = 99; },
    d => { d.snapshot = d.snapshot.replace('入住信息', '支付信息'); }, d => { d.frameId = 'other'; }]) {
    const changed = data(); mutate(changed);
    const s = setup({ target: 'e1' }, changed);
    await assert.rejects(act(options(), s.browser, s.jev), { code: 'STALE_TARGET' });
    assert.equal(s.commands.filter(c => c.config?.dispatch).length, 0);
  }
});

test('原文值选择与目标独立，空白、换行、shell 字符保持原样', async () => {
  const secret = '  x; $(touch nope) `a`\n';
  const s = setup({ target: 'e2' });
  const result = await act(options({ op: 'fill', instruction: '姓名', value: secret, valueStdin: true }), s.browser, s.jev);
  assert.equal(s.commands.at(-1).args[2], secret);
  assert.equal(JSON.stringify(s.requests).includes(secret), false);
  assert.equal(JSON.stringify(result).includes('touch nope'), false);
  const q = setup({ operation: 'input', target: 'e2', value: 'v1' });
  await act(options({ op: undefined, instruction: '在“姓名”中填写“张三”' }), q.browser, q.jev);
  assert.deepEqual(q.commands.at(-1).args, ['fill', '@e2', '张三']);
  assert.equal(q.requests.length, 1);
  for (const key of ['operation', 'input_target', 'clear', 'submit', 'value']) assert.ok(q.requests[0].questions[key]);
});

test('已知动作时，目标与原文值在一次请求中批量判断', async () => {
  const s = setup({ target: 'e2', value: 'v1' });
  await act(options({ op: 'fill', instruction: '在“姓名”中填写“张三”' }), s.browser, s.jev);
  assert.equal(s.requests.length, 1);
  assert.deepEqual(Object.keys(s.requests[0].questions).sort(), ['target', 'value']);
  assert.deepEqual(s.commands.at(-1).args, ['fill', '@e2', '张三']);
});

test('缺少参数立即停止，未知操作与协议不放行', async () => {
  const s = setup({ target: 'e2' });
  await assert.rejects(act(options({ op: 'fill' }), s.browser, s.jev), { code: 'NEEDS_INPUT' });
  assert.equal(s.commands.length, 0);
  assert.throws(() => command('open', { value: 'javascript:alert(1)' }), { code: 'INVALID_VALUE' });
  assert.throws(() => command('press', { value: 'invented' }), { code: 'INVALID_VALUE' });
  assert.deepEqual(quotedValues('填写“”和“ A ”'), ['', ' A ']);
});

test('候选超限明确报错，未截断', () => {
  const observation = snapshot(data());
  observation.candidates = Array.from({ length: 254 }, (_, i) => ({ ...observation.candidates[0], ref: `e${i}` }));
  assert.throws(() => candidatesFor(observation, 'click'), { code: 'TOO_MANY_CANDIDATES' });
});

test('解析带 checked、expanded 等状态的真实上游 ref 格式', () => {
  const d = data();
  d.snapshot = '- checkbox "协议" [checked=false, ref=e1]\n- combobox "人数" [expanded=false, ref=e2]: 1人';
  d.refs.e1.role = 'checkbox'; d.refs.e2.role = 'combobox';
  const parsed = snapshot(d);
  assert.deepEqual(parsed.candidates.map(c => c.ref), ['e1', 'e2']);
  assert.equal(candidatesFor(parsed, 'check')[0].ref, 'e1');
});

test('日期填写选择整个原生控件，排除内部年月日片段', () => {
  const d = data();
  d.snapshot = '- Date "离店日期" [ref=e1]: 2026-10-12\n  - spinbutton "年" [ref=e2]: 2026\n- spinbutton "房间数量" [ref=e3]: 1';
  d.refs.e1 = { role: 'Date', name: '离店日期', backendNodeId: 1 };
  d.refs.e2 = { role: 'spinbutton', name: '年', backendNodeId: 2 };
  d.refs.e3 = { role: 'spinbutton', name: '房间数量', backendNodeId: 3 };
  assert.deepEqual(candidatesFor(snapshot(d), 'fill').map(c => c.ref), ['e1', 'e3']);
});

test('参数解析保留值、全局作用域，并防止把参数值 act 当命令', () => {
  const p = parseArgs(['page', 'act', 'act', '--op', 'fill', '姓名', '--value', '--json', '--json']);
  assert.equal(p.session, 'act'); assert.equal(p.options.value, '--json'); assert.equal(p.json, true);
  assert.equal(parseArgs(['element', 'fill', 'demo', '#name', 'act']).name, 'fill');
  assert.equal(parseArgs(['--restore', 'saved-login', 'page', 'snapshot', 'demo']).name, 'snapshot');
  assert.equal(parseArgs(['--restore', 'page', 'act', 'demo', '--op', 'click', '按钮']).name, 'act');
  assert.throws(() => parseArgs(['page', 'act', 'demo', '按钮', '--min-probability', 'oops']), { code: 'INVALID_ARGUMENT' });
});

test('执行未知不自动再次调用', async () => {
  const s = setup({ target: 'e1' }); let dispatched = 0;
  const original = s.browser.request;
  s.browser.request = async (args, config) => {
    if (config?.dispatch) { dispatched++; throw Object.assign(new Error('unknown'), { code: 'EXECUTION_UNKNOWN' }); }
    return original(args, config);
  };
  await assert.rejects(act(options(), s.browser, s.jev), { code: 'EXECUTION_UNKNOWN' });
  assert.equal(dispatched, 1);
});

test('搜索同时判断动作、输入框、清空、回车和内容，无关分支不阻塞', async () => {
  const s = setup({ operation: 'input', input_target: 'e2', clear: 0.99, submit: 0.99, value: 'v0', target: 'ambiguous' });
  const result = await act(options({ op: undefined, instruction: '搜索 jev' }), s.browser, s.jev);
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].questions.clear.type, 'noul');
  assert.equal(s.requests[0].questions.submit.type, 'noul');
  assert.equal(result.data.plan.value, 'jev');
  assert.equal(result.data.plan.clear, true);
  assert.equal(result.data.plan.submit, true);
  assert.deepEqual(s.commands.filter(c => c.config?.dispatch).map(c => c.args), [
    ['fill', '@e2', 'jev'], ['focus', '@e2'], ['press', 'Enter'],
  ]);
});

test('模型决定保留旧值和不提交，显式 fill/type 保留原子行为', async () => {
  const s = setup({ operation: 'input', input_target: 'e2', clear: 0.01, submit: 0.01, value: 'v0' });
  const result = await act(options({ op: undefined, instruction: '追加“jev”但不提交' }), s.browser, s.jev);
  assert.equal(result.data.plan.clear, false);
  assert.equal(result.data.plan.submit, false);
  assert.deepEqual(s.commands.filter(c => c.config?.dispatch).map(c => c.args), [['type', '@e2', 'jev']]);
  for (const op of ['fill', 'type']) {
    const explicit = setup({ target: 'e2' });
    await act(options({ op, instruction: '搜索框', value: 'jev' }), explicit.browser, explicit.jev);
    assert.equal(explicit.requests[0].questions.clear, undefined);
    assert.equal(explicit.requests[0].questions.submit, undefined);
    assert.deepEqual(explicit.commands.filter(c => c.config?.dispatch).map(c => c.args), [[op, '@e2', 'jev']]);
  }
});

test('任何相关判断未过阈值都返回待确认计划，尚未执行', async () => {
  const uncertain = choice => ({ choice, probabilities: { [choice]: 0.65, none: 0.35 } });
  for (const override of [
    { operation: { choice: 'input', probabilities: { input: 0.65, click: 0.35 } } },
    { input_target: uncertain('e2') }, { value: uncertain('v0') }, { clear: 0.6 }, { submit: 0.6 },
  ]) {
    const s = setup({ operation: 'input', input_target: 'e2', clear: 0.99, submit: 0.99, value: 'v0', ...override });
    const plan = await prepareAct(options({ op: undefined, instruction: '搜索 jev' }), s.browser, s.jev);
    const result = await executePlan(plan, s.browser);
    assert.equal(result.data.status, 'needs_confirmation');
    assert.equal(result.data.uncertainties.length, 1);
    assert.equal(result.data.plan.value, 'jev');
    assert.equal(result.data.plan.submit, true);
    assert.equal(s.commands.filter(c => c.config?.dispatch).length, 0);
    assert.equal((await executePlan(plan, s.browser, true)).data.status, 'executed');
    assert.equal(s.requests.length, 1);
  }
});

test('确认后仍拒绝页面变化，dry-run 即使确认也不执行', async () => {
  const s = setup({ target: { choice: 'e1', probabilities: { e1: 0.55, e3: 0.45 } } });
  const plan = await prepareAct(options(), s.browser, s.jev);
  const original = s.browser.request;
  s.browser.request = async (args, config) => args[0] === 'snapshot' ? { ...data(), pageId: 'different' } : original(args, config);
  await assert.rejects(executePlan(plan, s.browser, true), { code: 'STALE_TARGET' });
  assert.equal(s.commands.filter(c => c.config?.dispatch).length, 0);
  const d = setup({ target: 'e1' });
  const preview = await prepareAct(options({ dryRun: true }), d.browser, d.jev);
  assert.equal((await executePlan(preview, d.browser, true)).data.status, 'resolved');
  assert.equal(d.commands.filter(c => c.config?.dispatch).length, 0);
});

test('填写后页面变化或提交失败报告部分执行，不重试', async () => {
  for (const failure of ['navigation', 'submit']) {
    const s = setup({ operation: 'input', input_target: 'e2', clear: 1, submit: 1, value: 'v0' });
    let filled = false;
    const dispatched = [];
    const original = s.browser.request;
    s.browser.request = async (args, config) => {
      if (config?.dispatch) dispatched.push(args);
      if (args[0] === 'fill') filled = true;
      if (filled && args[0] === 'snapshot' && failure === 'navigation') return { ...data(), pageId: 'other' };
      if (args[0] === 'press' && failure === 'submit') throw new JevError('EXECUTION_UNKNOWN', 'timeout', true);
      return original(args, config);
    };
    await assert.rejects(act(options({ op: undefined, instruction: '搜索 jev' }), s.browser, s.jev),
      { code: failure === 'navigation' ? 'STALE_TARGET' : 'EXECUTION_UNKNOWN', dispatched: true });
    assert.equal(dispatched.filter(args => args[0] === 'fill').length, 1);
    assert.equal(dispatched.filter(args => args[0] === 'press').length, failure === 'navigation' ? 0 : 1);
  }
});

test('确认编号不可同时修改计划或阈值', () => {
  assert.equal(parseArgs(['page', 'act', 'demo', '--confirm', 'jev-id']).options.confirm, 'jev-id');
  assert.equal(parseArgs(['page', 'act', 'demo', '--cancel', 'jev-id']).options.cancel, 'jev-id');
  for (const extra of [['搜索别的内容'], ['--value', 'other'], ['--dry-run'], ['--scope', '#other'], ['--min-probability', '0'], ['--cancel', 'id']])
    assert.throws(() => parseArgs(['page', 'act', 'demo', '--confirm', 'jev-id', ...extra]), { code: 'INVALID_ARGUMENT' });
});

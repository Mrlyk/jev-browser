import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act } from '../dist/semantic.js';
import { Jev, modelConfig } from '../dist/jev.js';
import { parseArgs } from '../dist/arguments.js';
import { snapshot, candidatesFor } from '../dist/snapshot.js';
import { command, quotedValues } from '../dist/actions.js';

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
      const selected = selections[id];
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
  const q = setup({ operation: 'fill', target: 'e2', value: 'v1' });
  await act(options({ op: undefined, instruction: '在“姓名”中填写“张三”' }), q.browser, q.jev);
  assert.deepEqual(q.commands.at(-1).args, ['fill', '@e2', '张三']);
  assert.equal(q.requests.length, 2);
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
  const p = parseArgs(['--session', 'act', 'act', '--op', 'fill', '姓名', '--value', '--json', '--json']);
  assert.equal(p.session, 'act'); assert.equal(p.options.value, '--json'); assert.equal(p.json, true);
  assert.equal(parseArgs(['fill', '#name', 'act']).name, 'fill');
  assert.equal(parseArgs(['--restore', 'saved-login', 'snapshot']).name, 'snapshot');
  assert.equal(parseArgs(['--restore', 'act', '--op', 'click', '按钮']).name, 'act');
  assert.throws(() => parseArgs(['act', '按钮', '--min-probability', 'oops']), { code: 'INVALID_ARGUMENT' });
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

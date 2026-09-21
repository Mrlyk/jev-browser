import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Controller } from '../dist/interactive/controller.js';
import { browserArgs, parseInteractive } from '../dist/interactive/options.js';
import { commands, navigationCommand, parseCommand } from '../dist/interactive/commands.js';
import { clean } from '../dist/interactive/messages.js';
import { edit, graphemes } from '../dist/interactive/editor.js';
import { Jev } from '../dist/jev.js';
import { Models } from '../dist/interactive/models.js';

function fixture(settings = {}) {
  const calls = [], requests = [];
  const state = { pageId: 'p1', url: 'https://test.local/', active: true, document: 1 };
  const jev = new Jev({ transport: 'typesafe', model: 'fixture', key: 'fixture', endpoint: 'https://example.invalid' }, async (_url, init) => {
    requests.push(JSON.parse(init.body));
    if (settings.delay) await settings.delay();
    const { questions } = requests.at(-1);
    const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => {
      if (question.type === 'noul') return [id, { type: 'noul', noul: id === 'clear' ? 1 : 0 }];
      let selected = id === 'operation' ? settings.operation ?? 'click' : ['target', 'input_target'].includes(id) ? settings.target ?? 'e1' : Object.keys(question.criteria)[0];
      if (!Object.hasOwn(question.criteria, selected)) selected = 'none';
      return [id, { type: 'choice', choice: selected, confidence: 1,
        probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === selected ? 1 : 0])) }];
    }));
    return new Response(JSON.stringify({ model: 'fixture', answers }));
  });
  const config = () => jev.config;
  const models = { config, get: async () => jev, status: () => [], close: async () => {} };
  const browser = (_options, lifecycle) => {
    const adapter = {
      request: async (args, options) => {
        lifecycle.signal.throwIfAborted();
        if (options?.dispatch) lifecycle.onDispatch();
        calls.push(args);
        if (args[0] === 'session') return { active: true, runtime: { browserLaunched: true, connection: { kind: 'managed', headless: true } } };
        if (args[0] === 'tab' && args[1] === 'list') return { tabs: state.active ? [{ tabId: 't1', targetId: state.pageId, title: 'Fixture', url: state.url, active: true }] : [] };
        if (args[0] === 'snapshot') return { origin: state.url, pageId: state.pageId, frameId: null,
          snapshot: '- document\n  - button "提交" [ref=e1]\n  - button "提交另一项" [ref=e2]',
          refs: { e1: { name: '提交', role: 'button', backendNodeId: 1 }, e2: { name: '提交另一项', role: 'button', backendNodeId: 2 } } };
        if (args[0] === 'eval' && args[1] === 'performance.timeOrigin') return { result: state.document };
        if (args[0] === 'is') return { visible: true, enabled: true };
        if (settings.dispatch && options?.dispatch) await settings.dispatch(args, lifecycle);
        return {};
      },
      requestBatch: async commands => Promise.all(commands.map(args => adapter.request(args))),
    };
    return adapter;
  };
  return { controller: new Controller(parseInteractive(['--headless']), { models, browser }), calls, requests, state };
}

test('interactive routing leaves pipes, help, version and CLI arguments noninteractive', () => {
  for (const args of [[], ['--help'], ['--version'], ['tui', '--help']]) {
    const result = spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 0, result.stderr); assert.doesNotMatch(result.stdout, /\x1b/);
  }
  const result = spawnSync(process.execPath, ['dist/cli.js', 'tui'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 1); assert.match(result.stderr, /TTY_REQUIRED/);
  assert.throws(() => parseInteractive(['--json']), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => parseInteractive(['--session', '../bad']), { code: 'INVALID_SESSION' });
  assert.throws(() => parseInteractive(['--cdp', '9222', '--auto-connect']), { code: 'INVALID_ARGUMENT' });
  assert.notEqual(parseInteractive([]).session, parseInteractive([]).session);
});

test('shortcuts use the browser directly, unknown commands never reach the model', async () => {
  const s = fixture(); await s.controller.start();
  for (const input of ['/back', '/forward', '/reload', '/up', '/down 200', '后退', '/bak', '/up -1']) await s.controller.submit(input);
  assert.equal(s.requests.length, 0);
  assert.equal(s.calls.filter(args => args[0] === 'back').length, 2);
  assert.ok(s.calls.some(args => args.join(' ') === 'scroll down 200'));
  assert.match(s.controller.state.transcript.map(x => x.text).join('\n'), /是否要用 \/back/);
  assert.throws(() => navigationCommand('open', 'javascript:alert(1)'), { code: 'INVALID_ARGUMENT' });
  await s.controller.shutdown();
});

test('confirmation is explicit, one-use, and invalidated by navigation', async () => {
  const s = fixture(); await s.controller.start(); await s.controller.submit('点击提交');
  assert.ok(s.controller.state.pending); assert.equal(s.calls.filter(c => c[0] === 'click').length, 0);
  await s.controller.submit('确认'); assert.equal(s.calls.filter(c => c[0] === 'click').length, 1);
  assert.equal(s.requests.length, 1); assert.equal(s.controller.state.pending, undefined);
  await s.controller.submit('点击提交'); s.state.url += 'other'; await s.controller.poll();
  assert.equal(s.controller.state.pending, undefined); assert.equal(s.calls.filter(c => c[0] === 'click').length, 1);
  await s.controller.shutdown();
});

test('ambiguous targets bind numbered choices to the observed candidates without a second model call', async () => {
  const s = fixture({ target: 'ambiguous' }); await s.controller.start(); await s.controller.submit('点击提交');
  assert.equal(s.controller.state.pending.choices.length, 2);
  await s.controller.submit('第二个'); await s.controller.submit('确认');
  assert.deepEqual(s.calls.filter(c => c[0] === 'click'), [['click', '@e2']]);
  assert.equal(s.requests.length, 1); await s.controller.shutdown();
});

test('confirmation refuses stale target even without a status poll', async () => {
  const s = fixture(); await s.controller.start(); await s.controller.submit('点击提交'); s.state.pageId = 'p2';
  await s.controller.submit('确认'); assert.equal(s.calls.filter(c => c[0] === 'click').length, 0);
  assert.match(s.controller.state.transcript.at(-1).text, /changed/); await s.controller.shutdown();
});

test('cancel drops a late model response and does not queue the next input', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const s = fixture({ delay: () => gate }); await s.controller.start();
  const first = s.controller.submit('点击提交');
  while (!s.requests.length) await new Promise(resolve => setTimeout(resolve, 1));
  await s.controller.submit('点击另一项'); s.controller.cancel(); release(); await first;
  assert.equal(s.requests.length, 1); assert.equal(s.calls.filter(c => c[0] === 'click').length, 0);
  assert.equal(s.controller.state.pending, undefined);
  await s.controller.submit('/back'); assert.equal(s.calls.filter(c => c[0] === 'back').length, 1);
  await s.controller.shutdown();
});

test('cancel after dispatch reports unknown result and never replays', async () => {
  const s = fixture({ dispatch: async (_args, lifecycle) => { await new Promise((_, reject) => lifecycle.signal.addEventListener('abort', () => reject(lifecycle.signal.reason), { once: true })); } });
  await s.controller.start(); const action = s.controller.submit('/reload');
  while (!s.calls.some(args => args[0] === 'reload')) await new Promise(resolve => setTimeout(resolve, 1));
  s.controller.cancel(); await action;
  assert.match(s.controller.state.transcript.at(-1).text, /可能已发送/);
  assert.equal(s.calls.filter(c => c[0] === 'reload').length, 1); await s.controller.shutdown();
});

test('provider round-trip reuses clients; credentials refresh replaces only that provider', async () => {
  const env = { TYPESAFE_API_KEY: 'one', OPENROUTER_API_KEY: 'two' };
  const models = new Models(env, () => ({}));
  const first = await models.get('auto'); assert.equal(first.config.transport, 'typesafe');
  const second = await models.get('openrouter'); assert.equal(second.config.transport, 'openrouter');
  assert.equal(await models.get('typesafe'), first);
  env.TYPESAFE_API_KEY = 'new'; assert.notEqual(await models.get('auto'), first);
  assert.equal(await models.get('openrouter'), second); await models.close();
});

test('missing credentials allow navigation and terminal text cannot inject escape sequences', async () => {
  const models = new Models({}, () => ({})); assert.throws(() => models.config('auto'), { code: 'MISSING_API_KEY' }); await models.close();
  assert.equal(clean('ok\x1b[2J\x1b]0;bad\x07\u202Ehello'), 'okhello');
  const editor = { value: '中👨‍👩‍👧‍👦e\u0301文', cursor: 3 };
  assert.equal(graphemes(editor.value).length, 4);
  assert.deepEqual(edit(editor, { remove: 'before' }), { value: '中👨‍👩‍👧‍👦文', cursor: 2 });
  assert.equal(edit({ value: '', cursor: 0 }, { insert: '一\r\n二\n三' }).value, '一\n二\n三');
});

test('same-URL reload invalidates confirmation before a poll', async () => {
  const s = fixture(); await s.controller.start(); await s.controller.submit('点击提交');
  assert.ok(s.controller.state.pending); s.state.document++;
  await s.controller.submit('确认');
  assert.equal(s.calls.filter(args => args[0] === 'click').length, 0);
  assert.equal(s.controller.state.pending, undefined);
  assert.match(s.controller.state.transcript.at(-1).text, /重新加载/);
  await s.controller.shutdown();
});

test('TUI defaults to existing Chrome; only explicit launch modes start a new browser', () => {
  const automatic = parseInteractive([]);
  assert.equal(automatic.autoConnect, true);
  assert.ok(browserArgs(automatic).includes('--auto-connect'));
  assert.ok(!browserArgs(automatic).includes('--headed'));
  for (const mode of ['--headed', '--headless']) {
    const options = parseInteractive([mode]);
    assert.ok(!options.autoConnect);
    assert.deepEqual(browserArgs(options).slice(-2), ['--headed', String(mode === '--headed')]);
    assert.throws(() => parseInteractive([mode, '--auto-connect']), { code: 'INVALID_ARGUMENT' });
  }
  assert.ok(!parseInteractive(['--cdp', '9222']).autoConnect);
  assert.ok(!parseInteractive(['--session', 'existing']).autoConnect);
  assert.throws(() => parseInteractive(['--headed', '--headless']), { code: 'INVALID_ARGUMENT' });
});

test('slash command menu exposes go, back, exit, tab and connect with legacy aliases', async () => {
  for (const name of ['go', 'back', 'exit', 'tab', 'connect']) assert.ok(commands.some(([key]) => key === name));
  for (const [old, name] of [['forward', 'go'], ['quit', 'exit'], ['tabs', 'tab'], ['browser', 'connect']])
    assert.equal(parseCommand(`/${old}`).name, name);
  const s = fixture(); await s.controller.start();
  await s.controller.submit('/go'); assert.ok(s.calls.some(args => args[0] === 'forward'));
  await s.controller.submit('/tab'); assert.equal(s.controller.state.choosingTab, true);
  s.controller.cancel();
  await s.controller.submit('/connect'); assert.equal(s.controller.state.choosingBrowser, true);
  s.controller.cancel();
  for (const mode of ['auto', 'headed', 'headless', 'cdp 9222', 'session chosen']) {
    await s.controller.submit(`/connect ${mode}`); await s.controller.reconnect();
    assert.equal(s.controller.options.autoConnect === true, mode === 'auto');
    if (mode === 'headless') assert.equal(s.controller.options.headed, false);
    if (mode === 'cdp 9222') assert.equal(s.controller.options.cdp, '9222');
    if (mode === 'session chosen') assert.equal(s.controller.options.session, 'chosen');
  }
  assert.equal(s.requests.length, 0);
  await s.controller.submit('/exit'); assert.equal(s.controller.state.exited, true);
  assert.ok(!s.calls.some(args => args[0] === 'close'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../dist/arguments.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'jev-act-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const hook = join(root, 'hook.mjs');
  const browserModule = new URL('../dist/browser.js', import.meta.url).href;
  writeFileSync(hook, `
    import { Browser } from ${JSON.stringify(browserModule)};
    import { JevError } from ${JSON.stringify(new URL('../dist/errors.js', import.meta.url).href)};
    import { appendFileSync } from 'node:fs';
    if (process.env.FAKE_TTY) {
      Object.defineProperty(process.stdin, 'isTTY', { value: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true });
    }
    globalThis.fetch = async (_url, init) => {
      if (process.env.NO_MODEL) throw Error('Confirmation must not call the model');
      const request = JSON.parse(init.body);
      appendFileSync(process.env.MODEL_LOG, JSON.stringify(request) + '\\n');
      const answers = Object.fromEntries(Object.entries(request.questions).map(([id, q]) => {
        if (q.type === 'noul') return [id, { type: 'noul', noul: .99 }];
        const chosen = id === 'operation' ? (process.env.OPEN_SITE ? 'open' : 'input') : id === 'url' ? (process.env.OPEN_SITE || 'none') : ['target', 'input_target'].includes(id) ? (process.env.TARGET_CHOICE || 'e1') : id === 'value' && q.criteria.v0 !== undefined ? 'v0' : 'none';
        const p = ['target', 'input_target'].includes(id) ? Number(process.env.TARGET_PROBABILITY || .799) : 1;
        return [id, { type: 'choice', choice: chosen, confidence: p,
          probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === chosen ? p : k === (chosen === 'e1' ? 'none' : 'e1') ? 1-p : 0])) }];
      }));
      return new Response(JSON.stringify({ model: 'fixture', answers }));
    };
    Browser.prototype.request = async function(args, options) {
      if (options?.dispatch) appendFileSync(process.env.ACTION_LOG, JSON.stringify(args) + '\\n');
      if (options?.dispatch && args[0] === process.env.FAIL_ON)
        throw new JevError(process.env.ERROR_CODE || 'EXECUTION_UNKNOWN', 'Fixture execution failure', true);
      if (args[0] === 'snapshot') return { origin: 'https://example.com', pageId: process.env.PAGE_ID || 'p1', frameId: null,
        snapshot: '- textbox "搜索框" [ref=e1]', refs: { e1: { role: 'textbox', name: '搜索框', backendNodeId: 1 } } };
      if (args[0] === 'is') return { visible: true, enabled: true };
      return {};
    };
  `);
  const env = { ...process.env, NODE_OPTIONS: `--import=${hook}`, TYPESAFE_API_KEY: 'fixture', OPENROUTER_API_KEY: '',
    XDG_CONFIG_HOME: join(root, 'config'), JEV_BROWSER_RUNTIME_DIR: join(root, 'runtime'),
    MODEL_LOG: join(root, 'models.log'), ACTION_LOG: join(root, 'actions.log') };
  const run = (args, extra = {}) => {
    const json = !extra.FAKE_TTY && !extra.PLAIN;
    const p = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), ...(json ? ['--json'] : []), 'page', 'act', 'demo', ...args],
      { env: { ...env, ...extra }, input: extra.INPUT, encoding: 'utf8', timeout: 10000 });
    return { ...p, result: json ? JSON.parse(p.stdout) : undefined };
  };
  const lines = path => { try { return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
  return { run, models: () => lines(env.MODEL_LOG), actions: () => lines(env.ACTION_LOG),
    pending: () => existsSync(env.JEV_BROWSER_RUNTIME_DIR) ? readdirSync(env.JEV_BROWSER_RUNTIME_DIR).filter(name => name.endsWith('.json')) : [] };
}

test('JSON CLI exposes a concrete plan, confirms once without a model call, and supports cancellation', t => {
  const f = fixture(t);
  const pending = f.run(['搜索 jev']);
  assert.equal(pending.status, 2, pending.stdout + pending.stderr);
  assert.equal(pending.result.data.status, 'needs_confirmation');
  assert.equal(pending.result.meta.decisions[0].answers.input_target.probabilities.e1, .799);
  assert.equal(pending.result.data.plan.value, 'jev');
  assert.equal(pending.result.data.plan.submit, true);
  assert.match(pending.result.confirmation.confirmCommand, /page act demo --confirm jev-/);
  const command = parseArgs(pending.result.confirmation.confirmCommand.split(' ').slice(1));
  assert.equal(command.session, 'demo');
  assert.equal(command.options.confirm, pending.result.confirmation.id);
  assert.deepEqual(f.actions(), []);
  const confirmed = f.run(['--confirm', pending.result.confirmation.id], { NO_MODEL: '1', TYPESAFE_API_KEY: '' });
  assert.equal(confirmed.status, 0, confirmed.stderr);
  assert.equal(confirmed.result.data.status, 'executed');
  assert.deepEqual(f.actions(), [['fill', '@e1', 'jev'], ['focus', '@e1'], ['press', 'Enter']]);
  assert.equal(f.models().length, 1);
  assert.equal(f.run(['--confirm', pending.result.confirmation.id]).result.error.code, 'CONFIRMATION_NOT_FOUND');
  const cancel = f.run(['搜索 jev']);
  assert.equal(f.run(['--cancel', cancel.result.confirmation.id], { NO_MODEL: '1' }).result.data.status, 'cancelled');
  assert.equal(f.actions().length, 3);
});

test('CLI confirmation revalidates page identity and dry-run never issues executable tokens', t => {
  const f = fixture(t);
  const preview = f.run(['搜索 jev', '--dry-run']);
  assert.equal(preview.status, 2, preview.stderr);
  assert.equal(preview.result.data.status, 'needs_confirmation');
  assert.equal(preview.result.confirmation, undefined);
  const pending = f.run(['搜索 jev']);
  const stale = f.run(['--confirm', pending.result.confirmation.id], { PAGE_ID: 'other', NO_MODEL: '1' });
  assert.equal(stale.result.error.code, 'STALE_TARGET');
  assert.equal(stale.result.error.dispatched, false);
  assert.equal(stale.status, 1);
  assert.deepEqual(stale.result.meta.decisions, pending.result.meta.decisions);
  assert.equal(f.run(['--confirm', pending.result.confirmation.id]).result.error.code, 'CONFIRMATION_NOT_FOUND');
  assert.deepEqual(f.actions(), []);
});

test('stdin stays private in pending output and model questions, then executes the exact saved value', t => {
  const f = fixture(t);
  const secret = ' secret-123\n';
  const pending = f.run(['--op', 'fill', '搜索框', '--value-stdin'], { INPUT: secret });
  assert.equal(pending.status, 2, pending.stderr);
  assert.equal(pending.stdout.includes('secret-123'), false);
  assert.equal(JSON.stringify(f.models()).includes('secret-123'), false);
  const done = f.run(['--confirm', pending.result.confirmation.id], { NO_MODEL: '1' });
  assert.equal(done.stdout.includes('secret-123'), false);
  assert.deepEqual(f.actions(), [['fill', '@e1', secret]]);
});

test('interactive confirmation accepts y; Enter, no and Ctrl-C cancel without dispatch', t => {
  const f = fixture(t);
  for (const INPUT of ['\n', 'n\n', '\u0003']) {
    const result = f.run(['搜索 jev'], { FAKE_TTY: '1', INPUT });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /是否执行/);
    assert.match(result.stdout, /已取消，尚未执行/);
    assert.deepEqual(f.actions(), []);
  }
  const yes = f.run(['搜索 jev'], { FAKE_TTY: '1', INPUT: 'y\n' });
  assert.equal(yes.status, 0, yes.stdout + yes.stderr);
  assert.match(yes.stdout, /操作已执行/);
  assert.deepEqual(f.actions(), [['fill', '@e1', 'jev'], ['focus', '@e1'], ['press', 'Enter']]);
});

test('unknown sites return an actionable JSON error and never dispatch', t => {
  const f = fixture(t);
  const result = f.run(['打开某个未知网站'], { OPEN_SITE: 'none' });
  assert.equal(result.result.error.code, 'NEEDS_URL');
  assert.match(result.result.error.message, /full URL/);
  assert.match(result.result.error.message, /jevb page act demo "Open https:\/\/example.com"/);
  assert.equal(result.result.error.dispatched, false);
  assert.equal(result.result.meta.decisions[0].answers.url.choice, 'none');
  assert.deepEqual(f.actions(), []);
  const preview = f.run(['打开某个未知网站', '--dry-run'], { OPEN_SITE: 'none' });
  assert.match(preview.result.error.message, /--dry-run --json/);
});

test('non-interactive never prompts or saves pending; non-TTY agents retain confirmation tokens', t => {
  for (const extra of [{}, { FAKE_TTY: '1', INPUT: 'y\n' }]) {
    const f = fixture(t);
    const result = f.run(['搜索 jev', '--non-interactive'], extra);
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(f.pending(), []);
    assert.deepEqual(f.actions(), []);
    if (result.result) {
      assert.equal(result.result.data.status, 'needs_confirmation');
      assert.equal(result.result.confirmation, undefined);
      assert.equal(result.result.meta.modelRequests, 1);
    } else assert.doesNotMatch(result.stdout, /是否执行|--confirm/);
  }
  const f = fixture(t);
  const plain = f.run(['搜索 jev'], { PLAIN: '1' });
  assert.equal(plain.status, 2, plain.stderr);
  assert.equal(f.pending().length, 1);
  assert.match(plain.stdout, /--confirm/);
  assert.deepEqual(f.actions(), []);
});

test('non-interactive executes confident plans and returns zero for resolved previews', t => {
  const f = fixture(t);
  const preview = f.run(['搜索 jev', '--dry-run', '--non-interactive'], { TARGET_PROBABILITY: '.8' });
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(preview.result.data.status, 'resolved');
  assert.deepEqual(f.actions(), []);
  const result = f.run(['搜索 jev', '--non-interactive'], { TARGET_PROBABILITY: '.8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.result.data.status, 'executed');
  assert.equal(f.actions().length, 3);
  assert.deepEqual(f.pending(), []);
});

test('NO_MATCH and AMBIGUOUS expose the model distribution without dispatch', t => {
  for (const [choice, code] of [['none', 'NO_MATCH'], ['ambiguous', 'AMBIGUOUS']]) {
    const f = fixture(t);
    const result = f.run(['--op', 'click', '搜索框'], { TARGET_CHOICE: choice, TARGET_PROBABILITY: '.89' });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.result.error.code, code);
    assert.equal(result.result.error.dispatched, false);
    assert.equal(result.result.meta.modelRequests, 1);
    const answer = result.result.meta.decisions[0].answers.target;
    assert.equal(answer.choice, choice);
    assert.equal(answer.probabilities[choice], .89);
    assert.ok(Math.abs(answer.probabilities.e1 - .11) < 1e-9);
    assert.deepEqual(f.actions(), []);
  }
});

test('execution failures return 3 and retain decisions for immediate and confirmed plans', t => {
  for (const confirm of [false, true]) {
    for (const [FAIL_ON, ERROR_CODE] of [['fill', 'EXECUTION_UNKNOWN'], ['press', 'STALE_TARGET']]) {
      const f = fixture(t);
      const pending = confirm ? f.run(['搜索 jev']) : undefined;
      const result = f.run(confirm ? ['--confirm', pending.result.confirmation.id] : ['搜索 jev', '--non-interactive'],
        { TARGET_PROBABILITY: '1', FAIL_ON, ERROR_CODE, ...(confirm ? { NO_MODEL: '1' } : {}) });
      assert.equal(result.status, 3, result.stderr);
      assert.equal(result.result.error.code, ERROR_CODE);
      assert.equal(result.result.error.dispatched, true);
      assert.equal(result.result.meta.decisions.length, 1);
      assert.equal(f.models().length, 1);
      assert.equal(f.actions().length, FAIL_ON === 'fill' ? 1 : 3);
    }
  }
});

test('non-interactive URL and login failures never prompt, even on a TTY', t => {
  const f = fixture(t);
  const url = f.run(['打开某个未知网站', '--non-interactive'], { OPEN_SITE: 'none', FAKE_TTY: '1', INPUT: 'https://example.com\n' });
  assert.equal(url.status, 1, url.stderr);
  assert.match(url.stderr, /NEEDS_URL/);
  assert.doesNotMatch(url.stdout, /请输入完整网址/);
  const login = f.run(['搜索 jev', '--non-interactive'], { TYPESAFE_API_KEY: '', FAKE_TTY: '1', INPUT: 'fixture\n' });
  assert.equal(login.status, 1, login.stderr);
  assert.match(login.stderr, /MISSING_API_KEY/);
  assert.doesNotMatch(login.stderr, /请先登录/);
  assert.deepEqual(f.actions(), []);
  assert.deepEqual(f.pending(), []);
});

test('failure evidence does not reveal explicit stdin values', t => {
  const f = fixture(t);
  const secret = 'private-failure-value';
  const result = f.run(['--op', 'fill', '搜索框', '--value-stdin', '--non-interactive'],
    { INPUT: secret, TARGET_PROBABILITY: '1', FAIL_ON: 'fill' });
  assert.equal(result.status, 3, result.stderr);
  assert.equal(result.result.meta.decisions.length, 1);
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(JSON.stringify(f.models()).includes(secret), false);
});

test('interactive unknown site accepts a URL, cancels, rejects invalid URLs, and respects dry-run', t => {
  for (const INPUT of ['\n', '\u0003', 'javascript:alert(1)\n', 'example.com\n', 'https://example.com/path\n']) {
    const f = fixture(t);
    const result = f.run(['打开某个未知网站'], { OPEN_SITE: 'none', FAKE_TTY: '1', INPUT });
    assert.match(result.stdout, /请输入完整网址/);
    if (INPUT.startsWith('https:')) {
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(f.actions(), [['open', 'https://example.com/path']]);
      assert.equal(f.models().length, 1);
    } else {
      assert.deepEqual(f.actions(), []);
      assert.match(result.stdout + result.stderr, INPUT === '\n' || INPUT === '\u0003' ? /已取消/ : /INVALID_VALUE/);
    }
  }
  const f = fixture(t);
  const result = f.run(['打开某个未知网站', '--dry-run'], { OPEN_SITE: 'none', FAKE_TTY: '1', INPUT: 'https://example.com\n' });
  assert.match(result.stdout, /操作预览/);
  assert.deepEqual(f.actions(), []);
});

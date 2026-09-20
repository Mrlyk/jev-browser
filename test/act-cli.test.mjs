import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
        const chosen = id === 'operation' ? 'input' : ['target', 'input_target'].includes(id) ? 'e1' : id === 'value' ? 'v0' : 'none';
        const p = ['target', 'input_target'].includes(id) ? .8 : 1;
        return [id, { type: 'choice', choice: chosen, confidence: p,
          probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === chosen ? p : k === 'none' ? 1-p : 0])) }];
      }));
      return new Response(JSON.stringify({ model: 'fixture', answers }));
    };
    Browser.prototype.request = async function(args, options) {
      if (options?.dispatch) appendFileSync(process.env.ACTION_LOG, JSON.stringify(args) + '\\n');
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
    const p = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), ...(extra.FAKE_TTY ? [] : ['--json']), 'page', 'act', 'demo', ...args],
      { env: { ...env, ...extra }, input: extra.INPUT, encoding: 'utf8', timeout: 10000 });
    return { ...p, result: extra.FAKE_TTY ? undefined : JSON.parse(p.stdout) };
  };
  const lines = path => { try { return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
  return { run, models: () => lines(env.MODEL_LOG), actions: () => lines(env.ACTION_LOG) };
}

test('JSON CLI exposes a concrete plan, confirms once without a model call, and supports cancellation', t => {
  const f = fixture(t);
  const pending = f.run(['搜索 jev']);
  assert.equal(pending.status, 0, pending.stdout + pending.stderr);
  assert.equal(pending.result.data.status, 'needs_confirmation');
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
  assert.equal(preview.result.data.status, 'needs_confirmation');
  assert.equal(preview.result.confirmation, undefined);
  const pending = f.run(['搜索 jev']);
  const stale = f.run(['--confirm', pending.result.confirmation.id], { PAGE_ID: 'other', NO_MODEL: '1' });
  assert.equal(stale.result.error.code, 'STALE_TARGET');
  assert.equal(stale.result.error.dispatched, false);
  assert.equal(f.run(['--confirm', pending.result.confirmation.id]).result.error.code, 'CONFIRMATION_NOT_FOUND');
  assert.deepEqual(f.actions(), []);
});

test('stdin stays private in pending output and model questions, then executes the exact saved value', t => {
  const f = fixture(t);
  const secret = ' secret-123\n';
  const pending = f.run(['--op', 'fill', '搜索框', '--value-stdin'], { INPUT: secret });
  assert.equal(pending.status, 0, pending.stderr);
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

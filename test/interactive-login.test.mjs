import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { credentialsPath, readCredentials, saveCredential } from '../dist/credentials.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'jev-tui-login-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, XDG_CONFIG_HOME: root, TYPESAFE_API_KEY: '', OPENROUTER_API_KEY: '', NODE_OPTIONS: '' };
  const hook = join(root, 'input.mjs');
  const calls = join(root, 'calls.jsonl');
  writeFileSync(hook, `
    import { appendFileSync } from 'node:fs';
    globalThis.fetch = async (url, init) => {
      appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ url }) + '\\n');
      if (init.headers.Authorization === 'Bearer rejected-key') return new Response('', { status: 401 });
      return Response.json({ model: 'fixture', answers: { check: { type: 'choice', choice: 'yes', confidence: 1,
        probabilities: { yes: 1, no: 0 } } } });
    };
    const keys = JSON.parse(process.env.TEST_KEYS || '[]');
    process.stdin.isTTY = process.stderr.isTTY = true;
    process.stdin.resume = () => process.stdin;
    process.stdin.setRawMode = enabled => {
      if (enabled) setImmediate(() => {
        const key = keys.shift();
        if (key === undefined) process.stdin.emit('keypress', '', { name: 'c', ctrl: true });
        else { process.stdin.emit('keypress', key, {}); process.stdin.emit('keypress', '', { name: 'return' }); }
      });
    };
  `);
  const entry = `import {ensureInteractiveLogin} from ${JSON.stringify(new URL('../dist/interactive/login.js', import.meta.url).href)};
    await ensureInteractiveLogin(process.env.TEST_PROVIDER || 'auto'); process.stdout.write('ready');`;
  return { env, calls, run: (extra = {}) => spawnSync(process.execPath, ['--import', hook, '--input-type=module', '-e', entry], {
    env: { ...env, ...extra }, encoding: 'utf8', timeout: 5000,
  }) };
}

test('configured environment or saved credentials skip startup login and model requests', async t => {
  const f = fixture(t);
  for (const extra of [{ TYPESAFE_API_KEY: 'env-key' }, { OPENROUTER_API_KEY: 'env-key' },
    { TYPESAFE_API_KEY: 'env-key', TEST_PROVIDER: 'typesafe' }]) {
    const result = f.run(extra);
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'ready'); assert.ok(!existsSync(f.calls));
  }
  await saveCredential('openrouter', 'stored-key', f.env);
  const result = f.run(); assert.equal(result.status, 0); assert.equal(result.stderr, '');
  assert.ok(!existsSync(f.calls));
});

test('missing credentials prompt once, hide the key and preserve automatic provider routing', t => {
  const f = fixture(t);
  for (const [key, provider] of [['official-key', 'typesafe'], ['sk-router-key', 'openrouter']]) {
    const result = f.run({ TEST_KEYS: JSON.stringify([key]) });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Sign in to Jev Browser.*\nAPI key \(hidden\): \nSigned in\./);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(key));
    assert.equal(readCredentials(f.env)[provider], key);
    rmSync(credentialsPath(f.env));
  }
});

test('explicit provider checks its own credentials and retains the other saved key', async t => {
  const f = fixture(t); await saveCredential('typesafe', 'original-official', f.env);
  const result = f.run({ TEST_PROVIDER: 'openrouter', TEST_KEYS: JSON.stringify(['router-key']) });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readCredentials(f.env), { typesafe: 'original-official', openrouter: 'router-key' });
  assert.match(readFileSync(f.calls, 'utf8'), /openrouter.ai/);
});

test('rejected key can be replaced; cancellation does not save or enter the app', async t => {
  const f = fixture(t);
  const retried = f.run({ TEST_KEYS: JSON.stringify(['rejected-key', 'official-key']) });
  assert.equal(retried.status, 0, retried.stderr); assert.match(retried.stderr, /Try again/);
  assert.equal(readCredentials(f.env).typesafe, 'official-key');
  assert.equal(readFileSync(f.calls, 'utf8').trim().split('\n').length, 2);
  assert.ok(!retried.stderr.includes('rejected-key'));
  const before = readFileSync(credentialsPath(f.env), 'utf8');
  const cancelled = f.run({ TEST_PROVIDER: 'openrouter' });
  assert.equal(cancelled.status, 1); assert.match(cancelled.stderr, /AUTH_CANCELLED|Login cancelled/);
  assert.equal(cancelled.stdout, ''); assert.equal(readFileSync(credentialsPath(f.env), 'utf8'), before);
});

test('damaged credentials fail before prompting or sending a model request', t => {
  const f = fixture(t);
  mkdirSync(join(f.env.XDG_CONFIG_HOME, 'jev-browser'));
  writeFileSync(credentialsPath(f.env), 'invalid-store');
  const result = f.run();
  assert.equal(result.status, 1); assert.match(result.stderr, /CREDENTIALS_UNAVAILABLE/);
  assert.doesNotMatch(result.stderr, /API key \(hidden\)/); assert.ok(!existsSync(f.calls));
});

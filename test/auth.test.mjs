import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { login, handleAuth } from '../dist/auth.js';
import { credentialsPath, readCredentials, saveCredential, credentialStatus } from '../dist/credentials.js';
import { modelConfig } from '../dist/jev.js';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'jev-auth-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, env: { XDG_CONFIG_HOME: root } };
}

function response() {
  return { model: 'jev-test', answers: { check: {
    type: 'choice', choice: 'yes', probabilities: { yes: 0.99, no: 0.01 }, confidence: 0.99,
  } } };
}

test('login checks the submitted provider/key once before saving; secrets are absent from status', async t => {
  const { env } = fixture(t);
  for (const provider of ['typesafe', 'openrouter']) {
    let calls = 0;
    const key = `submitted-${provider}`;
    const result = await login(provider, key, { env: { ...env, TYPESAFE_API_KEY: 'environment-official',
      OPENROUTER_API_KEY: 'environment-router' }, request: async (url, init) => {
      calls++;
      assert.equal(readCredentials(env)[provider], undefined);
      assert.equal(init.headers.Authorization, `Bearer ${key}`);
      assert.equal(url, provider === 'typesafe' ? 'https://api.typesafe.ai/v1/systemone' : 'https://openrouter.ai/api/alpha/decisions');
      assert.equal(init.redirect, 'error');
      const body = JSON.parse(init.body);
      assert.equal(body.state, 'ready');
      assert.deepEqual(Object.keys(body.questions), ['check']);
      assert.equal(body.questions.check.type, 'choice');
      assert.equal(body.model, provider === 'typesafe' ? 'jev-latest' : '~typesafe/jev-latest');
      assert(!init.body.includes(key));
      return Response.json(response());
    } });
    assert.equal(calls, 1);
    assert.equal(result.verified, true);
    assert.equal(readCredentials(env)[provider], key);
    assert(!JSON.stringify(result).includes(key));
    assert(!JSON.stringify(result).includes('environment-official'));
  }
  assert.deepEqual(readCredentials(env), { typesafe: 'submitted-typesafe', openrouter: 'submitted-openrouter' });
  if (process.platform !== 'win32') {
    assert.equal(statSync(credentialsPath(env)).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(credentialsPath(env))).mode & 0o777, 0o700);
  }
});

test('HTTP errors, timeouts, malformed answers and wrong judgments never overwrite the previous key', async t => {
  const { env } = fixture(t);
  await saveCredential('openrouter', 'previous', env);
  const before = readFileSync(credentialsPath(env));
  const cases = [
    [() => new Response('submitted-secret', { status: 401 }), 'MODEL_HTTP_401'],
    [() => new Response('', { status: 429 }), 'MODEL_HTTP_429'],
    [() => new Response('', { status: 500 }), 'MODEL_HTTP_500'],
    [() => { throw new DOMException('submitted-secret', 'TimeoutError'); }, 'MODEL_UNAVAILABLE'],
    [() => new Response('submitted-secret'), 'INVALID_MODEL_RESPONSE'],
    [() => Response.json({ model: 'jev', answers: {} }), 'INVALID_MODEL_RESPONSE'],
    [() => Response.json({ model: 'jev', answers: { check: {
      type: 'choice', choice: 'no', probabilities: { yes: 0.01, no: 0.99 }, confidence: 0.99,
    } } }), 'MODEL_CHECK_FAILED'],
  ];
  for (const [request, code] of cases) {
    let calls = 0;
    await assert.rejects(login('openrouter', 'submitted-secret', { env, request: async () => {
      calls++; return request();
    } }), error => error.code === code && !error.message.includes('submitted-secret'));
    assert.equal(calls, 1);
    assert.deepEqual(readFileSync(credentialsPath(env)), before);
  }
});

test('environment overrides each provider; TypeSafe wins across sources; logout preserves environment and other provider', async t => {
  const { env } = fixture(t);
  await saveCredential('typesafe', 'saved-official', env);
  await saveCredential('openrouter', 'saved-router', env);
  const stored = readCredentials(env);
  assert.equal(modelConfig({ OPENROUTER_API_KEY: 'env-router' }, stored).key, 'saved-official');
  assert.equal(modelConfig({ TYPESAFE_API_KEY: ' env-official ' }, stored).key, 'env-official');
  assert.equal(modelConfig({ TYPESAFE_API_KEY: ' ' }, stored).key, 'saved-official');
  await saveCredential('typesafe', undefined, env);
  assert.equal(modelConfig(env, readCredentials(env)).key, 'saved-router');
  const status = credentialStatus({ ...env, TYPESAFE_API_KEY: 'env-official' });
  assert.equal(status.selected, 'typesafe');
  assert.deepEqual(status.providers[0], { provider: 'typesafe', stored: false, source: 'environment' });
  assert(!JSON.stringify(status).includes('env-official'));
  await saveCredential('openrouter', undefined, env);
  assert.equal(credentialStatus(env).selected, null);
});

test('invalid stores and symlinks fail without disclosing contents or overwriting files', async t => {
  const { root, env } = fixture(t);
  const path = credentialsPath(env);
  mkdirSync(dirname(path), { recursive: true });
  for (const content of ['secret: broken json', '{"openrouter":45}', '{"unknown":"secret"}']) {
    writeFileSync(path, content);
    await assert.rejects(login('openrouter', 'new', { env, request: () => {
      assert.fail('must reject before HTTP');
    } }), { code: 'CREDENTIALS_UNAVAILABLE' });
    assert.equal(readFileSync(path, 'utf8'), content);
  }
  rmSync(path);
  const target = join(root, 'target'); writeFileSync(target, '{"openrouter":"old"}');
  symlinkSync(target, path);
  await assert.rejects(saveCredential('openrouter', 'new', env), { code: 'CREDENTIALS_UNAVAILABLE' });
  assert.equal(readFileSync(target, 'utf8'), '{"openrouter":"old"}');
});

test('website authentication remains routed to the executor', async () => {
  for (const args of [['login', 'github'], ['save', 'work'], ['list'], ['show', 'work'], ['delete', 'work']])
    assert.equal(await handleAuth(args), false);
  for (const args of [['logout', 'unknown'], ['status', 'extra'], ['login', 'openrouter', '--key', 'secret']])
    await assert.rejects(handleAuth(args), error => error.code === 'INVALID_ARGUMENT' && !error.message.includes('secret'));
});

test('CLI stdin login, JSON status and logout work without browser/key echo', t => {
  const { root, env } = fixture(t);
  const hook = join(root, 'fetch.mjs');
  writeFileSync(hook, `globalThis.fetch = async () => Response.json(${JSON.stringify(response())});`);
  const childEnv = { ...process.env, ...env, TYPESAFE_API_KEY: '', OPENROUTER_API_KEY: '',
    NODE_OPTIONS: '', JEV_BROWSER_RUNTIME_DIR: join(root, 'runtime') };
  const run = (args, input) => spawnSync(process.execPath, ['--import', hook, 'dist/cli.js', ...args],
    { env: childEnv, input, encoding: 'utf8' });
  const result = run(['--json', 'auth', 'login', 'openrouter', '--with-token'], 'stdin-secret\n');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.verified, true);
  assert(!`${result.stdout}${result.stderr}`.includes('stdin-secret'));
  const status = run(['auth', 'status', '--json']);
  assert.equal(JSON.parse(status.stdout).data.selected, 'openrouter');
  assert.equal(readCredentials(env).openrouter, 'stdin-secret');
  for (const input of ['', 'a\nb', 'a'.repeat(17000)]) {
    const invalid = run(['auth', 'login', 'openrouter', '--with-token', '--json'], input);
    assert.equal(invalid.status, 1);
    assert.equal(JSON.parse(invalid.stdout).error.code, 'INVALID_API_KEY');
    assert.equal(readCredentials(env).openrouter, 'stdin-secret');
  }
  assert.equal(run(['auth', 'login', 'openrouter'], '').status, 1);
  const help = run(['auth', 'login', 'openrouter', '--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--with-token/);
  const logout = run(['auth', 'logout', 'openrouter', '--json']);
  assert.equal(JSON.parse(logout.stdout).data.selected, null);
  assert.deepEqual(readCredentials(env), {});
  for (const [key, provider] of [['sk-piped', 'openrouter'], ['skplain', 'openrouter'], ['sh-piped', 'typesafe'], ['official-piped', 'typesafe']]) {
    const inferred = run(['auth', 'login', '--with-token', '--json'], key + '\n');
    assert.equal(inferred.status, 0, inferred.stderr);
    assert.equal(JSON.parse(inferred.stdout).data.provider, provider);
    assert.equal(readCredentials(env)[provider], key);
  }
});

test('CLI detects providers, prompts before execution, resumes once and preserves JSON output', t => {
  const { root, env } = fixture(t);
  const hook = join(root, 'interactive.mjs');
  writeFileSync(hook, `
    import { Browser } from ${JSON.stringify(new URL('../dist/browser.js', import.meta.url).href)};
    globalThis.fetch = async (url, init) => {
      const key = init.headers.Authorization.slice(7);
      const provider = key.startsWith('sk') ? 'openrouter' : 'typesafe';
      if (!url.includes(provider === 'openrouter' ? 'openrouter.ai' : 'typesafe.ai')) throw Error('wrong provider');
      return process.env.TEST_REJECT ? new Response('', { status: 401 }) : Response.json(${JSON.stringify(response())});
    };
    if (process.env.TEST_KEY) {
      process.stdin.isTTY = process.stderr.isTTY = true;
      process.stdin.resume = () => process.stdin;
      process.stdin.setRawMode = enabled => {
        if (enabled) setImmediate(() => {
          process.stdin.emit('keypress', process.env.TEST_KEY, {});
          process.stdin.emit('keypress', '', { name: process.env.TEST_CANCEL ? 'c' : 'return', ctrl: !!process.env.TEST_CANCEL });
        });
      };
    }
    Browser.prototype.passthrough = async function (args) {
      process.stdout.write(JSON.stringify({ executed: args }) + '\\n');
      return 0;
    };
  `);
  const childEnv = { ...process.env, ...env, TYPESAFE_API_KEY: '', OPENROUTER_API_KEY: '',
    NODE_OPTIONS: '', JEV_BROWSER_RUNTIME_DIR: join(root, 'runtime') };
  const run = (args, options = {}) => spawnSync(process.execPath, ['--import', hook, 'dist/cli.js', ...args],
    { env: { ...childEnv, ...options }, encoding: 'utf8', timeout: 10000 });
  for (const [key, provider] of [['sk-router-test', 'openrouter'], ['skplain', 'openrouter'], ['sh-test', 'typesafe'], ['official-test', 'typesafe']]) {
    const explicit = run(['auth', 'login', '--json'], { TEST_KEY: key });
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.equal(JSON.parse(explicit.stdout).data.provider, provider);
    assert.equal(readCredentials(env)[provider], key);
    const plain = run(['auth', 'login'], { TEST_KEY: key });
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(plain.stdout, '登录成功。\n');
    assert.equal(plain.stderr, 'API Key（输入隐藏）：\n');
    rmSync(credentialsPath(env));
    const automatic = run(['--json', 'page', 'open', 'demo', 'https://example.test'], { TEST_KEY: key });
    assert.equal(automatic.status, 0, automatic.stderr);
    assert.deepEqual(JSON.parse(automatic.stdout), { executed: ['open', 'https://example.test'] });
    assert.equal(automatic.stderr, '请先登录。\nAPI Key（输入隐藏）：\n登录成功。\n');
    assert(!`${automatic.stdout}${automatic.stderr}`.includes(key));
    assert.equal(readCredentials(env)[provider], key);
    const saved = run(['page', 'snapshot', 'demo', '--json']);
    assert.equal(saved.status, 0, saved.stderr);
    assert.equal(saved.stderr, '');
    rmSync(credentialsPath(env));
  }
  for (const options of [{ TEST_REJECT: '1' }, { TEST_CANCEL: '1' }]) {
    const failed = run(['page', 'open', 'demo', 'https://example.test', '--json'], { TEST_KEY: 'sk-test', ...options });
    assert.equal(failed.status, 1);
    assert.match(JSON.parse(failed.stdout).error.code, /MODEL_HTTP_401|AUTH_CANCELLED/);
    assert.deepEqual(readCredentials(env), {});
  }
  for (const args of [['page', 'open', 'demo', 'https://example.test'], ['page', 'snapshot', 'demo'], ['page', 'act', 'demo', 'read title'], ['auth', 'login']]) {
    const failed = run([...args, '--json']);
    assert.equal(failed.status, 1);
    assert.equal(JSON.parse(failed.stdout).error.code, 'NEEDS_INPUT');
  }
  for (const args of [['help'], ['--help'], ['auth', 'login', '--help']]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /auth login/);
    assert.doesNotMatch(result.stdout, /sh-|sk-|自动识别|最小|检查通过|验证/);
    assert.equal(result.stderr, '');
  }
  const configured = run(['page', 'snapshot', 'demo'], { TYPESAFE_API_KEY: 'env-test' });
  assert.equal(configured.status, 0);
  assert.equal(configured.stderr, '');
});

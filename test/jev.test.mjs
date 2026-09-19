import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Jev, modelConfig, choice, validateEvaluation, accepted } from '../dist/jev.js';
import { coreEnv } from '../dist/browser.js';
import { fileURLToPath } from 'node:url';

const questions = { target: choice('选目标', { e1: '确认', none: '不存在' }) };
const valid = () => ({ model: 'jev-test', answers: { target: {
  type: 'choice', choice: 'e1', probabilities: { e1: 0.98, none: 0.02 }, confidence: 0.9,
} } });

test('四种 Key 组合与空白值；官方优先', () => {
  assert.throws(() => modelConfig({}), { code: 'MISSING_API_KEY' });
  assert.equal(modelConfig({ TYPESAFE_API_KEY: ' official ' }).key, 'official');
  assert.equal(modelConfig({ OPENROUTER_API_KEY: 'router' }).model, '~typesafe/jev-latest');
  assert.equal(modelConfig({ TYPESAFE_API_KEY: 'official', OPENROUTER_API_KEY: 'router' }).transport, 'typesafe');
  assert.equal(modelConfig({ TYPESAFE_API_KEY: ' ', OPENROUTER_API_KEY: 'router' }).transport, 'openrouter');
});

test('两个通道使用实际 HTTP Decisions 协议，官方失败无切换', async t => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    requests.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(text) });
    res.writeHead(req.headers.authorization === 'Bearer bad' ? 401 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(valid()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const env of [{ TYPESAFE_API_KEY: 'official' }, { OPENROUTER_API_KEY: 'router' }]) {
    const config = modelConfig(env);
    const jev = new Jev(config, (url, init) => fetch(base + new URL(url).pathname, init));
    await jev.evaluate({ instruction: '点击确认' }, questions);
    assert.equal(jev.evidence[0].transport, config.transport);
  }
  const both = modelConfig({ TYPESAFE_API_KEY: 'bad', OPENROUTER_API_KEY: 'router' });
  await assert.rejects(new Jev(both, (url, init) => fetch(base + new URL(url).pathname, init)).evaluate({}, questions), { code: 'MODEL_HTTP_401' });
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(r => r.url), ['/v1/systemone', '/api/alpha/decisions', '/v1/systemone']);
  assert.equal(requests[1].body.model, '~typesafe/jev-latest');
  assert.equal(requests[0].body.questions.target.type, 'choice');
  assert.equal(requests[2].auth, 'Bearer bad');
});

test('拒绝未知 ID、缺失概率、非法概率及非最高概率选择', () => {
  for (const mutate of [
    r => { r.answers.target.choice = 'e2'; },
    r => { delete r.answers.target.probabilities.none; },
    r => { r.answers.target.probabilities.e1 = NaN; },
    r => { r.answers.target.probabilities.e1 = 0.1; r.answers.target.probabilities.none = 0.9; },
    r => { r.answers.target.confidence = 2; },
    r => { r.answers.target.probabilities.extra = 0; },
  ]) {
    const raw = valid(); mutate(raw);
    assert.throws(() => validateEvaluation(raw, questions), { code: 'INVALID_MODEL_RESPONSE' });
  }
  assert.equal(validateEvaluation(valid(), questions).answers.target.choice, 'e1');
});

test('概率不足不派发；模型输入超限不截断', async () => {
  assert.throws(() => accepted({ ...valid().answers.target, probabilities: { e1: 0.6, none: 0.4 } }), { code: 'AMBIGUOUS' });
  const jev = new Jev(modelConfig({ TYPESAFE_API_KEY: 'test' }), () => { throw Error('不应发送'); });
  await assert.rejects(jev.evaluate('长'.repeat(20000), questions), { code: 'CONTEXT_TOO_LARGE' });
});

test('执行器不继承模型 Key 和原版运行配置', () => {
  const env = coreEnv({ TYPESAFE_API_KEY: 'secret1', OPENROUTER_API_KEY: 'secret2',
    AGENT_BROWSER_SOCKET_DIR: '/original', AGENT_BROWSER_DAEMON: '1',
    JEV_BROWSER_RUNTIME_DIR: '/tmp/jev-test', PATH: '/bin' });
  assert.equal(env.TYPESAFE_API_KEY, undefined);
  assert.equal(env.OPENROUTER_API_KEY, undefined);
  assert.equal(env.AGENT_BROWSER_DAEMON, undefined);
  assert.equal(env.AGENT_BROWSER_SOCKET_DIR, '/tmp/jev-test');
  assert.equal(env.AGENT_BROWSER_NAMESPACE, 'jev');
  assert.equal(env.AGENT_BROWSER_NO_REPLAY, '1');
  assert.equal(env.AGENT_BROWSER_SKILLS_DIR, fileURLToPath(new URL('../skills', import.meta.url)));
});

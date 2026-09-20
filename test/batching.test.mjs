import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Jev, choice, modelConfig } from '../dist/jev.js';
import { prepareAct, executePlan } from '../dist/semantic.js';

const criteria = (count, label = '链接') => ({
  ...Object.fromEntries(Array.from({ length: count }, (_, i) => [`e${i + 1}`, `${label}${i + 1}`])),
  none: '无匹配', ambiguous: '有歧义',
});

function fixture(decide) {
  const requests = [];
  const jev = new Jev(modelConfig({ TYPESAFE_API_KEY: 'test' }), async (_url, init) => {
    const request = JSON.parse(init.body);
    requests.push(request);
    assert.ok(Buffer.byteLength(init.body) <= 48_000);
    const answers = Object.fromEntries(Object.entries(request.questions).map(([id, q]) => {
      assert.ok(Object.keys(q.criteria).length <= 255);
      if (q.type === 'noul') return [id, { type: 'noul', noul: 0 }];
      const selected = decide(q, id);
      const probabilities = { ...Object.fromEntries(Object.keys(q.criteria).map(key => [key, 0])), ...selected };
      return [id, { type: 'choice', choice: Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0],
        probabilities, confidence: 1 }];
    }));
    return new Response(JSON.stringify({ model: 'fixture', answers }));
  });
  return { jev, requests };
}

test('255 选项保持单次请求，超限覆盖全部候选并统一比较', async () => {
  const small = fixture(() => ({ e1: 1 }));
  await small.jev.evaluate({}, { target: choice('点击', criteria(253)) });
  assert.equal(small.requests.length, 1);
  const large = fixture(q => Object.hasOwn(q.criteria, 'e300') ? { e300: 0.9, none: 0.1 } : { e1: 0.99, none: 0.01 });
  const result = await large.jev.evaluate({}, { target: choice('点击', criteria(506)) });
  assert.equal(result.answers.target.choice, 'e300');
  assert.equal(large.requests.length, 3);
  const firstRound = large.requests.slice(0, 2);
  const visited = new Set(firstRound.flatMap(r => Object.keys(r.questions.target.criteria).filter(k => k.startsWith('e'))));
  assert.equal(visited.size, 506);
  assert.ok(large.requests[2].questions.target.criteria.e1);
  assert.ok(large.requests[2].questions.target.criteria.e300);
  assert.equal(large.jev.evidence.length, 3);
});

test('无匹配与歧义保留在每一批和最终比较中', async () => {
  for (const outcome of ['none', 'ambiguous']) {
    const s = fixture(() => ({ [outcome]: 1 }));
    const result = await s.jev.evaluate({}, { target: choice('点击', criteria(254)) });
    assert.equal(result.answers.target.choice, outcome);
    for (const r of s.requests) {
      assert.ok(r.questions.target.criteria.none);
      assert.ok(r.questions.target.criteria.ambiguous);
    }
  }
});

test('按字节拆分长候选，公共上下文过大时明确失败', async () => {
  const s = fixture(q => ({ [Object.keys(q.criteria).find(k => k.startsWith('e'))]: 1 }));
  await s.jev.evaluate({}, { target: choice('点击', criteria(100, '文'.repeat(300))) });
  assert.ok(s.requests.length > 1);
  await assert.rejects(s.jev.evaluate('长'.repeat(20000), { target: choice('点击', criteria(254)) }), { code: 'CONTEXT_TOO_LARGE' });
});

test('任一批请求失败，不能用其他批的结果继续执行', async () => {
  let calls = 0;
  const jev = new Jev(modelConfig({ TYPESAFE_API_KEY: 'test' }), async () => {
    calls++;
    return new Response('', { status: 503 });
  });
  await assert.rejects(jev.evaluate({}, { target: choice('点击', criteria(254)) }), { code: 'MODEL_HTTP_503' });
  assert.equal(calls, 2);
});

test('自然语言点击大页面保留目标，最终相近概率仍需确认', async () => {
  const s = fixture((q, id) => {
    if (id === 'operation') return { click: 1 };
    if (id !== 'target') return { none: 1 };
    if (q.criteria.e254) return q.criteria.e1 ? { e254: 0.55, e1: 0.45 } : { e254: 1 };
    return { e1: 0.51, e2: 0.49 };
  });
  const refs = Object.fromEntries(Array.from({ length: 254 }, (_, i) => [`e${i + 1}`,
    { role: 'link', name: i === 253 ? 'Jev - 百度百科' : `结果${i}`, backendNodeId: i + 1 }]));
  const page = { origin: 'https://www.baidu.com', pageId: 'test', refs,
    snapshot: Object.entries(refs).map(([ref, v]) => `- link "${v.name}" [ref=${ref}]`).join('\n') };
  const commands = [];
  const browser = { request: async args => {
    commands.push(args);
    return args[0] === 'snapshot' ? page : { visible: true, enabled: true };
  } };
  const plan = await prepareAct({ instruction: '点击Jev百度百科', probability: 0.85, margin: 0.2 }, browser, s.jev);
  assert.equal(plan.target.ref, 'e254');
  assert.equal(plan.meta.candidateCount, 254);
  assert.equal(plan.meta.modelRequests, s.requests.length);
  assert.equal(plan.uncertainties.length, 1);
  assert.equal((await executePlan(plan, browser)).data.status, 'needs_confirmation');
  assert.equal(commands.some(args => args[0] === 'click'), false);
  const final = s.requests.filter(r => r.questions.target).at(-1).questions.target.criteria;
  assert.ok(final.e2, '同批次第二名进入最终比较');
});

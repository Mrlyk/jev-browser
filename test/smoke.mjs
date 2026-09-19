import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Browser } from '../dist/browser.js';
import { Jev, modelConfig } from '../dist/jev.js';
import { act } from '../dist/semantic.js';
import { withSession } from '../dist/session.js';

// Test-only deterministic decisions. This verifies execution, not model accuracy.
const html = await readFile(new URL('./fixtures/page.html', import.meta.url));
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const cdp = process.env.JEV_TEST_CDP;
if (!cdp) { server.close(); throw Error('请设置 JEV_TEST_CDP，指向独立测试浏览器。'); }
const session = `smoke-${process.pid}`;
const browser = new Browser(['--session', session, '--cdp', cdp]);
const reports = [];

function modelFor(targetDescription) {
  return new Jev(modelConfig({ TYPESAFE_API_KEY: 'synthetic-test-key' }), async (_url, init) => {
    const { questions } = JSON.parse(init.body);
    const criteria = questions.target.criteria;
    const matches = Object.entries(criteria).filter(([k, text]) => /^e\d+$/.test(k) && targetDescription(text));
    assert.equal(matches.length, 1, JSON.stringify(criteria));
    const selected = matches[0][0];
    return new Response(JSON.stringify({ model: 'synthetic-browser-smoke', answers: {
      target: { type: 'choice', choice: selected, confidence: 1,
        probabilities: Object.fromEntries(Object.keys(criteria).map(k => [k, k === selected ? 1 : 0])) },
    } }));
  });
}

async function perform(options, predicate) {
  process.stderr.write(`smoke: ${options.op}${options.dryRun ? ' dry-run' : ''}\n`);
  const result = await act({ instruction: '测试目标', probability: 0.85, margin: 0.2, ...options }, browser, modelFor(predicate));
  reports.push({ operation: options.op, status: result.data.status, timings: result.meta.timings });
  return result;
}

try {
  await withSession(session, async () => {
    await browser.request(['open', `http://127.0.0.1:${server.address().port}`]);
    const first = await browser.request(['snapshot']);
    assert.equal(typeof first.pageId, 'string');
    await perform({ op: 'click', dryRun: true }, text => text.includes('入住信息') && text.includes('button "确认"'));
    assert.equal((await browser.request(['get', 'text', '#result'])).text, '等待操作');
    const exact = ' 张三 $(echo untouched)\n';
    await perform({ op: 'fill', value: exact }, text => text.includes('textbox "姓名"'));
    // input[type=text] normalizes newlines itself; use a value without a newline for the independent assertion.
    assert.equal((await browser.request(['get', 'value', '#name'])).value, exact.replace(/\n/g, ''));
    await perform({ op: 'fill', value: 'secret-123', valueStdin: true }, text => text.includes('textbox "密码"'));
    assert.equal((await browser.request(['get', 'value', '#password'])).value, 'secret-123');
    await perform({ op: 'check' }, text => text.includes('同意用户协议'));
    assert.equal((await browser.request(['is', 'checked', '#agreement'])).checked, true);
    await perform({ op: 'uncheck' }, text => text.includes('同意用户协议'));
    assert.equal((await browser.request(['is', 'checked', '#agreement'])).checked, false);
    await perform({ op: 'select', value: '2人' }, text => text.includes('人数'));
    assert.equal((await browser.request(['get', 'value', '#people'])).value, '2');
    await perform({ op: 'click' }, text => text.includes('入住信息') && text.includes('button "确认"'));
    assert.equal((await browser.request(['get', 'text', '#result'])).text, '入住已确认');
    const read = await perform({ op: 'get_text', scope: '#result' }, text => text.endsWith('status "操作结果"'));
    assert.equal(read.data.result.text, '入住已确认');
    const text = await perform({ op: 'get_text', scope: '#result' }, text => text.endsWith('StaticText "入住已确认"'));
    assert.equal(text.data.result.text, '入住已确认');
  });
  console.log(JSON.stringify({ success: true, model: 'synthetic', reports }, null, 2));
} finally {
  await browser.request(['close']).catch(() => {});
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

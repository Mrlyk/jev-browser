import { mkdir, writeFile } from 'node:fs/promises';
import { Models } from '../dist/interactive/models.js';
import { choice } from '../dist/jev.js';

const questions = { city: choice('选择用户指令中的城市', { beijing: '北京', shanghai: '上海' }) };
const state = { instruction: '选择北京' };
function summary(samples) {
  const ordered = samples.map(sample => sample.durationMs).sort((a, b) => a - b);
  const percentile = p => Math.round(ordered[Math.ceil(ordered.length * p) - 1]);
  return { samples: ordered.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95),
    reusedRequests: samples.filter(sample => sample.reused).length };
}
const report = [];
for (const provider of ['typesafe', 'openrouter']) {
  const warm = new Models();
  try {
    try { warm.config(provider); } catch { report.push({ provider, skipped: 'No configured key' }); continue; }
    const cold = [];
    for (let i = 0; i < 5; i++) {
      const models = new Models();
      try {
        const jev = await models.get(provider); await jev.evaluate(state, questions);
        cold.push(models.status()[0].last);
      } finally { await models.close(); }
    }
    const jev = await warm.get(provider);
    await jev.evaluate(state, questions);
    const reused = [];
    for (let i = 0; i < 10; i++) { await jev.evaluate(state, questions); reused.push(warm.status()[0].last); }
    report.push({ provider, cold: summary(cold), warm: summary(reused), connections: warm.status()[0].connections });
  } finally { await warm.close(); }
}
await mkdir('.cache', { recursive: true });
await writeFile('.cache/model-reuse.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

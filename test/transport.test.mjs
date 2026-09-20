import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ModelTransport } from '../dist/interactive/transport.js';
import { Jev, choice } from '../dist/jev.js';

async function serverFixture(t) {
  let sockets = 0;
  const server = createServer((req, res) => {
    req.resume();
    if (req.url === '/slow') { const timer = setTimeout(() => res.end('{}'), 2000); res.on('close', () => clearTimeout(timer)); return; }
    res.setHeader('Keep-Alive', 'timeout=60');
    if (req.url === '/error') { res.writeHead(401); res.end('denied'.repeat(10000)); return; }
    if (req.url === '/bad') { res.end('invalid JSON'); return; }
    res.end(JSON.stringify({ model: 'local', answers: { pick: { type: 'choice', choice: 'a', confidence: 1, probabilities: { a: 1 } } } }));
  });
  server.keepAliveTimeout = 60_000;
  server.on('connection', () => sockets++);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const transport = new ModelTransport({ httpProxy: '', httpsProxy: '', noProxy: '*' });
  t.after(async () => { await transport.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { server, transport, origin: `http://127.0.0.1:${server.address().port}`, sockets: () => sockets };
}
const questions = { pick: choice('pick a', { a: 'A' }) };

test('20 requests use one actual socket; 401 and malformed JSON do not exhaust the pool', async t => {
  const f = await serverFixture(t);
  const config = { transport: 'typesafe', endpoint: f.origin, model: 'local', key: 'fixture' };
  const jev = new Jev(config, f.transport.fetch);
  for (let i = 0; i < 20; i++) await jev.evaluate({}, questions);
  assert.equal(f.sockets(), 1); assert.equal(f.transport.connections, 1);
  assert.equal(f.transport.metrics.filter(m => m.reused).length, 19);
  config.endpoint = f.origin + '/error'; await assert.rejects(jev.evaluate({}, questions), { code: 'MODEL_HTTP_401' });
  config.endpoint = f.origin + '/bad'; await assert.rejects(jev.evaluate({}, questions), { code: 'INVALID_MODEL_RESPONSE' });
  config.endpoint = f.origin; await jev.evaluate({}, questions); assert.equal(f.sockets(), 1);
  assert.ok(f.transport.metrics.at(-1).headersMs >= 0);
});

test('request abort preserves transport, server disconnect reconnects on demand', async t => {
  const f = await serverFixture(t); const abort = new AbortController();
  const request = f.transport.fetch(f.origin + '/slow', { signal: abort.signal });
  setTimeout(() => abort.abort(), 40); await assert.rejects(request);
  await f.transport.fetch(f.origin); f.server.closeAllConnections();
  await new Promise(resolve => setTimeout(resolve, 50));
  await f.transport.fetch(f.origin); assert.ok(f.sockets() >= 2);
});

test('proxy CONNECT is excluded from model connection metrics', async t => {
  const { connect } = await import('node:net');
  const f = await serverFixture(t);
  const sockets = new Set();
  const proxy = createServer();
  proxy.on('connect', (req, client, head) => {
    const [host, port] = req.url.split(':');
    const upstream = connect(+port, host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head); client.pipe(upstream); upstream.pipe(client);
    });
    sockets.add(client); sockets.add(upstream);
    client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy());
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const transport = new ModelTransport({ httpProxy: `http://127.0.0.1:${proxy.address().port}`, noProxy: '' });
  t.after(async () => { await transport.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => proxy.close(resolve)); });
  for (let i = 0; i < 3; i++) await transport.fetch(f.origin);
  assert.equal(transport.connections, 1);
  assert.equal(transport.metrics.filter(entry => entry.reused).length, 2);
  assert.equal(transport.requestCount, 3);
});

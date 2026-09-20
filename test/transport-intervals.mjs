import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ModelTransport } from '../dist/interactive/transport.js';

let sockets = 0;
const server = createServer((request, response) => {
  request.resume(); response.setHeader('Keep-Alive', 'timeout=60'); response.end('{}');
});
server.keepAliveTimeout = 60_000;
server.on('connection', () => sockets++);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const transport = new ModelTransport({ noProxy: '*' });
const url = `http://127.0.0.1:${server.address().port}`;
try {
  await transport.fetch(url);
  for (const interval of [1000, 10_000, 30_000]) {
    await new Promise(resolve => setTimeout(resolve, interval));
    await transport.fetch(url);
    assert.equal(sockets, 1);
    assert.equal(transport.metrics.at(-1).reused, true);
    console.log(JSON.stringify({ intervalMs: interval, connections: sockets, ...transport.metrics.at(-1) }));
  }
} finally {
  await transport.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

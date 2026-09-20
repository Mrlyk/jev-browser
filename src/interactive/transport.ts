import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import { EnvHttpProxyAgent, fetch as pooledFetch } from 'undici';

export type RequestMetric = { durationMs: number; queueAndConnectMs?: number; headersMs?: number; bodyMs?: number;
  connectionId?: number; reused?: boolean; status?: number };

// Only request-local timing and anonymous socket IDs leave the diagnostic callbacks.
export class ModelTransport {
  private dispatcher: EnvHttpProxyAgent;
  private context = new AsyncLocalStorage<{ metric: RequestMetric; start: number; sent?: number; headers?: number }>();
  private requests = new WeakMap<object, NonNullable<ReturnType<typeof this.context.getStore>>>();
  private sockets = new WeakMap<object, number>();
  private subscriptions: Array<() => void> = [];
  private connectionCount = 0;
  requestCount = 0;
  readonly metrics: RequestMetric[] = [];

  constructor(proxy: { httpProxy?: string; httpsProxy?: string; noProxy?: string } = {}) {
    this.dispatcher = new EnvHttpProxyAgent({ connections: 1, pipelining: 1, keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 60_000, connectTimeout: 10_000, ...proxy });
    this.subscribe('undici:request:create', ({ request }) => {
      const entry = this.context.getStore();
      if (entry && request.method !== 'CONNECT') this.requests.set(request, entry);
    });
    this.subscribe('undici:client:sendHeaders', ({ request, socket }) => {
      const entry = this.requests.get(request);
      if (!entry) return;
      entry.sent = performance.now();
      const existing = this.sockets.get(socket);
      const id = existing ?? ++this.connectionCount;
      this.sockets.set(socket, id);
      Object.assign(entry.metric, { connectionId: id, reused: existing !== undefined, queueAndConnectMs: entry.sent - entry.start });
    });
    this.subscribe('undici:request:headers', ({ request }) => {
      const entry = this.requests.get(request);
      if (!entry) return;
      entry.headers = performance.now();
      entry.metric.headersMs = entry.headers - (entry.sent ?? entry.start);
    });
  }

  private subscribe(name: string, listener: (message: any) => void) {
    const diagnostic = channel(name);
    diagnostic.subscribe(listener);
    this.subscriptions.push(() => diagnostic.unsubscribe(listener));
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const entry = { metric: { durationMs: 0 } as RequestMetric, start: performance.now(), headers: undefined as number | undefined };
    return this.context.run(entry, async () => {
      try {
        const response = await pooledFetch(String(input), { ...init, dispatcher: this.dispatcher } as Parameters<typeof pooledFetch>[1]);
        // Drain both success and error bodies before releasing the connection to the next request.
        const body = await response.arrayBuffer();
        entry.metric.status = response.status;
        entry.metric.bodyMs = performance.now() - (entry.headers ?? entry.start);
        return new Response(body.byteLength ? body : null, { status: response.status, headers: Object.fromEntries(response.headers) });
      } finally {
        this.requestCount++;
        entry.metric.durationMs = performance.now() - entry.start;
        this.metrics.push(entry.metric);
        if (this.metrics.length > 100) this.metrics.shift();
      }
    });
  };

  get connections() { return this.connectionCount; }

  async close() {
    const timer = setTimeout(() => { void this.dispatcher.destroy(); }, 1000);
    try { await this.dispatcher.close(); }
    finally { clearTimeout(timer); this.subscriptions.splice(0).forEach(unsubscribe => unsubscribe()); }
  }
}

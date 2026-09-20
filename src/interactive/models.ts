import { Jev, modelConfig } from '../jev.js';
import { readCredentials } from '../credentials.js';
import { ModelTransport } from './transport.js';
import type { InteractiveOptions } from './options.js';

export class Models {
  private entries = new Map<string, { jev: Jev; transport: ModelTransport; signature: string }>();
  constructor(private env = process.env, private credentials = readCredentials) {}

  config(provider: InteractiveOptions['provider']) {
    const stored = { ...this.credentials(this.env) };
    const env = { ...this.env };
    if (provider === 'openrouter') { delete env.TYPESAFE_API_KEY; delete stored.typesafe; }
    if (provider === 'typesafe') { delete env.OPENROUTER_API_KEY; delete stored.openrouter; }
    return modelConfig(env, stored);
  }

  async get(provider: InteractiveOptions['provider']) {
    const config = this.config(provider);
    const proxy = { httpProxy: this.env.http_proxy ?? this.env.HTTP_PROXY ?? '',
      httpsProxy: this.env.https_proxy ?? this.env.HTTPS_PROXY ?? '', noProxy: this.env.no_proxy ?? this.env.NO_PROXY ?? '' };
    const signature = JSON.stringify([config, proxy]);
    const previous = this.entries.get(config.transport);
    if (previous?.signature === signature) return previous.jev;
    if (previous) await previous.transport.close();
    const transport = new ModelTransport(proxy);
    const jev = new Jev(config, transport.fetch);
    this.entries.set(config.transport, { jev, transport, signature });
    return jev;
  }

  status() {
    return [...this.entries].map(([provider, entry]) => ({ provider, connections: entry.transport.connections,
      requests: entry.transport.requestCount, last: entry.transport.metrics.at(-1) }));
  }

  async close() { await Promise.all([...this.entries.values()].map(entry => entry.transport.close())); this.entries.clear(); }
}

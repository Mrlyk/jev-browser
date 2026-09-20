import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JevError, object } from './errors.js';
import { withSession } from './session.js';

export const providers = ['typesafe', 'openrouter'] as const;
export type Provider = typeof providers[number];
export type Credentials = Partial<Record<Provider, string>>;
export const keyNames = { typesafe: 'TYPESAFE_API_KEY', openrouter: 'OPENROUTER_API_KEY' } as const;

export function credentialsPath(env = process.env): string {
  const base = env.XDG_CONFIG_HOME;
  return join(base && isAbsolute(base) ? base : join(homedir(), '.config'), 'jev-browser', 'credentials.json');
}

export function validKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 16384 && /^[\x21-\x7e]+$/.test(key);
}

export function readCredentials(env = process.env): Credentials {
  const path = credentialsPath(env);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 65536) throw Error();
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!object(data) || Object.keys(data).some(key => !providers.includes(key as Provider)) ||
      Object.values(data).some(key => !validKey(key))) throw Error();
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new JevError('CREDENTIALS_UNAVAILABLE', 'Failed to read credentials. Check the file format and permissions.');
  }
}

export async function saveCredential(provider: Provider, key: string | undefined, env = process.env): Promise<void> {
  const path = credentialsPath(env);
  const directory = dirname(path);
  if (key !== undefined && !validKey(key)) throw new JevError('INVALID_API_KEY', 'API key is empty or invalid.');
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw Error();
    chmodSync(directory, 0o700);
    await withSession('credentials', async () => {
      const data = readCredentials(env);
      if (key === undefined) delete data[provider]; else data[provider] = key;
      const temporary = join(directory, `.credentials-${randomUUID()}.tmp`);
      const fd = openSync(temporary, 'wx', 0o600);
      try {
        try { writeFileSync(fd, JSON.stringify(data) + '\n'); } finally { closeSync(fd); }
        renameSync(temporary, path);
      } finally {
        try { unlinkSync(temporary); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }, directory);
  } catch (error) {
    if (error instanceof JevError) throw error;
    throw new JevError('CREDENTIALS_UNAVAILABLE', 'Failed to save credentials. Check permissions on the user configuration directory.');
  }
}

export function credentialStatus(env = process.env, stored = readCredentials(env)) {
  const entries = providers.map(provider => ({ provider, stored: Boolean(stored[provider]),
    source: env[keyNames[provider]]?.trim() ? 'environment' : stored[provider] ? 'file' : 'none' }));
  return { selected: entries.find(entry => entry.source !== 'none')?.provider ?? null,
    providers: entries, path: credentialsPath(env) };
}

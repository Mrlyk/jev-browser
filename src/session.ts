import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { JevError } from './errors.js';

export function runtimeDir(env = process.env): string {
  return env.JEV_BROWSER_RUNTIME_DIR || join(tmpdir(), `jvb-${process.getuid?.() ?? 'user'}`);
}

export async function withSession<T>(session: string, run: () => Promise<T>, directory = runtimeDir()): Promise<T> {
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(session)) throw new JevError('INVALID_SESSION', 'Session names must contain 1-48 letters, digits, underscores, or hyphens.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${session}.jev-lock`);
  const token = JSON.stringify({ pid: process.pid, token: randomUUID() });
  try {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(token); } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new JevError('SESSION_BUSY', `Session "${session}" is busy. If the previous process exited unexpectedly, verify that the PID in the lock file is no longer running before removing ${path}.`);
    throw new JevError('RUNTIME_UNAVAILABLE', 'Failed to create the session lock. Check permissions on the runtime directory.');
  }
  try { return await run(); }
  finally { if (await readFile(path, 'utf8').catch(() => '') === token) await unlink(path); }
}

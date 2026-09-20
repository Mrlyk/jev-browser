import { mkdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runtimeDir } from './session.js';
import { JevError } from './errors.js';
import type { Plan } from './semantic.js';

type Pending = { version: 1; session: string; expiresAt: number; plan: Plan };
const ttl = 5 * 60_000;

function location(id: string, directory: string): string {
  if (!/^jev-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))
    throw new JevError('INVALID_CONFIRMATION', 'Invalid confirmation ID. Copy the complete ID from the pending plan.');
  return join(directory, `${id}.json`);
}

export async function savePending(plan: Plan, session: string, directory = runtimeDir()) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const id = `jev-${randomUUID()}`;
  const expiresAt = Date.now() + ttl;
  await writeFile(location(id, directory), JSON.stringify({ version: 1, session, expiresAt, plan } satisfies Pending), { flag: 'wx', mode: 0o600 });
  return { id, expiresAt };
}

// Callers hold the session lock. Consume before dispatch so a failed write cannot be replayed.
export async function takePending(id: string, session: string, directory = runtimeDir()): Promise<Plan> {
  const path = location(id, directory);
  let pending: Pending;
  try {
    if ((await stat(path)).size > 4_000_000) throw Error();
    pending = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new JevError('CONFIRMATION_NOT_FOUND', 'Pending plan not found, already consumed, or no longer available. Run the original command again.');
  }
  if (pending.version !== 1 || pending.session !== session)
    throw new JevError('INVALID_CONFIRMATION', 'This confirmation ID belongs to another session. Use the original session name after page act.');
  await unlink(path);
  if (!Number.isFinite(pending.expiresAt) || pending.expiresAt <= Date.now())
    throw new JevError('CONFIRMATION_EXPIRED', 'The pending plan has expired after 5 minutes. Run the original command again.');
  return pending.plan;
}

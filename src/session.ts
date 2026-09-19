import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { JevError } from './errors.js';

export function runtimeDir(env = process.env): string {
  return env.JEV_BROWSER_RUNTIME_DIR || join(tmpdir(), `jvb-${process.getuid?.() ?? 'user'}`);
}

export async function withSession<T>(session: string, run: () => Promise<T>, directory = runtimeDir()): Promise<T> {
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(session)) throw new JevError('INVALID_SESSION', '会话名应为 1–48 个字母、数字、下划线或短横线。');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${session}.jev-lock`);
  const token = JSON.stringify({ pid: process.pid, token: randomUUID() });
  try {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(token); } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new JevError('SESSION_BUSY', `会话正在使用中：${session}。若前一次进程异常退出，确认锁文件中的 PID 已结束后删除 ${path}。`);
    throw new JevError('RUNTIME_UNAVAILABLE', '无法创建会话锁，请检查运行目录权限。');
  }
  try { return await run(); }
  finally { if (await readFile(path, 'utf8').catch(() => '') === token) await unlink(path); }
}

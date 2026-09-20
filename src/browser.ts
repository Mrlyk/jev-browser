import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JevError, object } from './errors.js';
import { runtimeDir, withSession } from './session.js';

export function corePath(): string {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return fileURLToPath(new URL(`../libexec/jev-browser-core-${process.platform}-${process.arch}${suffix}`, import.meta.url));
}

export function coreEnv(env = process.env): NodeJS.ProcessEnv {
  const result = { ...env };
  for (const key of Object.keys(result)) {
    if (key.startsWith('AGENT_BROWSER_') || key === 'TYPESAFE_API_KEY' || key === 'OPENROUTER_API_KEY') delete result[key];
  }
  // Browser configuration can be supplied under our public prefix.
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('JEV_BROWSER_') && !['JEV_BROWSER_RUNTIME_DIR', 'JEV_BROWSER_NO_REPLAY', 'JEV_BROWSER_DAEMON'].includes(key))
      result[key.replace('JEV_BROWSER_', 'AGENT_BROWSER_')] = value;
  }
  result.AGENT_BROWSER_SOCKET_DIR = runtimeDir(env);
  result.AGENT_BROWSER_NAMESPACE = 'jev';
  result.AGENT_BROWSER_NO_REPLAY = '1';
  result.AGENT_BROWSER_SKILLS_DIR = fileURLToPath(new URL('../skills', import.meta.url));
  return result;
}

type CoreResult = { code: number; stdout: string; stderr: string };

export function publicBrowserError(message: string, args: string[]): string {
  const sessionIndex = args.lastIndexOf('--session');
  const session = sessionIndex >= 0 ? args[sessionIndex + 1] : '<session>';
  const connection: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cdp') connection.push(args[i], args[++i]);
    else if (['--auto-connect', '--pin-tab', '--no-pin-tab'].includes(args[i])) {
      connection.push(args[i]);
      if (['true', 'false'].includes(args[i + 1])) connection.push(args[++i]);
    }
  }
  const quote = (word: string) => /^[\w:/.-]+$/.test(word) ? word : "'" + word.replaceAll("'", "'\\''") + "'";
  const suffix = connection.length ? ' ' + connection.map(quote).join(' ') : '';
  const list = `jevb tab list ${session}${suffix}`;
  if (message.startsWith('tab_gone:')) {
    const detail = message.split('. Run `')[0];
    return `${detail}. The bound tab is no longer available in this browser.\n` +
      `List tabs: ${list}\n` +
      `Select a tab: jevb tab switch ${session} <tab-id>${suffix}\n` +
      `Open a new tab: jevb tab create ${session} <url>${suffix}`;
  }
  return message.replace(/`(?:agent-browser tab(?: list)?|jevb tab list <session>)( --json)?`/g,
    (_match, json) => `\`${list}${json ?? ''}\``);
}

export class Browser {
  constructor(readonly args: string[], private env = coreEnv()) {}

  async run(command: string[], options: { input?: string; passthrough?: boolean; progress?: boolean; timeoutMs?: number } = {}): Promise<CoreResult> {
    const binary = corePath();
    try { await access(binary, constants.X_OK); }
    catch { throw new JevError('CORE_NOT_INSTALLED', 'Browser executor not found for this platform. For a source checkout, run npm run build:core; otherwise check package platform support.'); }
    return new Promise((resolve, reject) => {
      const child = spawn(binary, [...this.args, ...command], {
        env: this.env, shell: false, windowsHide: true,
        stdio: [options.input !== undefined ? 'pipe' : 'inherit', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '', timedOut = false, oversized = false;
      const timer = options.timeoutMs ? setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs) : undefined;
      child.stdout!.on('data', chunk => {
        if (options.progress) process.stderr.write(chunk);
        if (options.passthrough) process.stdout.write(chunk);
        else { stdout += chunk; if (stdout.length > 8_000_000) { oversized = true; child.kill(); } }
      });
      child.stderr!.on('data', chunk => {
        if (options.passthrough || options.progress) process.stderr.write(chunk);
        else if (stderr.length < 16_000) stderr += chunk;
      });
      child.once('error', () => { clearTimeout(timer); reject(new JevError('CORE_START_FAILED', 'Failed to start the bundled browser executor.')); });
      child.once('close', code => {
        clearTimeout(timer);
        if (timedOut || oversized || code === null) reject(new JevError('EXECUTION_UNKNOWN', 'Browser executor interrupted. Execution outcome is unknown; the action was not replayed.', true));
        else resolve({ code, stdout, stderr });
      });
      if (options.input !== undefined) {
        child.stdin!.on('error', () => {});
        child.stdin!.end(options.input);
      }
    });
  }

  async request(command: string[], options: { dispatch?: boolean; privateValue?: string } = {}): Promise<any> {
    const batch = options.dispatch === true;
    const result = await this.run(batch ? ['--json', 'batch', '--bail'] : ['--json', ...command], {
      input: batch ? JSON.stringify([command]) : undefined, timeoutMs: 60_000,
    });
    let raw: any;
    try { raw = JSON.parse(result.stdout); }
    catch { throw new JevError(options.dispatch ? 'EXECUTION_UNKNOWN' : 'INVALID_CORE_RESPONSE', 'Browser executor did not return complete JSON.', !!options.dispatch); }
    if (batch && Array.isArray(raw) && raw.length === 1) raw = { ...raw[0], data: raw[0].result };
    if (!object(raw) || typeof raw.success !== 'boolean') throw new JevError('INVALID_CORE_RESPONSE', 'Invalid browser executor response.', !!options.dispatch);
    if (!raw.success || result.code !== 0) {
      let message = typeof raw.error === 'string' ? publicBrowserError(raw.error, this.args) : 'Browser command failed.';
      const unknown = message.includes('EXECUTION_UNKNOWN:') || (!!options.dispatch && /timed? ?out|timeout|connection.*closed|websocket|disconnected/i.test(message));
      if (options.privateValue !== undefined) message = unknown
        ? 'Execution outcome is unknown. Input value and raw error were redacted; the action was not replayed.'
        : 'Browser action failed. Input value and raw error were redacted.';
      throw new JevError(unknown ? 'EXECUTION_UNKNOWN' : 'BROWSER_ERROR', message, !!options.dispatch || unknown);
    }
    return raw.data;
  }

  async passthrough(command: string[]): Promise<number> {
    // Only retry a proven pre-launch failure; never retry an action timeout.
    if (command[0] === 'open' || command[0] === 'goto' || command[0] === 'navigate') {
      let result = await this.run(command);
      if (result.code !== 0 && /Chrome not found\. Checked:/.test(result.stdout + result.stderr)) {
        process.stderr.write('首次启动：正在下载 Chrome for Testing。\n');
        await withSession('browser-install', async () => {
          const install = await this.run(['install'], { progress: true });
          if (install.code !== 0) throw new JevError('BROWSER_INSTALL_FAILED', 'Browser download failed. Check the network, certificates, and directory permissions.');
        });
        result = await this.run(command);
      }
      process.stdout.write(result.stdout); process.stderr.write(result.stderr);
      return result.code;
    }
    return (await this.run(command, { passthrough: true })).code;
  }
}

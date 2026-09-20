import { emitKeypressEvents, type Key } from 'node:readline';
import { JevError } from './errors.js';
import { validKey } from './credentials.js';

export async function readToken(fromStdin: boolean): Promise<string> {
  let value = '';
  if (fromStdin) {
    if (process.stdin.isTTY) throw new JevError('NEEDS_INPUT', '--with-token requires an API key on stdin.');
    for await (const chunk of process.stdin) {
      value += chunk.toString();
      if (value.length > 16386) throw new JevError('INVALID_API_KEY', 'API key exceeds the maximum length of 16384 characters.');
    }
  } else {
    if (!process.stdin.isTTY || !process.stderr.isTTY)
      throw new JevError('NEEDS_INPUT', 'Interactive login requires a terminal. For automation, use jevb auth login --with-token to read the API key from stdin.');
    value = await hiddenToken();
  }
  value = value.trim();
  if (!validKey(value)) throw new JevError('INVALID_API_KEY', 'API key is empty or invalid.');
  return value;
}

function hiddenToken(): Promise<string> {
  const input = process.stdin;
  const wasRaw = input.isRaw;
  emitKeypressEvents(input);
  input.setRawMode(true);
  process.stderr.write('API Key（输入隐藏）：');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      input.removeListener('keypress', onKey);
      input.removeListener('end', onEnd);
      input.setRawMode(wasRaw);
      input.pause();
      process.stderr.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onEnd = () => finish(new JevError('NEEDS_INPUT', 'Input ended before an API key was submitted. No key was saved.'));
    const onKey = (text: string, key: Key) => {
      if (key.ctrl && (key.name === 'c' || key.name === 'd'))
        return finish(new JevError('AUTH_CANCELLED', 'Login cancelled. No key was saved.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { value = value.slice(0, -1); return; }
      if (!key.ctrl && !key.meta && text && /^[\x20-\x7e]+$/.test(text)) value += text;
      if (value.length > 16384) finish(new JevError('INVALID_API_KEY', 'API key exceeds the maximum length of 16384 characters.'));
    };
    input.on('keypress', onKey);
    input.once('end', onEnd);
    input.resume();
  });
}

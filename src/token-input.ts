import { emitKeypressEvents, type Key } from 'node:readline';
import { JevError } from './errors.js';
import { validKey } from './credentials.js';

export async function readToken(fromStdin: boolean): Promise<string> {
  let value = '';
  if (fromStdin) {
    if (process.stdin.isTTY) throw new JevError('NEEDS_INPUT', '--with-token 需要通过管道输入 Key。');
    for await (const chunk of process.stdin) {
      value += chunk.toString();
      if (value.length > 16386) throw new JevError('INVALID_API_KEY', 'API Key 过长。');
    }
  } else {
    if (!process.stdin.isTTY || !process.stderr.isTTY)
      throw new JevError('NEEDS_INPUT', '交互登录需要终端；自动化请先执行 jev-browser auth login --with-token 从标准输入读取 Key。');
    value = await hiddenToken();
  }
  value = value.trim();
  if (!validKey(value)) throw new JevError('INVALID_API_KEY', 'API Key 为空或格式无效。');
  return value;
}

function hiddenToken(): Promise<string> {
  const input = process.stdin;
  const wasRaw = input.isRaw;
  emitKeypressEvents(input);
  input.setRawMode(true);
  process.stderr.write('API Key（输入隐藏；将发送一次最小 Jev 请求验证）：');
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
    const onEnd = () => finish(new JevError('NEEDS_INPUT', '输入已结束，未保存 Key。'));
    const onKey = (text: string, key: Key) => {
      if (key.ctrl && (key.name === 'c' || key.name === 'd'))
        return finish(new JevError('AUTH_CANCELLED', '已取消，未保存 Key。'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { value = value.slice(0, -1); return; }
      if (!key.ctrl && !key.meta && text && /^[\x20-\x7e]+$/.test(text)) value += text;
      if (value.length > 16384) finish(new JevError('INVALID_API_KEY', 'API Key 过长。'));
    };
    input.on('keypress', onKey);
    input.once('end', onEnd);
    input.resume();
  });
}

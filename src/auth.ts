import { Jev, choice, modelConfig } from './jev.js';
import { credentialStatus, keyNames, providers, readCredentials, saveCredential, validKey, type Provider } from './credentials.js';
import { JevError } from './errors.js';
import { readToken } from './token-input.js';

const help = `账号：
  jev-browser auth login                         登录
  jev-browser auth login [typesafe|openrouter] --with-token  从标准输入登录
  jev-browser auth status [--json]                查看登录状态
  jev-browser auth logout typesafe|openrouter      删除本地 Key
  jev-browser auth login <会话名> <网站账号名>      在指定会话登录已保存的网站账号
`;

export async function ensureLogin(): Promise<void> {
  if (credentialStatus().selected) return;
  process.stderr.write('请先登录。\n');
  const key = await readToken(false);
  await login(key.startsWith('sk') ? 'openrouter' : 'typesafe', key);
  process.stderr.write('登录成功。\n');
}

export async function login(provider: Provider, key: string, options: { env?: NodeJS.ProcessEnv; request?: typeof fetch } = {}) {
  if (!validKey(key)) throw new JevError('INVALID_API_KEY', 'API Key 为空或格式无效。');
  const env = options.env ?? process.env;
  // Validate the submitted key/provider even if environment or stored credentials differ.
  const config = modelConfig({ [keyNames[provider]]: key,
    TYPESAFE_MODEL: env.TYPESAFE_MODEL, OPENROUTER_MODEL: env.OPENROUTER_MODEL });
  readCredentials(env); // Reject an unreadable store before making a paid request.
  const start = performance.now();
  const result = await new Jev(config, options.request).evaluate('ready', {
    check: choice('Is the state ready?', { yes: 'Ready', no: 'Not ready' }),
  });
  if (result.answers.check.type !== 'choice' || result.answers.check.choice !== 'yes')
    throw new JevError('MODEL_CHECK_FAILED', '登录失败，请稍后重试。');
  const durationMs = Math.round(performance.now() - start);
  await saveCredential(provider, key, env);
  return { provider, model: config.model, verified: true, durationMs, ...credentialStatus(env) };
}

// Reserve provider names; preserve upstream website authentication commands.
export async function handleAuth(args: string[], json = false): Promise<boolean> {
  json ||= args.includes('--json');
  const rest = args.filter(arg => arg !== '--json');
  const [command, ...parameters] = rest;
  const provider = parameters[0]?.startsWith('-') ? undefined : parameters[0];
  const flags = provider ? parameters.slice(1) : parameters;
  const modelProvider = providers.includes(provider as Provider);
  const wantsHelp = ['login', 'logout', 'status'].includes(command) &&
    (!provider || modelProvider) && flags.some(flag => ['--help', '-h'].includes(flag));
  if (!command || ['--help', '-h', 'help'].includes(command) || wantsHelp) {
    process.stdout.write(json ? JSON.stringify({ success: true, data: { help } }) + '\n' : help);
    return true;
  }
  if (command !== 'status' && command !== 'logout' && !(command === 'login' && (!provider || modelProvider || rest.includes('--with-token'))))
    return false;
  if ((command === 'status' && rest.length !== 1) ||
    (command !== 'status' && ((provider ? !modelProvider : command !== 'login') || flags.length > 1 ||
      flags.some(flag => command !== 'login' || flag !== '--with-token'))))
    throw new JevError('INVALID_ARGUMENT', '用法：auth login [typesafe|openrouter] [--with-token]；auth status；auth logout typesafe|openrouter。');
  let data;
  if (command === 'login') {
    const key = await readToken(flags.includes('--with-token'));
    data = await login((provider as Provider | undefined) ?? (key.startsWith('sk') ? 'openrouter' : 'typesafe'), key);
  } else if (command === 'logout') {
    await saveCredential(provider as Provider, undefined);
    data = { removed: provider, ...credentialStatus() };
  } else data = credentialStatus();
  process.stdout.write(json ? JSON.stringify({ success: true, data }) + '\n' : command === 'login' ? '登录成功。\n' :
    `${command === 'logout' ? '已删除本地 Key；环境变量仍可生效。\n' : ''}` +
    `当前提供方：${data.selected ?? '未配置'}\n` +
    data.providers.map(item => `${item.provider}: ${item.source}（本地${item.stored ? '已保存' : '未保存'}）`).join('\n') + '\n');
  return true;
}

import { Jev, choice, modelConfig } from './jev.js';
import { credentialStatus, keyNames, providers, readCredentials, saveCredential, validKey, type Provider } from './credentials.js';
import { JevError } from './errors.js';
import { readToken } from './token-input.js';

const help = `模型凭据：
  jev-browser auth login typesafe|openrouter [--with-token]
  jev-browser auth status [--json]
  jev-browser auth logout typesafe|openrouter
login 通过隐藏输入或 stdin 接收 Key，发送一次最小 Jev 请求，成功后保存。
同一提供方的环境变量覆盖本地 Key；两个提供方均可用时优先 TypeSafe。
logout 仅删除本地 Key；status 显示配置来源，不请求模型或显示 Key。
网站账号命令 auth save/list/show/delete 和 auth login <其他名称> 保持原有用途。
`;

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
  if (result.answers.check.choice !== 'yes')
    throw new JevError('MODEL_CHECK_FAILED', 'Jev 未通过最小判断检查，未保存 Key。');
  const durationMs = Math.round(performance.now() - start);
  await saveCredential(provider, key, env);
  return { provider, model: config.model, verified: true, durationMs, ...credentialStatus(env) };
}

// Reserve provider names; preserve upstream website authentication commands.
export async function handleAuth(args: string[], json = false): Promise<boolean> {
  json ||= args.includes('--json');
  const rest = args.filter(arg => arg !== '--json');
  const [command, provider, ...flags] = rest;
  const modelProvider = providers.includes(provider as Provider);
  const wantsHelp = ['login', 'logout', 'status'].includes(command) &&
    ((!provider || modelProvider) && flags.some(flag => ['--help', '-h'].includes(flag)) || ['--help', '-h'].includes(provider));
  if (!command || ['--help', '-h', 'help'].includes(command) || wantsHelp) {
    process.stdout.write(json ? JSON.stringify({ success: true, data: { help } }) + '\n' : help);
    return true;
  }
  if (command !== 'status' && command !== 'logout' && !(command === 'login' && (!provider || modelProvider || rest.includes('--with-token'))))
    return false;
  if ((command === 'status' && rest.length !== 1) ||
    (command !== 'status' && (!modelProvider || flags.length > 1 ||
      flags.some(flag => command !== 'login' || flag !== '--with-token'))))
    throw new JevError('INVALID_ARGUMENT', '用法：auth login typesafe|openrouter [--with-token]；auth status；auth logout typesafe|openrouter。');
  let data;
  if (command === 'login') data = await login(provider as Provider, await readToken(flags.includes('--with-token')));
  else if (command === 'logout') {
    await saveCredential(provider as Provider, undefined);
    data = { removed: provider, ...credentialStatus() };
  } else data = credentialStatus();
  process.stdout.write(json ? JSON.stringify({ success: true, data }) + '\n' :
    `${command === 'login' ? 'Jev 检查通过，已保存 Key。\n' : command === 'logout' ? '已删除本地 Key；环境变量仍可生效。\n' : ''}` +
    `当前提供方：${data.selected ?? '未配置'}\n` +
    data.providers.map(item => `${item.provider}: ${item.source}（本地${item.stored ? '已保存' : '未保存'}）`).join('\n') + '\n');
  return true;
}

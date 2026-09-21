import { login } from '../auth.js';
import { credentialStatus } from '../credentials.js';
import { JevError } from '../errors.js';
import { readToken } from '../token-input.js';
import type { InteractiveOptions } from './options.js';

export async function ensureInteractiveLogin(provider: InteractiveOptions['provider']): Promise<void> {
  const status = credentialStatus();
  const configured = provider === 'auto' ? status.selected !== null :
    status.providers.some(item => item.provider === provider && item.source !== 'none');
  if (configured) return;

  process.stderr.write('Sign in to Jev Browser. Enter your API key to continue. Ctrl+C to exit.\n');
  while (true) {
    try {
      const key = await readToken(false, 'API key (hidden): ');
      await login(provider === 'auto' ? key.startsWith('sk') ? 'openrouter' : 'typesafe' : provider, key);
      process.stderr.write('Signed in.\n');
      return;
    } catch (error) {
      if (!(error instanceof JevError) || !/^(INVALID_API_KEY|MODEL_HTTP_\d+|MODEL_UNAVAILABLE|INVALID_MODEL_RESPONSE|MODEL_CHECK_FAILED)$/.test(error.code)) throw error;
      process.stderr.write(`${error.message}\nTry again, or press Ctrl+C to exit.\n`);
    }
  }
}

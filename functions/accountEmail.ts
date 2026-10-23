import type { EmailMessage } from '../src/meta/account';

export interface AccountEmailEnv {
  EMAIL?: { send(message: EmailMessage & { from: string }): Promise<unknown> };
  EMAIL_FROM?: string;
  EMAIL_ACCOUNT_ID?: string;
  EMAIL_API_TOKEN?: string;
}

export function accountEmailSender(env: AccountEmailEnv, fetcher: typeof fetch = fetch): ((message: EmailMessage) => Promise<void>) | null {
  const from = env.EMAIL_FROM;
  if (!from) return null;
  const binding = env.EMAIL;
  if (binding) return async message => { await binding.send({ ...message, from }); };
  const accountId = env.EMAIL_ACCOUNT_ID;
  const token = env.EMAIL_API_TOKEN;
  if (!accountId || !/^[0-9a-f]{32}$/i.test(accountId) || !token) return null;
  return async message => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`, {
        method: 'POST', signal: controller.signal, redirect: 'error',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...message, from }),
      });
      if (!response.ok) throw new Error('email-send-failed');
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object') throw new Error('email-send-failed');
      const data = payload as { success?: unknown; result?: { delivered?: unknown; queued?: unknown; permanent_bounces?: unknown } };
      const delivered = data.result?.delivered;
      const queued = data.result?.queued;
      const bounced = data.result?.permanent_bounces;
      const accepted = (Array.isArray(delivered) && delivered.includes(message.to)) || (Array.isArray(queued) && queued.includes(message.to));
      if (data.success !== true || !accepted || (Array.isArray(bounced) && bounced.includes(message.to))) throw new Error('email-send-failed');
    } catch {
      throw new Error('email-send-failed');
    } finally {
      clearTimeout(timeout);
    }
  };
}

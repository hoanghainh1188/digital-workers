import type { Provider } from '@dw/billing';

/** The provider could not be reached; the key was neither accepted nor refused. */
export class ProviderUnreachableError extends Error {
  constructor() {
    super('Provider could not be reached');
    this.name = 'ProviderUnreachableError';
  }
}

export type KeyCheck = 'ok' | 'invalid';

type Fetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  status: number;
}>;

const ENDPOINTS: Record<
  Provider,
  (key: string) => { url: string; headers: Record<string, string> }
> = {
  anthropic: (key) => ({
    url: 'https://api.anthropic.com/v1/models?limit=1',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  }),
  openai: (key) => ({
    url: 'https://api.openai.com/v1/models',
    headers: { authorization: `Bearer ${key}` },
  }),
};

/**
 * Checks a new key with the provider's model listing (design D10): costs no tokens,
 * so no CostEntry. 401/403 → invalid. The only provider request outside the AI SDK,
 * and it stays inside packages/llm. Errors never include the key.
 */
export async function verifyProviderKey(
  provider: Provider,
  apiKey: string,
  fetchImpl: Fetch = fetch,
): Promise<KeyCheck> {
  const { url, headers } = ENDPOINTS[provider](apiKey);
  let status: number;
  try {
    status = (await fetchImpl(url, { method: 'GET', headers, signal: AbortSignal.timeout(10_000) }))
      .status;
  } catch {
    throw new ProviderUnreachableError();
  }
  if (status === 401 || status === 403) return 'invalid';
  if (status >= 200 && status < 300) return 'ok';
  throw new ProviderUnreachableError();
}

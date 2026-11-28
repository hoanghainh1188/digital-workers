import type { Provider } from '@dw/billing';

/**
 * Gateway errors (design D6). None of them carries a request, headers, an API key or
 * the provider's response body, so logging or returning them never leaks a secret.
 */

export class NoCompanyError extends Error {
  constructor() {
    super('A model call must belong to a company');
    this.name = 'NoCompanyError';
  }
}

export class ModelNotPricedError extends Error {
  readonly provider: Provider;
  readonly model: string;
  constructor(provider: Provider, model: string) {
    super(`Model ${provider}/${model} has no price in effect`);
    this.name = 'ModelNotPricedError';
    this.provider = provider;
    this.model = model;
  }
}

/** "Công ty đã hết credit": balance ≤ 0, nothing was sent to the provider. */
export class CreditExhaustedError extends Error {
  constructor() {
    super('The company has run out of credit');
    this.name = 'CreditExhaustedError';
  }
}

/** "Nhà cung cấp chưa cấu hình": no key, or the stored key cannot be decrypted. */
export class ProviderNotConfiguredError extends Error {
  readonly provider: Provider;
  constructor(provider: Provider) {
    super(`Provider ${provider} is not configured`);
    this.name = 'ProviderNotConfiguredError';
    this.provider = provider;
  }
}

/**
 * The provider answered but the charge could not be recorded (after retries). The
 * gateway logged company, model and tokens so the call can be billed by hand.
 */
export class UsageNotRecordedError extends Error {
  constructor() {
    super('Model call succeeded but its cost could not be recorded');
    this.name = 'UsageNotRecordedError';
  }
}

/** The provider call failed before returning usage. No CostEntry was written. */
export class ProviderCallError extends Error {
  readonly provider: Provider;
  /** HTTP status from the provider, when there was one. */
  readonly status: number | null;
  readonly code: 'auth' | 'rate_limited' | 'server' | 'bad_request' | 'network' | 'unknown';
  constructor(provider: Provider, status: number | null) {
    const code = classify(status);
    super(`Provider ${provider} call failed (${code}${status ? ` ${status}` : ''})`);
    this.name = 'ProviderCallError';
    this.provider = provider;
    this.status = status;
    this.code = code;
  }
}

function classify(status: number | null): ProviderCallError['code'] {
  if (status === null) return 'network';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'unknown';
}

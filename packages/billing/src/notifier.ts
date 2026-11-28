import type { BalanceEvent } from './events.ts';

/** Port for "credit sắp hết" / "hết credit" emails (design D9). apps/api supplies the email version. */
export type Notifier = {
  readonly lowBalance: (
    companyId: string,
    balanceVnd: number,
    thresholdVnd: number,
  ) => Promise<void>;
  readonly exhausted: (companyId: string) => Promise<void>;
};

export const silentNotifier: Notifier = {
  lowBalance: async () => {},
  exhausted: async () => {},
};

/**
 * Sends the events of a committed balance change without waiting: a failed email never
 * undoes a transaction (design D5, step 5). Errors go to `onError` (no addresses there).
 */
export function dispatchBalanceEvents(
  notifier: Notifier,
  companyId: string,
  events: readonly BalanceEvent[],
  onError: (error: unknown) => void,
): void {
  for (const event of events) {
    const sent =
      event.type === 'low'
        ? notifier.lowBalance(companyId, event.balanceVnd, event.thresholdVnd)
        : notifier.exhausted(companyId);
    void sent.catch(onError);
  }
}

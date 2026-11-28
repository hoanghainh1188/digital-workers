/**
 * "Credit sắp hết" / "hết credit" decisions (design D5, spec credit-ledger, 0.2 #071).
 * Pure: the ledger stores the resulting flags in the same UPDATE as the balance.
 */

export type BalanceEvent =
  | { readonly type: 'low'; readonly balanceVnd: number; readonly thresholdVnd: number }
  | { readonly type: 'exhausted' };

export type NotifyFlags = { readonly lowNotified: boolean; readonly zeroNotified: boolean };

/** 20% of the latest credit, rounded down. 0 when nothing was ever credited. */
export function lowThreshold(lastCreditVnd: number): number {
  return Math.floor((lastCreditVnd * 20) / 100);
}

export type CreditState = 'normal' | 'low' | 'exhausted';

export function creditState(balanceVnd: number, lastCreditVnd: number): CreditState {
  if (balanceVnd <= 0) return 'exhausted';
  return balanceVnd < lowThreshold(lastCreditVnd) ? 'low' : 'normal';
}

/** After a debit: which emails to send, and the new flags. */
export function afterDebit(
  before: number,
  after: number,
  lastCreditVnd: number,
  flags: NotifyFlags,
): { events: BalanceEvent[]; flags: NotifyFlags } {
  const events: BalanceEvent[] = [];
  let { lowNotified, zeroNotified } = flags;
  const threshold = lowThreshold(lastCreditVnd);
  if (after > 0 && after < threshold && !lowNotified) {
    events.push({ type: 'low', balanceVnd: after, thresholdVnd: threshold });
    lowNotified = true;
  }
  if (before > 0 && after <= 0 && !zeroNotified) {
    events.push({ type: 'exhausted' });
    zeroNotified = true;
  }
  return { events, flags: { lowNotified, zeroNotified } };
}

/** After a credit of `amountVnd` (which becomes the new 20% base): lowered flags. */
export function afterCredit(after: number, amountVnd: number, flags: NotifyFlags): NotifyFlags {
  return {
    lowNotified: flags.lowNotified && after < lowThreshold(amountVnd),
    zeroNotified: flags.zeroNotified && after <= 0,
  };
}

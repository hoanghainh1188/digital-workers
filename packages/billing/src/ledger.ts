import {
  type CompanyTx,
  costEntries,
  creditAccounts,
  creditTransactions,
  type Database,
  isUniqueViolation,
  withCompany,
} from '@dw/db';
import { and, eq, sql } from '@dw/db/drizzle';
import {
  type EffectivePrice,
  effectiveDefaultMultiplier,
  effectiveFxRate,
  resolveMultiplier,
} from './effective.ts';
import { afterCredit, afterDebit, type BalanceEvent } from './events.ts';
import { applyCarry, computeCost, type TokenUsage } from './pricing.ts';

/** Trial credit for a new company (0.2 #073). */
export const TRIAL_AMOUNT_VND = 200_000;
/** Largest manual adjustment in one go (0.2 #103). */
export const MAX_ADJUSTMENT_VND = 100_000_000;

export type CreditReason = 'bank_transfer' | 'trial' | 'system_fix' | 'other';
export type TransactionKind = 'usage' | 'trial' | 'adjustment';

export type CreditTransactionView = {
  readonly id: string;
  readonly kind: TransactionKind;
  readonly amountVnd: number;
  readonly balanceAfterVnd: number;
  readonly reason: CreditReason | null;
  readonly note: string | null;
  readonly createdAt: Date;
};

/** The idempotency key was already used for a different adjustment. */
export class IdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key reused with a different request');
    this.name = 'IdempotencyConflictError';
  }
}

export class InsufficientBalanceError extends Error {
  constructor() {
    super('Debit exceeds the current balance');
    this.name = 'InsufficientBalanceError';
  }
}

type Db = Pick<Database, 'db'>;

const transactionColumns = {
  id: creditTransactions.id,
  kind: creditTransactions.kind,
  amountVnd: creditTransactions.amountVnd,
  balanceAfterVnd: creditTransactions.balanceAfterVnd,
  reason: creditTransactions.reason,
  note: creditTransactions.note,
  createdAt: creditTransactions.createdAt,
};

/**
 * Ledger rows are stamped after the account lock is held (`clock_timestamp()`, not the
 * transaction's start time), so their order matches the order of "balance after".
 */
const afterLock = sql<Date>`clock_timestamp()`;

/** Creates the company's account (0đ) inside the company-creation transaction. */
export async function ensureCreditAccount(tx: CompanyTx, companyId: string): Promise<void> {
  await tx.insert(creditAccounts).values({ companyId }).onConflictDoNothing();
}

/**
 * Locks the company's account row (SELECT … FOR UPDATE, design D5): every balance
 * change of one company queues here, so concurrent debits never lose one.
 */
async function lockAccount(tx: CompanyTx, companyId: string) {
  await ensureCreditAccount(tx, companyId);
  const [account] = await tx
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.companyId, companyId))
    .for('update');
  if (!account) throw new Error('credit account missing');
  return account;
}

/** Current balance, without locking (the gateway's pre-call check, design D6). */
export async function readBalance(database: Db, companyId: string): Promise<number> {
  return withCompany(database, companyId, async (tx) => {
    const [row] = await tx
      .select({ balance: creditAccounts.balanceVnd })
      .from(creditAccounts)
      .where(eq(creditAccounts.companyId, companyId));
    return row?.balance ?? 0;
  });
}

export type UsageInput = {
  readonly companyId: string;
  readonly workerId?: string | null;
  readonly taskId?: string | null;
  readonly price: EffectivePrice;
  readonly usage: TokenUsage;
  /** When the call was made: picks the exchange rate and default multiplier. */
  readonly at: Date;
};

export type UsageRecord = {
  readonly costEntryId: string;
  readonly transactionId: string;
  readonly debitVnd: number;
  readonly balanceAfterVnd: number;
  readonly vndPerUsd: number;
  readonly multiplierPermille: number;
  readonly realMicroVnd: bigint;
  readonly chargeMicroVnd: bigint;
  /** Emails to send after commit (design D9). */
  readonly events: readonly BalanceEvent[];
};

/**
 * Records one finished model call (design D5): a CostEntry, exactly one `usage`
 * transaction (even for 0đ) and the account update, in one transaction. The balance
 * may go below zero: a finished call is always charged in full (0.2 #095).
 */
export async function recordUsage(database: Db, input: UsageInput): Promise<UsageRecord> {
  return withCompany(database, input.companyId, async (tx) => {
    const account = await lockAccount(tx, input.companyId);
    const vndPerUsd = await effectiveFxRate(tx, input.at);
    const multiplier = resolveMultiplier(
      account.multiplierPermille,
      await effectiveDefaultMultiplier(tx, input.at),
    );
    const cost = computeCost(input.usage, input.price, vndPerUsd, multiplier);
    const { debitVnd, carryMicroVnd } = applyCarry(account.carryMicroVnd, cost.chargeMicroVnd);
    const balanceAfterVnd = account.balanceVnd - debitVnd;

    const [entry] = await tx
      .insert(costEntries)
      .values({
        companyId: input.companyId,
        workerId: input.workerId ?? null,
        taskId: input.taskId ?? null,
        provider: input.price.provider,
        model: input.price.model,
        priceId: input.price.id,
        ...input.usage,
        vndPerUsd,
        multiplierPermille: multiplier,
        realCostMicroVnd: cost.realMicroVnd,
        chargeMicroVnd: cost.chargeMicroVnd,
        createdAt: input.at,
      })
      .returning({ id: costEntries.id });
    if (!entry) throw new Error('cost entry insert returned no row');

    const [transaction] = await tx
      .insert(creditTransactions)
      .values({
        companyId: input.companyId,
        kind: 'usage',
        amountVnd: -debitVnd,
        balanceAfterVnd,
        costEntryId: entry.id,
        createdAt: afterLock,
      })
      .returning({ id: creditTransactions.id });
    if (!transaction) throw new Error('credit transaction insert returned no row');

    const decision = afterDebit(
      account.balanceVnd,
      balanceAfterVnd,
      account.lastCreditVnd,
      account,
    );
    await tx
      .update(creditAccounts)
      .set({ balanceVnd: balanceAfterVnd, carryMicroVnd, ...decision.flags, updatedAt: new Date() })
      .where(eq(creditAccounts.companyId, input.companyId));

    return {
      costEntryId: entry.id,
      transactionId: transaction.id,
      debitVnd,
      balanceAfterVnd,
      vndPerUsd,
      multiplierPermille: multiplier,
      realMicroVnd: cost.realMicroVnd,
      chargeMicroVnd: cost.chargeMicroVnd,
      events: decision.events,
    };
  });
}

export type AdjustmentInput = {
  readonly companyId: string;
  readonly direction: 'credit' | 'debit';
  /** Positive whole đồng, at most MAX_ADJUSTMENT_VND. */
  readonly amountVnd: number;
  readonly reason: CreditReason;
  readonly note: string;
  readonly actorAdminId: string;
  /** Same key twice → the first transaction is returned, nothing new is written. */
  readonly idempotencyKey: string;
  /**
   * Runs inside the same transaction after a new (not replayed) adjustment, e.g. the
   * platform audit event, so the change and its log commit or fail together.
   */
  readonly onWritten?: (tx: CompanyTx, transaction: CreditTransactionView) => Promise<void>;
};

export type AdjustmentResult = {
  readonly transaction: CreditTransactionView;
  readonly replayed: boolean;
  readonly events: readonly BalanceEvent[];
};

/** Manual credit or debit by a platform admin (spec platform-admin "Điều chỉnh credit tay"). */
export async function adjustCredit(
  database: Db,
  input: AdjustmentInput,
): Promise<AdjustmentResult> {
  if (!Number.isSafeInteger(input.amountVnd) || input.amountVnd < 1) {
    throw new RangeError('amount must be a positive integer');
  }
  if (input.amountVnd > MAX_ADJUSTMENT_VND) throw new RangeError('amount above the limit');
  return withCompany(database, input.companyId, async (tx) => {
    const account = await lockAccount(tx, input.companyId);
    const [previous] = await tx
      .select(transactionColumns)
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.companyId, input.companyId),
          eq(creditTransactions.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (previous) {
      const signedBefore = input.direction === 'credit' ? input.amountVnd : -input.amountVnd;
      if (
        previous.amountVnd !== signedBefore ||
        previous.reason !== input.reason ||
        previous.note !== input.note
      ) {
        throw new IdempotencyConflictError();
      }
      return { transaction: previous, replayed: true, events: [] };
    }

    if (input.direction === 'debit' && input.amountVnd > account.balanceVnd) {
      throw new InsufficientBalanceError();
    }
    const signed = input.direction === 'credit' ? input.amountVnd : -input.amountVnd;
    const balanceAfterVnd = account.balanceVnd + signed;
    const transaction = await insertManual(tx, {
      companyId: input.companyId,
      kind: 'adjustment',
      amountVnd: signed,
      balanceAfterVnd,
      reason: input.reason,
      note: input.note,
      actorAdminId: input.actorAdminId,
      idempotencyKey: input.idempotencyKey,
    });

    let events: readonly BalanceEvent[] = [];
    if (input.direction === 'credit') {
      await tx
        .update(creditAccounts)
        .set({
          balanceVnd: balanceAfterVnd,
          lastCreditVnd: input.amountVnd,
          ...afterCredit(balanceAfterVnd, input.amountVnd, account),
          updatedAt: new Date(),
        })
        .where(eq(creditAccounts.companyId, input.companyId));
    } else {
      const decision = afterDebit(
        account.balanceVnd,
        balanceAfterVnd,
        account.lastCreditVnd,
        account,
      );
      events = decision.events;
      await tx
        .update(creditAccounts)
        .set({ balanceVnd: balanceAfterVnd, ...decision.flags, updatedAt: new Date() })
        .where(eq(creditAccounts.companyId, input.companyId));
    }
    await input.onWritten?.(tx, transaction);
    return { transaction, replayed: false, events };
  });
}

/**
 * The automatic trial credit, once per company (design D8). Returns false when it was
 * already granted. The partial UNIQUE index is the second guard under concurrency.
 */
export async function grantTrial(database: Db, companyId: string): Promise<boolean> {
  try {
    return await withCompany(database, companyId, async (tx) => {
      const account = await lockAccount(tx, companyId);
      if (account.trialGrantedAt) return false;
      const balanceAfterVnd = account.balanceVnd + TRIAL_AMOUNT_VND;
      await insertManual(tx, {
        companyId,
        kind: 'trial',
        amountVnd: TRIAL_AMOUNT_VND,
        balanceAfterVnd,
        reason: 'trial',
        note: null,
        actorAdminId: null,
        idempotencyKey: null,
      });
      await tx
        .update(creditAccounts)
        .set({
          balanceVnd: balanceAfterVnd,
          lastCreditVnd: TRIAL_AMOUNT_VND,
          trialGrantedAt: new Date(),
          ...afterCredit(balanceAfterVnd, TRIAL_AMOUNT_VND, account),
          updatedAt: new Date(),
        })
        .where(eq(creditAccounts.companyId, companyId));
      return true;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'credit_transactions_one_trial_uq')) return false;
    throw error;
  }
}

type ManualRow = {
  companyId: string;
  kind: 'trial' | 'adjustment';
  amountVnd: number;
  balanceAfterVnd: number;
  reason: CreditReason;
  note: string | null;
  actorAdminId: string | null;
  idempotencyKey: string | null;
};

async function insertManual(tx: CompanyTx, row: ManualRow): Promise<CreditTransactionView> {
  const [inserted] = await tx
    .insert(creditTransactions)
    .values({ ...row, createdAt: afterLock })
    .returning(transactionColumns);
  if (!inserted) throw new Error('credit transaction insert returned no row');
  return inserted;
}

/** Sets or clears the company-specific multiplier (‰). */
export async function setCompanyMultiplier(
  database: Db,
  companyId: string,
  permille: number | null,
  /** Runs in the same transaction (platform audit event). */
  onWritten?: (tx: CompanyTx) => Promise<void>,
): Promise<{ previous: number | null }> {
  if (permille !== null && (!Number.isSafeInteger(permille) || permille < 1000)) {
    throw new RangeError('multiplier must be at least 1');
  }
  return withCompany(database, companyId, async (tx) => {
    const account = await lockAccount(tx, companyId);
    await tx
      .update(creditAccounts)
      .set({ multiplierPermille: permille, updatedAt: sql`now()` })
      .where(eq(creditAccounts.companyId, companyId));
    await onWritten?.(tx);
    return { previous: account.multiplierPermille };
  });
}

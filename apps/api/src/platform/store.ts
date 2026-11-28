import { type CreditState, creditState } from '@dw/billing';
import { type Database, platformAuditEvents } from '@dw/db';

/**
 * Platform-level reads and writes (design D10). The only module allowed to call
 * `app.platform_company_summaries()` (guarded by a test).
 */

export type CompanySummary = {
  readonly id: string;
  readonly name: string;
  readonly ownerEmail: string | null;
  readonly balanceVnd: number;
  readonly charged30dVnd: number;
  readonly state: CreditState;
  readonly multiplierPermille: number | null;
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
};

export type PlatformTotals = {
  readonly companies: number;
  readonly balanceVnd: number;
  readonly charged30dVnd: number;
  /** What the providers cost us in 30 days, rounded down to đồng (platform total only). */
  readonly realCost30dVnd: number;
  readonly exhausted: number;
};

type SummaryRow = {
  company_id: string;
  name: string;
  owner_email: string | null;
  balance_vnd: string;
  last_credit_vnd: string;
  charged_30d_vnd: string;
  real_cost_30d_microvnd: string;
  multiplier_permille: number | null;
  last_used_at: Date | null;
  created_at: Date;
};

export async function companySummaries(
  database: Pick<Database, 'pool'>,
): Promise<{ companies: CompanySummary[]; totals: PlatformTotals }> {
  const { rows } = await database.pool.query<SummaryRow>(
    'select * from app.platform_company_summaries() order by created_at desc',
  );
  const companies = rows.map((row) => {
    const balanceVnd = Number(row.balance_vnd);
    return {
      id: row.company_id,
      name: row.name,
      ownerEmail: row.owner_email,
      balanceVnd,
      charged30dVnd: Number(row.charged_30d_vnd),
      state: creditState(balanceVnd, Number(row.last_credit_vnd)),
      multiplierPermille: row.multiplier_permille,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
    };
  });
  let realMicro = 0n;
  for (const row of rows) realMicro += BigInt(row.real_cost_30d_microvnd);
  return {
    companies,
    totals: {
      companies: companies.length,
      balanceVnd: companies.reduce((sum, c) => sum + c.balanceVnd, 0),
      charged30dVnd: companies.reduce((sum, c) => sum + c.charged30dVnd, 0),
      realCost30dVnd: Number(realMicro / 1_000_000n),
      exhausted: companies.filter((c) => c.state === 'exhausted').length,
    },
  };
}

export type PlatformAuditInput = {
  readonly actorUserId: string;
  readonly action:
    | 'credit.adjusted'
    | 'price.added'
    | 'fx.changed'
    | 'multiplier.changed'
    | 'company_multiplier.set'
    | 'company_multiplier.cleared'
    | 'provider_key.replaced';
  readonly targetType: string;
  readonly targetId?: string | null;
  readonly companyId?: string | null;
  /** Field names only, never values (and never a key). */
  readonly fields?: readonly string[];
};

/** A connection or transaction that can insert (pass the change's transaction). */
type Inserter = Pick<Database['db'], 'insert'>;

export async function recordPlatformAudit(db: Inserter, event: PlatformAuditInput): Promise<void> {
  await db.insert(platformAuditEvents).values({
    actorUserId: event.actorUserId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId ?? null,
    companyId: event.companyId ?? null,
    fields: event.fields ? [...event.fields] : null,
  });
}

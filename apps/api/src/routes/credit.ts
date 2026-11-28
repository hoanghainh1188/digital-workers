import { creditHistory, creditOverview, usageCalls } from '@dw/billing';
import { type Database, withCompany } from '@dw/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from '../plugins/zod.ts';
import { companyContext, type Guards } from '../tenancy/index.ts';

export type CreditRouteDeps = {
  readonly database: Database;
  readonly guards: Guards;
  readonly now?: () => Date;
};

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const day = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  // Calendar check: 2026-02-31 matches the pattern but is not a day.
  .refine(
    (value) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
    },
    {
      message: 'invalid_date',
    },
  );

const overviewResponse = z.strictObject({
  balanceVnd: z.number().int(),
  state: z.enum(['normal', 'low', 'exhausted']),
  thresholdVnd: z.number().int(),
  month: z.strictObject({ usedVnd: z.number().int(), calls: z.number().int() }),
  estimatedDays: z.number().int().nullable(),
  trial: z.enum(['granted', 'pending_verification', 'none']),
});

const creditEntry = z.strictObject({
  type: z.literal('credit'),
  id: z.uuid(),
  kind: z.enum(['trial', 'adjustment']),
  amountVnd: z.number().int(),
  balanceAfterVnd: z.number().int(),
  reason: z.enum(['bank_transfer', 'trial', 'system_fix', 'other']).nullable(),
  note: z.string().nullable(),
  at: z.string(),
});
const usageEntry = z.strictObject({
  type: z.literal('usage'),
  workerId: z.uuid().nullable(),
  workerName: z.string().nullable(),
  date: z.string(),
  amountVnd: z.number().int(),
  calls: z.number().int(),
  balanceAfterVnd: z.number().int(),
  at: z.string(),
});
const historyResponse = z.strictObject({
  entries: z.array(z.discriminatedUnion('type', [creditEntry, usageEntry])),
});
const usageResponse = z.strictObject({
  calls: z.array(
    z.strictObject({
      id: z.uuid(),
      at: z.string(),
      tokens: z.number().int(),
      amountVnd: z.number().int(),
    }),
  ),
});

/** Vietnam-time "YYYY-MM" of `at`. */
function currentMonth(at: Date): string {
  return new Date(at.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

/**
 * The company's credit (spec credit-ledger, design D11): Owner and Admin only
 * (`credit.view`). Amounts are what the company pays; real cost and multiplier
 * never leave the server (#074). The company is always the session's.
 */
export function registerCreditRoutes(app: FastifyInstance, deps: CreditRouteDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const { guards, database } = deps;
  const now = deps.now ?? (() => new Date());

  routes.get(
    '/api/credit',
    {
      preHandler: guards.requirePermission('credit.view'),
      schema: { response: { 200: overviewResponse } },
    },
    async (request) => {
      const { member } = companyContext(request);
      return withCompany(database, member.companyId, (tx) => creditOverview(tx, now()));
    },
  );

  routes.get(
    '/api/credit/transactions',
    {
      preHandler: guards.requirePermission('credit.view'),
      schema: {
        querystring: z.object({
          month: month.optional(),
          type: z.enum(['all', 'credit', 'usage']).default('all'),
        }),
        response: { 200: historyResponse },
      },
    },
    async (request) => {
      const { member } = companyContext(request);
      const { month: wanted, type } = request.query;
      const entries = await withCompany(database, member.companyId, (tx) =>
        creditHistory(tx, wanted ?? currentMonth(now()), type),
      );
      return { entries: entries.map((entry) => ({ ...entry, at: entry.at.toISOString() })) };
    },
  );

  // workerId omitted = calls without a worker. A worker id of another company is
  // simply invisible under RLS: the list is empty (spec "Lịch sử công ty khác").
  routes.get(
    '/api/credit/usage',
    {
      preHandler: guards.requirePermission('credit.view'),
      schema: {
        querystring: z.object({ date: day, workerId: z.uuid().optional() }),
        response: { 200: usageResponse },
      },
    },
    async (request) => {
      const { member } = companyContext(request);
      const { date, workerId } = request.query;
      const calls = await withCompany(database, member.companyId, (tx) =>
        usageCalls(tx, date, workerId ?? null),
      );
      return { calls: calls.map((call) => ({ ...call, at: call.at.toISOString() })) };
    },
  );
}

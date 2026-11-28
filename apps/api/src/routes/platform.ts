import {
  adjustCredit,
  dispatchBalanceEvents,
  effectiveDefaultMultiplier,
  effectiveFxRate,
  IdempotencyConflictError,
  InsufficientBalanceError,
  MAX_ADJUSTMENT_VND,
  type Notifier,
  PROVIDERS,
  setCompanyMultiplier,
} from '@dw/billing';
import { describeError } from '@dw/core';
import {
  type Database,
  fxRates,
  isUniqueViolation,
  modelPrices,
  priceMultipliers,
  withCompany,
} from '@dw/db';
import { asc, desc } from '@dw/db/drizzle';
import type { KeyCheck, ProviderKeyStore } from '@dw/llm';
import type { FastifyInstance, onRequestAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { platformAdmin } from '../platform/guard.ts';
import { companySummaries, recordPlatformAudit } from '../platform/store.ts';
import type { ZodTypeProvider } from '../plugins/zod.ts';
import { readCompany } from '../tenancy/companies.ts';
import { NOT_FOUND_BODY, sendError } from '../tenancy/errors.ts';

export type PlatformRouteDeps = {
  readonly database: Database;
  readonly platformGuard: onRequestAsyncHookHandler;
  readonly keys: Pick<ProviderKeyStore, 'save' | 'status'>;
  readonly verifyKey: (provider: (typeof PROVIDERS)[number], apiKey: string) => Promise<KeyCheck>;
  readonly notifier: Notifier;
  readonly now?: () => Date;
};

/** A full bank account number is 9+ digits: never in a note (NFR-03, platform-admin.html). */
const ACCOUNT_NUMBER = /\d{9,}/;
/** Effective dates a little in the past are clock skew, not back-dating. */
const SKEW_MS = 60_000;

const provider = z.enum(PROVIDERS);
const companyParams = z.object({ id: z.uuid() });
const microUsd = z.number().int().min(0).max(1_000_000_000_000);

const adjustmentBody = z.strictObject({
  direction: z.enum(['credit', 'debit']),
  amountVnd: z.number().int().min(1).max(MAX_ADJUSTMENT_VND),
  reason: z.enum(['bank_transfer', 'trial', 'system_fix', 'other']),
  note: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((note) => !ACCOUNT_NUMBER.test(note), { message: 'note_account_number' }),
});

const priceBody = z.strictObject({
  provider,
  model: z.string().trim().min(1).max(100),
  inputUsdMicrosPerMtok: microUsd,
  outputUsdMicrosPerMtok: microUsd,
  cacheReadUsdMicrosPerMtok: microUsd,
  cacheWriteUsdMicrosPerMtok: microUsd.nullable(),
  /** Omitted = now. Never in the past (spec model-pricing). */
  effectiveFrom: z.iso.datetime({ offset: true }).optional(),
});

const companyView = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  ownerEmail: z.string().nullable(),
  balanceVnd: z.number().int(),
  charged30dVnd: z.number().int(),
  state: z.enum(['normal', 'low', 'exhausted']),
  multiplierPermille: z.number().int().nullable(),
  lastUsedAt: z.string().nullable(),
});

const transactionView = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['usage', 'trial', 'adjustment']),
  amountVnd: z.number().int(),
  balanceAfterVnd: z.number().int(),
  reason: z.enum(['bank_transfer', 'trial', 'system_fix', 'other']).nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

const keyStatusView = z.strictObject({
  provider,
  configured: z.boolean(),
  updatedAt: z.string().nullable(),
  lastOkAt: z.string().nullable(),
});

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/**
 * Platform admin API (spec platform-admin, design D10). Every route sits behind the
 * `onRequest` platform guard, so outsiders get 404 before any validation. Every
 * change writes one platform audit event (field names only, never a key).
 */
export function registerPlatformRoutes(app: FastifyInstance, deps: PlatformRouteDeps): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const { database } = deps;
  const now = deps.now ?? (() => new Date());
  const onRequest = deps.platformGuard;
  app.decorateRequest('platformAdmin', null);

  async function companyExists(id: string): Promise<boolean> {
    return (await withCompany(database, id, readCompany)) !== null;
  }

  routes.get(
    '/api/platform/companies',
    {
      onRequest,
      schema: {
        querystring: z.object({
          state: z.enum(['all', 'normal', 'low', 'exhausted']).default('all'),
          q: z.string().trim().max(100).optional(),
        }),
        response: {
          200: z.strictObject({
            companies: z.array(companyView),
            totals: z.strictObject({
              companies: z.number().int(),
              balanceVnd: z.number().int(),
              charged30dVnd: z.number().int(),
              realCost30dVnd: z.number().int(),
              exhausted: z.number().int(),
            }),
          }),
        },
      },
    },
    async (request) => {
      const { state, q } = request.query;
      const { companies, totals } = await companySummaries(database);
      const needle = q?.toLocaleLowerCase('vi');
      return {
        totals,
        companies: companies
          .filter((c) => state === 'all' || c.state === state)
          .filter((c) => !needle || c.name.toLocaleLowerCase('vi').includes(needle))
          .map(({ createdAt: _createdAt, lastUsedAt, ...c }) => ({
            ...c,
            lastUsedAt: iso(lastUsedAt),
          })),
      };
    },
  );

  routes.post(
    '/api/platform/companies/:id/credit-adjustments',
    {
      onRequest,
      schema: {
        params: companyParams,
        headers: z.object({ 'idempotency-key': z.uuid() }),
        body: adjustmentBody,
      },
    },
    async (request, reply) => {
      const admin = platformAdmin(request);
      const { id } = request.params;
      if (!(await companyExists(id))) return reply.status(404).send(NOT_FOUND_BODY);
      try {
        const result = await adjustCredit(database, {
          companyId: id,
          ...request.body,
          actorAdminId: admin.userId,
          idempotencyKey: request.headers['idempotency-key'],
          // Same transaction: the adjustment and its audit event commit together.
          onWritten: (tx, transaction) =>
            recordPlatformAudit(tx, {
              actorUserId: admin.userId,
              action: 'credit.adjusted',
              targetType: 'credit_transaction',
              targetId: transaction.id,
              companyId: id,
              fields: ['direction', 'amount_vnd', 'reason', 'note'],
            }),
        });
        const view: z.output<typeof transactionView> = {
          ...result.transaction,
          createdAt: result.transaction.createdAt.toISOString(),
        };
        if (result.replayed) return reply.status(200).send(view);
        dispatchBalanceEvents(deps.notifier, id, result.events, (error) =>
          request.log.error({ error: describeError(error) }, 'credit notification failed'),
        );
        return reply.status(201).send(view);
      } catch (error) {
        if (error instanceof IdempotencyConflictError) {
          return sendError(
            reply,
            409,
            'IDEMPOTENCY_CONFLICT',
            'Key already used for another request',
          );
        }
        if (error instanceof InsufficientBalanceError) {
          return sendError(reply, 422, 'INSUFFICIENT_BALANCE', 'Debit exceeds the balance');
        }
        throw error;
      }
    },
  );

  routes.put(
    '/api/platform/companies/:id/multiplier',
    {
      onRequest,
      schema: {
        params: companyParams,
        body: z.strictObject({ permille: z.number().int().min(1000).max(10_000) }),
      },
    },
    async (request, reply) => {
      const admin = platformAdmin(request);
      const { id } = request.params;
      if (!(await companyExists(id))) return reply.status(404).send(NOT_FOUND_BODY);
      await setCompanyMultiplier(database, id, request.body.permille, (tx) =>
        recordPlatformAudit(tx, {
          actorUserId: admin.userId,
          action: 'company_multiplier.set',
          targetType: 'company',
          targetId: id,
          companyId: id,
          fields: ['multiplier_permille'],
        }),
      );
      return reply.status(200).send({ permille: request.body.permille });
    },
  );

  routes.delete(
    '/api/platform/companies/:id/multiplier',
    { onRequest, schema: { params: companyParams } },
    async (request, reply) => {
      const admin = platformAdmin(request);
      const { id } = request.params;
      if (!(await companyExists(id))) return reply.status(404).send(NOT_FOUND_BODY);
      await setCompanyMultiplier(database, id, null, (tx) =>
        recordPlatformAudit(tx, {
          actorUserId: admin.userId,
          action: 'company_multiplier.cleared',
          targetType: 'company',
          targetId: id,
          companyId: id,
          fields: ['multiplier_permille'],
        }),
      );
      return reply.status(204).send();
    },
  );

  routes.get('/api/platform/model-prices', { onRequest }, async () => {
    const at = now();
    const rows = await database.db
      .select()
      .from(modelPrices)
      .orderBy(asc(modelPrices.provider), asc(modelPrices.model), desc(modelPrices.effectiveFrom));
    // The row in effect per model = its latest effectiveFrom ≤ now (rows are sorted).
    const current = new Set<string>();
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.provider}/${row.model}`;
      if (!seen.has(key) && row.effectiveFrom <= at) {
        seen.add(key);
        current.add(row.id);
      }
    }
    return {
      fxRate: await effectiveFxRate(database.db, at),
      defaultMultiplierPermille: await effectiveDefaultMultiplier(database.db, at),
      prices: rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        model: row.model,
        inputUsdMicrosPerMtok: row.inputUsdMicrosPerMtok,
        outputUsdMicrosPerMtok: row.outputUsdMicrosPerMtok,
        cacheReadUsdMicrosPerMtok: row.cacheReadUsdMicrosPerMtok,
        cacheWriteUsdMicrosPerMtok: row.cacheWriteUsdMicrosPerMtok,
        effectiveFrom: row.effectiveFrom.toISOString(),
        status: current.has(row.id)
          ? 'current'
          : row.effectiveFrom > at
            ? 'scheduled'
            : 'superseded',
      })),
    };
  });

  routes.post(
    '/api/platform/model-prices',
    { onRequest, schema: { body: priceBody } },
    async (request, reply) => {
      const admin = platformAdmin(request);
      const at = now();
      const effectiveFrom = request.body.effectiveFrom ? new Date(request.body.effectiveFrom) : at;
      if (effectiveFrom.getTime() < at.getTime() - SKEW_MS) {
        return sendError(reply, 400, 'EFFECTIVE_IN_PAST', 'Effective date cannot be in the past');
      }
      try {
        const row = await database.db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(modelPrices)
            .values({ ...request.body, effectiveFrom, createdBy: admin.userId })
            .returning({ id: modelPrices.id });
          await recordPlatformAudit(tx, {
            actorUserId: admin.userId,
            action: 'price.added',
            targetType: 'model_price',
            targetId: inserted?.id ?? null,
            fields: ['provider', 'model', 'prices', 'effective_from'],
          });
          return inserted;
        });
        return reply.status(201).send({ id: row?.id });
      } catch (error) {
        if (isUniqueViolation(error, 'model_prices_model_effective_unique')) {
          return sendError(reply, 409, 'PRICE_EXISTS', 'A price already starts at that time');
        }
        throw error;
      }
    },
  );

  routes.post(
    '/api/platform/fx-rates',
    {
      onRequest,
      schema: { body: z.strictObject({ vndPerUsd: z.number().int().min(1).max(1_000_000) }) },
    },
    async (request, reply) => {
      const admin = platformAdmin(request);
      await database.db.transaction(async (tx) => {
        await tx.insert(fxRates).values({
          vndPerUsd: request.body.vndPerUsd,
          effectiveFrom: now(),
          createdBy: admin.userId,
        });
        await recordPlatformAudit(tx, {
          actorUserId: admin.userId,
          action: 'fx.changed',
          targetType: 'fx_rate',
          fields: ['vnd_per_usd'],
        });
      });
      return reply.status(201).send({ vndPerUsd: request.body.vndPerUsd });
    },
  );

  routes.post(
    '/api/platform/multipliers',
    {
      onRequest,
      schema: { body: z.strictObject({ permille: z.number().int().min(1000).max(10_000) }) },
    },
    async (request, reply) => {
      const admin = platformAdmin(request);
      await database.db.transaction(async (tx) => {
        await tx.insert(priceMultipliers).values({
          permille: request.body.permille,
          effectiveFrom: now(),
          createdBy: admin.userId,
        });
        await recordPlatformAudit(tx, {
          actorUserId: admin.userId,
          action: 'multiplier.changed',
          targetType: 'price_multiplier',
          fields: ['permille'],
        });
      });
      return reply.status(201).send({ permille: request.body.permille });
    },
  );

  routes.get(
    '/api/platform/provider-keys',
    {
      onRequest,
      schema: { response: { 200: z.strictObject({ keys: z.array(keyStatusView) }) } },
    },
    async () => {
      const status = await deps.keys.status();
      return {
        keys: status.map((item) => ({
          provider: item.provider,
          configured: item.configured,
          updatedAt: iso(item.updatedAt),
          lastOkAt: iso(item.lastOkAt),
        })),
      };
    },
  );

  routes.put(
    '/api/platform/provider-keys/:provider',
    {
      onRequest,
      schema: {
        params: z.object({ provider }),
        body: z.strictObject({ apiKey: z.string().trim().min(10).max(500) }),
        response: { 200: keyStatusView },
      },
    },
    async (request, reply) => {
      const admin = platformAdmin(request);
      const { provider: name } = request.params;
      let check: KeyCheck;
      try {
        check = await deps.verifyKey(name, request.body.apiKey);
      } catch {
        return sendError(reply, 502, 'PROVIDER_UNREACHABLE', 'Could not reach the provider');
      }
      if (check === 'invalid') {
        return sendError(reply, 400, 'INVALID_KEY', 'The provider rejected this key');
      }
      await deps.keys.save(name, request.body.apiKey, admin.userId, (tx) =>
        recordPlatformAudit(tx, {
          actorUserId: admin.userId,
          action: 'provider_key.replaced',
          targetType: 'provider_key',
          targetId: name,
          fields: ['api_key'],
        }),
      );
      const saved = (await deps.keys.status()).find((item) => item.provider === name);
      return {
        provider: name,
        configured: saved?.configured ?? true,
        updatedAt: iso(saved?.updatedAt ?? null),
        lastOkAt: iso(saved?.lastOkAt ?? null),
      };
    },
  );
}

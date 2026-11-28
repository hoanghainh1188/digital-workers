import type { Notifier } from '@dw/billing';
import { describeError } from '@dw/core';
import { type Database, memberProfiles, withCompany } from '@dw/db';
import { and, eq, inArray } from '@dw/db/drizzle';
import { exhaustedCreditTemplate, lowCreditTemplate, type Mailer } from '@dw/mail';
import type { FastifyBaseLogger } from 'fastify';
import { readCompany } from '../tenancy/companies.ts';

type Role = 'owner' | 'admin' | 'manager' | 'member';

/**
 * Email version of the billing Notifier (design D9). Recipients are read inside the
 * company (RLS): "low" → active Owners; "exhausted" → active Owners, Admins and
 * Trưởng phòng (0.2 #101). Each email is sent separately; a failure is logged
 * without the address.
 */
export function emailNotifier(deps: {
  database: Database;
  mailer: Mailer;
  webOrigin: string;
  logger: FastifyBaseLogger;
}): Notifier {
  const { database, mailer, logger } = deps;
  const url = `${deps.webOrigin}/credit`;

  async function recipients(companyId: string, roles: readonly Role[]) {
    return withCompany(database, companyId, async (tx) => ({
      company: await readCompany(tx),
      people: await tx
        .select({ name: memberProfiles.name, email: memberProfiles.email })
        .from(memberProfiles)
        .where(and(inArray(memberProfiles.role, [...roles]), eq(memberProfiles.status, 'active'))),
    }));
  }

  async function sendAll(
    people: ReadonlyArray<{ name: string; email: string }>,
    render: (name: string) => ReturnType<typeof lowCreditTemplate>,
  ) {
    await Promise.all(
      people.map((person) =>
        mailer
          .send({ to: person.email, ...render(person.name) })
          .catch((error: unknown) =>
            logger.error({ error: describeError(error) }, 'credit email failed'),
          ),
      ),
    );
  }

  return {
    async lowBalance(companyId, balanceVnd, thresholdVnd) {
      const { company, people } = await recipients(companyId, ['owner']);
      if (!company) return;
      await sendAll(people, (name) =>
        lowCreditTemplate({ name, companyName: company.name, balanceVnd, thresholdVnd, url }),
      );
    },
    async exhausted(companyId) {
      const { company, people } = await recipients(companyId, ['owner', 'admin', 'manager']);
      if (!company) return;
      await sendAll(people, (name) =>
        exhaustedCreditTemplate({ name, companyName: company.name, url }),
      );
    },
  };
}

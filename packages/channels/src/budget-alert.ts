import { type Database, memberProfiles, withCompany, workerBudgetAlerts } from '@dw/db';
import { eq } from '@dw/db/drizzle';
import { type Mailer, workerBudgetExhaustedTemplate } from '@dw/mail';
import { type IntakeWorker, vnMonthKey } from './intake.ts';

export interface AlertLogger {
  readonly warn: (details: object, message: string) => void;
  readonly error: (details: object, message: string) => void;
}

/**
 * "Hết ngân sách" email to the worker's manager, at most once per worker per Vietnam
 * calendar month (0.2 #129): the `worker_budget_alerts` row is the memory. A worker with
 * no (active) manager gets no email, only a log line without names or addresses.
 */
export function createBudgetAlerter(deps: {
  readonly database: Pick<Database, 'db'>;
  readonly mailer: Pick<Mailer, 'send'>;
  readonly webOrigin: string;
  readonly logger: AlertLogger;
  readonly now?: () => Date;
}): (companyId: string, worker: IntakeWorker) => Promise<void> {
  const now = deps.now ?? (() => new Date());
  return async (companyId, worker) => {
    const month = vnMonthKey(now());
    const recipient = await withCompany(deps.database, companyId, async (tx) => {
      const inserted = await tx
        .insert(workerBudgetAlerts)
        .values({ companyId, workerId: worker.id, month })
        .onConflictDoNothing()
        .returning({ month: workerBudgetAlerts.month });
      if (inserted.length === 0) return 'already' as const;
      if (!worker.managerMemberId) return null;
      const [manager] = await tx
        .select({
          name: memberProfiles.name,
          email: memberProfiles.email,
          status: memberProfiles.status,
        })
        .from(memberProfiles)
        .where(eq(memberProfiles.id, worker.managerMemberId));
      return manager?.status === 'active' ? manager : null;
    });
    if (recipient === 'already') return;
    if (!recipient) {
      deps.logger.warn({ companyId, workerId: worker.id }, 'budget alert skipped: no manager');
      return;
    }
    await deps.mailer
      .send({
        to: recipient.email,
        ...workerBudgetExhaustedTemplate({
          name: recipient.name,
          workerName: worker.name,
          budgetVnd: worker.monthlyBudgetVnd,
          url: `${deps.webOrigin}/workers/${worker.id}`,
        }),
      })
      .catch((error: unknown) =>
        deps.logger.error(
          {
            companyId,
            workerId: worker.id,
            error: error instanceof Error ? error.name : 'unknown',
          },
          'budget alert email failed',
        ),
      );
  };
}

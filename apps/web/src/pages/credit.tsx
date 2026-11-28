import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { BellRing } from 'lucide-react';
import type { SignedInMe } from '@/components/app/app-shell';
import { PageHeader } from '@/components/app/page-header';
import { BalanceCard, balanceLook } from '@/components/credit/balance-card';
import { CreditHistory } from '@/components/credit/history';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Select } from '@/components/ui/field';
import { t, tf } from '@/i18n/t';
import {
  creditHistoryQuery,
  creditOverviewQuery,
  type HistoryFilter,
  monthLabel,
  recentMonths,
} from '@/lib/credit';
import { formatVnd } from '@/lib/money';

export type CreditSearch = { month?: string; type?: HistoryFilter };

const card = 'rounded-[calc(var(--radius)+4px)] border bg-card shadow-[var(--shadow-card)]';
const VND = new Intl.NumberFormat('vi-VN');

/** Credit page for Owner and Admin (spec credit-ledger, docs/design/screens/credit.html). */
export function CreditPage({ me, search }: { me: SignedInMe; search: CreditSearch }) {
  const navigate = useNavigate();
  const months = recentMonths();
  const month = search.month ?? months[0] ?? '';
  const type = search.type ?? 'all';
  const overview = useQuery(creditOverviewQuery);
  const history = useQuery(creditHistoryQuery(month, type));
  const isOwner = me.member.role === 'owner';

  const setSearch = (next: CreditSearch) =>
    navigate({ to: '/credit', search: { ...search, ...next }, replace: true });

  if (overview.isError || history.isError) {
    return (
      <Callout tone="danger" role="alert">
        {t('app.error.generic')}
      </Callout>
    );
  }

  const data = overview.data;
  const look = data ? balanceLook(data) : null;
  const fresh = look === 'new' || look === 'unverified';

  return (
    <>
      <PageHeader eyebrow={t('credit.eyebrow')} title={t('credit.title')} lead={t('credit.lead')} />
      {data ? (
        <section
          aria-label={t('credit.overview')}
          className="mb-4 grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-4 max-[960px]:grid-cols-[minmax(0,1fr)]"
        >
          <BalanceCard overview={data} isOwner={isOwner} />
          {fresh ? (
            <section
              aria-labelledby="start-title"
              className={`${card} grid content-start gap-3.5 p-5`}
            >
              <h2 id="start-title" className="font-semibold">
                {t('credit.start.title')}
              </h2>
              <p className="text-sm text-muted-foreground">{t('credit.start.body')}</p>
              <Button asChild variant="outline" className="justify-self-start">
                <Link to="/workers">{t('credit.start.cta')}</Link>
              </Button>
            </section>
          ) : (
            <section
              aria-labelledby="month-title"
              className={`${card} grid content-start gap-3.5 p-5`}
            >
              <h2 id="month-title" className="font-semibold">
                {tf('credit.month.title', { month: Number(months[0]?.slice(5) ?? '') })}
              </h2>
              <p className="text-xl font-bold tabular-nums">
                {formatVnd(data.month.usedVnd)}{' '}
                <small className="text-sm font-medium text-muted-foreground">
                  · {tf('credit.month.calls', { count: VND.format(data.month.calls) })}
                </small>
              </p>
              <p className="text-sm text-muted-foreground">
                {t('credit.month.workers')}{' '}
                <span className="rounded bg-muted px-1.5 py-0.5 text-[0.625rem] font-bold tracking-wider uppercase">
                  {t('credit.soon')}
                </span>
              </p>
            </section>
          )}
        </section>
      ) : null}

      {data && !fresh ? (
        <div className={`${card} mb-4 flex items-center gap-2.5 px-5 py-3.5 text-sm`}>
          <BellRing aria-hidden="true" className="size-4.5 shrink-0 text-muted-foreground" />
          <span>{tf('credit.threshold', { threshold: formatVnd(data.thresholdVnd) })}</span>
        </div>
      ) : null}

      <section aria-labelledby="ledger-title" className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-2.5 border-b px-4 py-3.5">
          <h2 id="ledger-title" className="mr-auto font-semibold">
            {t('credit.history.title')}
          </h2>
          <Select
            aria-label={t('credit.history.month')}
            className="h-9.5 w-auto text-sm"
            value={month}
            onChange={(event) => setSearch({ month: event.target.value })}
          >
            {months.map((value) => (
              <option key={value} value={value}>
                {tf('credit.history.monthOption', { month: monthLabel(value) })}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('credit.history.type')}
            className="h-9.5 w-auto text-sm"
            value={type}
            onChange={(event) => setSearch({ type: event.target.value as HistoryFilter })}
          >
            <option value="all">{t('credit.history.type.all')}</option>
            <option value="credit">{t('credit.history.type.credit')}</option>
            <option value="usage">{t('credit.history.type.usage')}</option>
          </Select>
          {isOwner ? (
            <Button type="button" variant="outline" disabled className="h-9.5">
              {t('credit.history.statement')}
              <span className="rounded bg-muted px-1.5 py-0.5 text-[0.625rem] font-bold tracking-wider uppercase">
                {t('credit.soon')}
              </span>
            </Button>
          ) : null}
        </div>
        {history.data ? <CreditHistory entries={history.data.entries} /> : null}
      </section>
    </>
  );
}

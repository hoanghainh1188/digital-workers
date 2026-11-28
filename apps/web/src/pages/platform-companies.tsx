import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/app/page-header';
import { AdjustCreditDialog } from '@/components/platform/adjust-dialog';
import { PlatformError, platformCard } from '@/components/platform/platform-shell';
import { CompanyMultiplierDialog } from '@/components/platform/rate-dialogs';
import { Avatar } from '@/components/ui/avatar';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Input, Select } from '@/components/ui/field';
import { t, tf } from '@/i18n/t';
import { formatPermille, formatVnd } from '@/lib/money';
import { type CompanyFilter, type CompanySummary, companiesQuery } from '@/lib/platform';
import { cn } from '@/lib/utils';

export type CompaniesSearch = { state?: CompanyFilter; q?: string };

const head = 'border-b px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground';
const cell = 'border-b px-4 py-3 align-middle';
const rtf = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });

function relative(iso: string, now = Date.now()): string {
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}

/** Platform admin: per-company credit totals only (spec "Chỉ xem tổng theo công ty"). */
export function PlatformCompaniesPage({ search }: { search: CompaniesSearch }) {
  const navigate = useNavigate();
  const state = search.state ?? 'all';
  const [text, setText] = useState(search.q ?? '');
  const list = useQuery(companiesQuery(state, search.q ?? ''));
  const [adjusting, setAdjusting] = useState<CompanySummary | null>(null);
  const [multiplier, setMultiplier] = useState<CompanySummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The search box writes to the URL after a short pause (filters live in the URL).
  useEffect(() => {
    const handle = setTimeout(() => {
      const q = text.trim() || undefined;
      if (q !== search.q)
        void navigate({ to: '/platform/companies', search: { ...search, q }, replace: true });
    }, 300);
    return () => clearTimeout(handle);
  }, [text, search, navigate]);

  const totals = list.data?.totals;
  return (
    <>
      <PageHeader
        eyebrow={t('platform.companies.eyebrow')}
        title={t('platform.companies.title')}
        lead={t('platform.companies.lead')}
      />
      {list.isError ? <PlatformError error={list.error} /> : null}
      {notice ? (
        <Callout tone="info" role="status" className="mb-4">
          {notice}
        </Callout>
      ) : null}
      {totals ? (
        <section
          aria-label={t('platform.stats')}
          className="mb-4 grid grid-cols-4 gap-3 max-[1000px]:grid-cols-2 max-[520px]:grid-cols-1"
        >
          <Stat
            label={t('platform.stats.companies')}
            value={String(totals.companies)}
            sub={t('platform.stats.companiesSub')}
          />
          <Stat
            label={t('platform.stats.balance')}
            value={formatVnd(totals.balanceVnd)}
            sub={t('platform.stats.balanceSub')}
          />
          <Stat
            label={t('platform.stats.charged')}
            value={formatVnd(totals.charged30dVnd)}
            sub={tf('platform.stats.chargedSub', { real: formatVnd(totals.realCost30dVnd) })}
          />
          <Stat
            label={t('platform.stats.attention')}
            value={String(totals.exhausted)}
            sub={t('platform.stats.attentionSub')}
            alert={totals.exhausted > 0}
          />
        </section>
      ) : null}
      <section aria-labelledby="co-title" className={`${platformCard} overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-2.5 border-b px-4 py-3.5">
          <h2 id="co-title" className="mr-auto font-semibold">
            {t('platform.companies.list')}
          </h2>
          <div className="relative max-[720px]:w-full">
            <Search
              aria-hidden="true"
              className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label={t('platform.companies.search')}
              type="search"
              className="h-9.5 w-64 pl-9 max-[720px]:w-full"
              placeholder={t('platform.companies.search')}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <Select
            aria-label={t('platform.companies.filter')}
            className="h-9.5 w-auto text-sm"
            value={state}
            onChange={(event) =>
              navigate({
                to: '/platform/companies',
                search: { ...search, state: event.target.value as CompanyFilter },
                replace: true,
              })
            }
          >
            <option value="all">{t('platform.companies.filter.all')}</option>
            <option value="exhausted">{t('platform.companies.filter.exhausted')}</option>
            <option value="low">{t('platform.companies.filter.low')}</option>
            <option value="normal">{t('platform.companies.filter.normal')}</option>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-canvas">
              <tr>
                <th scope="col" className={head}>
                  {t('platform.companies.col.company')}
                </th>
                <th scope="col" className={`${head} text-right`}>
                  {t('platform.companies.col.balance')}
                </th>
                <th scope="col" className={`${head} text-right max-[720px]:hidden`}>
                  {t('platform.companies.col.charged')}
                </th>
                <th scope="col" className={`${head} max-[720px]:hidden`}>
                  {t('platform.companies.col.activity')}
                </th>
                <th scope="col" className={head}>
                  <span className="sr-only">{t('platform.companies.col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(list.data?.companies ?? []).map((company) => (
                <CompanyRow
                  key={company.id}
                  company={company}
                  onAdjust={() => {
                    setNotice(null);
                    setAdjusting(company);
                  }}
                  onMultiplier={() => setMultiplier(company)}
                />
              ))}
            </tbody>
          </table>
          {list.data && list.data.companies.length === 0 ? (
            <p className="px-4 py-10 text-center text-muted-foreground">
              {t('platform.companies.empty')}
            </p>
          ) : null}
        </div>
      </section>
      {adjusting ? (
        <AdjustCreditDialog
          company={adjusting}
          onClose={() => setAdjusting(null)}
          onDone={(message) => {
            setAdjusting(null);
            setNotice(message);
          }}
        />
      ) : null}
      {multiplier ? (
        <CompanyMultiplierDialog company={multiplier} onClose={() => setMultiplier(null)} />
      ) : null}
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  alert = false,
}: {
  label: string;
  value: string;
  sub: string;
  alert?: boolean;
}) {
  return (
    <div className={`${platformCard} grid gap-1 px-4.5 py-4`}>
      <small className="text-xs font-medium text-muted-foreground">{label}</small>
      <b
        className={cn(
          'text-xl font-bold tracking-[-0.01em] tabular-nums',
          alert && 'text-destructive-ink',
        )}
      >
        {value}
      </b>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  );
}

function CompanyRow({
  company,
  onAdjust,
  onMultiplier,
}: {
  company: CompanySummary;
  onAdjust: () => void;
  onMultiplier: () => void;
}) {
  const balance = formatVnd(company.balanceVnd);
  return (
    <tr>
      <td className={cell}>
        <div className="flex min-w-[13rem] items-center gap-3">
          <Avatar name={company.name} seed={company.id} />
          <div className="min-w-0">
            <b className="block font-semibold">{company.name}</b>
            <small className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <span className="break-all">
                {company.ownerEmail ?? t('platform.companies.noOwner')}
              </span>
              {company.multiplierPermille === null ? null : (
                <span className="rounded bg-muted px-1.5 py-0.5 font-semibold">
                  {tf('platform.companies.multiplier', {
                    value: formatPermille(company.multiplierPermille),
                  })}
                </span>
              )}
            </small>
          </div>
        </div>
      </td>
      <td className={`${cell} text-right whitespace-nowrap tabular-nums`}>
        {company.state === 'exhausted' ? (
          <StatusBadge tone="danger">{balance}</StatusBadge>
        ) : company.state === 'low' ? (
          <StatusBadge tone="warning">{balance}</StatusBadge>
        ) : (
          balance
        )}
      </td>
      <td className={`${cell} text-right whitespace-nowrap tabular-nums max-[720px]:hidden`}>
        {formatVnd(company.charged30dVnd)}
      </td>
      <td className={`${cell} text-muted-foreground max-[720px]:hidden`}>
        {company.lastUsedAt
          ? tf('platform.companies.lastUsed', { when: relative(company.lastUsedAt) })
          : t('platform.companies.neverUsed')}
      </td>
      <td className={cell}>
        <div className="flex justify-end gap-1.5">
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-2.5 text-xs"
            onClick={onMultiplier}
          >
            {t('platform.companies.setMultiplier')}
          </Button>
          <Button type="button" variant="outline" className="h-8 px-3 text-xs" onClick={onAdjust}>
            {t('platform.companies.adjust')}
          </Button>
        </div>
      </td>
    </tr>
  );
}

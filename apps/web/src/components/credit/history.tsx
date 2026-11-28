import { useQuery } from '@tanstack/react-query';
import { Gift, Minus, Plus, Table2 } from 'lucide-react';
import { Fragment, useState } from 'react';
import { initials } from '@/components/ui/avatar';
import { t, tf } from '@/i18n/t';
import { dayLabel, type HistoryEntry, usageCallsQuery, vnDate, vnTime } from '@/lib/credit';
import { formatSignedVnd, formatVnd } from '@/lib/money';
import { cn } from '@/lib/utils';

const cell = 'border-b px-4 py-3 align-middle';
const amountCell = `${cell} text-right whitespace-nowrap tabular-nums`;
const afterCell = `${amountCell} text-muted-foreground max-[720px]:hidden`;
const VND = new Intl.NumberFormat('vi-VN');

type Row = { key: string; day: string; entry: HistoryEntry };

/** Entries grouped by Vietnam day, newest first (they already arrive sorted). */
function byDay(entries: readonly HistoryEntry[]): Array<{ day: string; rows: Row[] }> {
  const groups: Array<{ day: string; rows: Row[] }> = [];
  for (const entry of entries) {
    const day = entry.type === 'usage' ? entry.date : vnDate(entry.at);
    const key = entry.type === 'usage' ? `u-${entry.workerId ?? 'none'}-${entry.date}` : entry.id;
    const last = groups.at(-1);
    if (last?.day === day) last.rows.push({ key, day, entry });
    else groups.push({ day, rows: [{ key, day, entry }] });
  }
  return groups;
}

export function CreditHistory({ entries }: { entries: readonly HistoryEntry[] }) {
  const today = vnDate(new Date().toISOString());
  if (entries.length === 0) {
    return (
      <div className="grid justify-items-center gap-2.5 px-6 py-12 text-center text-muted-foreground">
        <Table2 aria-hidden="true" className="size-10 text-border-strong" />
        <b className="text-lg text-foreground">{t('credit.history.empty.title')}</b>
        <span>{t('credit.history.empty.body')}</span>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-canvas text-left text-xs font-semibold text-muted-foreground">
          <tr>
            <th scope="col" className="border-b px-4 py-2.5">
              {t('credit.history.col.tx')}
            </th>
            <th scope="col" className="border-b px-4 py-2.5 text-right">
              {t('credit.history.col.amount')}
            </th>
            <th scope="col" className="border-b px-4 py-2.5 text-right max-[720px]:hidden">
              {t('credit.history.col.after')}
            </th>
          </tr>
        </thead>
        <tbody>
          {byDay(entries).map((group) => (
            <Fragment key={group.day}>
              <tr>
                <td
                  colSpan={3}
                  className="border-b bg-canvas px-4 py-2 text-xs font-semibold text-muted-foreground"
                >
                  {group.day === today
                    ? tf('credit.history.today', { date: dayLabel(group.day) })
                    : dayLabel(group.day)}
                </td>
              </tr>
              {group.rows.map((row) =>
                row.entry.type === 'usage' ? (
                  <UsageRows key={row.key} entry={row.entry} />
                ) : (
                  <CreditRow key={row.key} entry={row.entry} />
                ),
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreditRow({ entry }: { entry: Extract<HistoryEntry, { type: 'credit' }> }) {
  const positive = entry.amountVnd > 0;
  const title =
    entry.kind === 'trial'
      ? t('credit.kind.trial')
      : positive
        ? t('credit.kind.credit')
        : t('credit.kind.debit');
  const detail =
    entry.kind === 'trial'
      ? t('credit.kind.trialNote')
      : [entry.reason ? t(`credit.reason.${entry.reason}`) : null, entry.note]
          .filter(Boolean)
          .join(' · ');
  const Icon = entry.kind === 'trial' ? Gift : positive ? Plus : Minus;
  return (
    <tr>
      <td className={cell}>
        <div className="flex min-w-[15rem] max-[560px]:min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-lg',
              positive ? 'bg-success-soft text-success-ink' : 'bg-muted text-muted-foreground',
            )}
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <b className="block font-semibold">{title}</b>
            <small className="block text-xs break-words text-muted-foreground">{detail}</small>
          </div>
        </div>
      </td>
      <td className={cn(amountCell, positive && 'text-success-ink')}>
        <b className="font-semibold">{formatSignedVnd(entry.amountVnd)}</b>
      </td>
      <td className={afterCell}>{formatVnd(entry.balanceAfterVnd)}</td>
    </tr>
  );
}

/** One line per worker per day (#072); "Xem chi tiết" loads every call of the group. */
function UsageRows({ entry }: { entry: Extract<HistoryEntry, { type: 'usage' }> }) {
  const [open, setOpen] = useState(false);
  const calls = useQuery({ ...usageCallsQuery(entry.date, entry.workerId), enabled: open });
  const name = entry.workerName ?? t('credit.history.noWorker');
  return (
    <>
      <tr>
        <td className={cell}>
          <div className="flex min-w-[15rem] max-[560px]:min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-[0.6rem] font-semibold text-primary-ink"
            >
              {initials(name)}
            </span>
            <div className="min-w-0">
              <b className="block truncate font-semibold">{name}</b>
              <small className="text-xs text-muted-foreground">
                {tf('credit.history.calls', { count: VND.format(entry.calls) })} ·{' '}
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpen((value) => !value)}
                  className="cursor-pointer border-0 bg-transparent p-0 text-xs text-primary-ink underline underline-offset-3"
                >
                  {open ? t('credit.history.collapse') : t('credit.history.expand')}
                </button>
              </small>
            </div>
          </div>
        </td>
        <td className={amountCell}>
          <b className="font-semibold">{formatSignedVnd(entry.amountVnd)}</b>
        </td>
        <td className={afterCell}>{formatVnd(entry.balanceAfterVnd)}</td>
      </tr>
      {open
        ? (calls.data?.calls ?? []).map((call) => (
            <tr key={call.id} className="bg-[oklch(98.8%_0.004_255)] text-xs text-muted-foreground">
              <td className="border-b py-2 pr-4 pl-15">
                {tf('credit.history.call', {
                  time: vnTime(call.at),
                  tokens: VND.format(call.tokens),
                })}
              </td>
              <td className="border-b px-4 py-2 text-right tabular-nums">
                {formatSignedVnd(-call.amountVnd)}
              </td>
              <td className="border-b max-[720px]:hidden" />
            </tr>
          ))
        : null}
      {open && calls.isPending ? (
        <tr className="text-xs text-muted-foreground">
          <td colSpan={3} className="border-b py-2 pl-15">
            {t('credit.history.loadingCalls')}
          </td>
        </tr>
      ) : null}
    </>
  );
}

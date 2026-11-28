import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/app/page-header';
import { PlatformError, platformCard } from '@/components/platform/platform-shell';
import { AddPriceDialog } from '@/components/platform/price-dialog';
import { DefaultMultiplierDialog, FxRateDialog } from '@/components/platform/rate-dialogs';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { t, tf } from '@/i18n/t';
import { dayLabel, vnDate } from '@/lib/credit';
import { formatPermille, formatUsdMicros, formatVnd } from '@/lib/money';
import { type ModelPriceRow, PROVIDERS, type Provider, priceBookQuery } from '@/lib/platform';
import { cn } from '@/lib/utils';

const head = 'border-b px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground';
const cell = 'border-b px-4 py-3 align-middle';
const amount = `${cell} text-right whitespace-nowrap tabular-nums`;

function fullDate(iso: string): string {
  const date = vnDate(iso);
  return `${dayLabel(date)}/${date.slice(0, 4)}`;
}

/** Model prices, exchange rate and default multiplier (spec model-pricing). */
export function PlatformPricingPage() {
  const book = useQuery(priceBookQuery);
  const [provider, setProvider] = useState<Provider | 'all'>('all');
  const [dialog, setDialog] = useState<'price' | 'fx' | 'multiplier' | null>(null);
  const prices = (book.data?.prices ?? []).filter(
    (row) => provider === 'all' || row.provider === provider,
  );

  return (
    <>
      <PageHeader
        eyebrow={t('platform.pricing.eyebrow')}
        title={t('platform.pricing.title')}
        lead={t('platform.pricing.lead')}
        action={
          <Button type="button" onClick={() => setDialog('price')}>
            <Plus />
            {t('platform.pricing.add')}
          </Button>
        }
      />
      {book.isError ? <PlatformError error={book.error} /> : null}
      {book.data ? (
        <section
          aria-label={t('platform.pricing.settings')}
          className="mb-4 grid grid-cols-2 gap-3 max-[720px]:grid-cols-1"
        >
          <Setting
            title={t('platform.pricing.fx')}
            value={formatVnd(book.data.fxRate)}
            note={t('platform.pricing.fxNote')}
            onChange={() => setDialog('fx')}
          />
          <Setting
            title={t('platform.pricing.multiplier')}
            value={`× ${formatPermille(book.data.defaultMultiplierPermille)}`}
            note={tf('platform.pricing.multiplierNote', {
              example: formatVnd(book.data.defaultMultiplierPermille),
            })}
            onChange={() => setDialog('multiplier')}
          />
        </section>
      ) : null}
      <section aria-labelledby="pr-title" className={`${platformCard} overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-2.5 border-b px-4 py-3.5">
          <h2 id="pr-title" className="mr-auto font-semibold">
            {t('platform.pricing.table')}
          </h2>
          <Select
            aria-label={t('platform.pricing.provider')}
            className="h-9.5 w-auto text-sm"
            value={provider}
            onChange={(event) => setProvider(event.target.value as Provider | 'all')}
          >
            <option value="all">{t('platform.pricing.provider.all')}</option>
            {PROVIDERS.map((value) => (
              <option key={value} value={value}>
                {t(`platform.provider.${value}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-canvas">
              <tr>
                <th scope="col" className={head}>
                  {t('platform.pricing.col.model')}
                </th>
                <th scope="col" className={`${head} text-right`}>
                  {t('platform.pricing.col.input')}
                </th>
                <th scope="col" className={`${head} text-right`}>
                  {t('platform.pricing.col.output')}
                </th>
                <th scope="col" className={`${head} text-right max-[720px]:hidden`}>
                  {t('platform.pricing.col.cacheRead')}
                </th>
                <th scope="col" className={`${head} text-right max-[720px]:hidden`}>
                  {t('platform.pricing.col.cacheWrite')}
                </th>
                <th scope="col" className={head}>
                  {t('platform.pricing.col.effective')}
                </th>
              </tr>
            </thead>
            <tbody>
              {prices.map((row) => (
                <PriceRow key={row.id} row={row} />
              ))}
            </tbody>
          </table>
          {book.data && prices.length === 0 ? (
            <p className="px-4 py-10 text-center text-muted-foreground">
              {t('platform.pricing.empty')}
            </p>
          ) : null}
        </div>
      </section>
      {dialog === 'price' ? <AddPriceDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'fx' && book.data ? (
        <FxRateDialog current={book.data.fxRate} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'multiplier' && book.data ? (
        <DefaultMultiplierDialog
          current={book.data.defaultMultiplierPermille}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

function Setting({
  title,
  value,
  note,
  onChange,
}: {
  title: string;
  value: string;
  note: string;
  onChange: () => void;
}) {
  return (
    <div className={`${platformCard} grid gap-2 px-5 py-4.5`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button
          type="button"
          variant="ghost"
          className="h-8"
          onClick={onChange}
          aria-label={`${t('platform.pricing.change')} ${title}`}
        >
          {t('platform.pricing.change')}
        </Button>
      </div>
      <span className="text-xl font-bold tabular-nums">{value}</span>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function PriceRow({ row }: { row: ModelPriceRow }) {
  const date = fullDate(row.effectiveFrom);
  return (
    <tr className={cn(row.status === 'superseded' && '[&>td]:opacity-55')}>
      <td className={cell}>
        <b className="block font-mono text-[0.8125rem] font-semibold">{row.model}</b>
        <small className="text-xs text-muted-foreground">
          {t(`platform.provider.${row.provider}`)}
        </small>
      </td>
      <td className={amount}>{formatUsdMicros(row.inputUsdMicrosPerMtok)}</td>
      <td className={amount}>{formatUsdMicros(row.outputUsdMicrosPerMtok)}</td>
      <td className={`${amount} max-[720px]:hidden`}>
        {formatUsdMicros(row.cacheReadUsdMicrosPerMtok)}
      </td>
      <td className={`${amount} max-[720px]:hidden`}>
        {row.cacheWriteUsdMicrosPerMtok === null
          ? '—'
          : formatUsdMicros(row.cacheWriteUsdMicrosPerMtok)}
      </td>
      <td className={cell}>
        {row.status === 'current' ? (
          <StatusBadge tone="success">
            {tf('platform.pricing.status.current', { date })}
          </StatusBadge>
        ) : row.status === 'scheduled' ? (
          <StatusBadge tone="warning">
            {tf('platform.pricing.status.scheduled', { date })}
          </StatusBadge>
        ) : (
          <span className="text-muted-foreground">
            {tf('platform.pricing.status.superseded', { date })}
          </span>
        )}
      </td>
    </tr>
  );
}

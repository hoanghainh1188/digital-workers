import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { t, tf } from '@/i18n/t';
import { ApiError } from '@/lib/api';
import type { CreditReason } from '@/lib/credit';
import { formatSignedVnd, formatVnd, parseVnd } from '@/lib/money';
import { type CompanySummary, postAdjustment } from '@/lib/platform';
import { cn } from '@/lib/utils';

const MAX = 100_000_000;
const ACCOUNT_NUMBER = /\d{9,}/;
const REASONS: readonly CreditReason[] = ['bank_transfer', 'trial', 'system_fix', 'other'];
const VND = new Intl.NumberFormat('vi-VN');

type Errors = { amount?: string; note?: string; form?: string };

/**
 * "Điều chỉnh credit" (spec platform-admin): a new ledger transaction with a reason and
 * a note. The Idempotency-Key is made once per opening, so a double click or a retry
 * after a network error can never credit twice.
 */
export function AdjustCreditDialog({
  company,
  onClose,
  onDone,
}: {
  company: CompanySummary;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState<CreditReason>('bank_transfer');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const amount = parseVnd(amountText);
  const signed = amount === null ? 0 : direction === 'credit' ? amount : -amount;
  const submit = useMutation({
    mutationFn: () =>
      postAdjustment(
        company.id,
        { direction, amountVnd: amount ?? 0, reason, note: note.trim() },
        idempotencyKey,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform', 'companies'] });
      onDone(tf('platform.adjust.done', { company: company.name }));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'INSUFFICIENT_BALANCE') {
        setErrors({ amount: t('platform.adjust.error.insufficient') });
      } else if (error instanceof ApiError && error.details.some((d) => d.path === 'note')) {
        setErrors({ note: t('platform.adjust.error.account') });
      } else {
        setErrors({
          form: error instanceof ApiError ? t('app.error.generic') : t('app.error.network'),
        });
      }
    },
  });

  function onSubmit() {
    const next: Errors = {};
    if (amount === null || amount < 1 || amount > MAX)
      next.amount = t('platform.adjust.error.amount');
    const trimmed = note.trim();
    if (trimmed === '' || trimmed.length > 200) next.note = t('platform.adjust.error.note');
    else if (ACCOUNT_NUMBER.test(trimmed)) next.note = t('platform.adjust.error.account');
    if (direction === 'debit' && amount !== null && amount > company.balanceVnd) {
      next.amount = t('platform.adjust.error.insufficient');
    }
    setErrors(next);
    if (Object.keys(next).length === 0) submit.mutate();
  }

  const label =
    amount === null
      ? direction === 'credit'
        ? t('platform.adjust.credit')
        : t('platform.adjust.debit')
      : tf(
          direction === 'credit' ? 'platform.adjust.submit.credit' : 'platform.adjust.submit.debit',
          {
            amount: formatVnd(amount),
          },
        );

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? null : onClose())}
      wide
      title={tf('platform.adjust.title', { company: company.name })}
      description={t('platform.adjust.lead')}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('platform.cancel')}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={submit.isPending}>
            {submit.isPending ? <Spinner /> : null}
            {label}
          </Button>
        </>
      }
    >
      {errors.form ? (
        <Callout tone="danger" role="alert">
          {errors.form}
        </Callout>
      ) : null}
      <fieldset className="m-0 grid grid-cols-2 gap-2 border-0 p-0">
        <legend className="sr-only">{t('platform.adjust.direction')}</legend>
        {(['credit', 'debit'] as const).map((value) => (
          <label
            key={value}
            className={cn(
              'relative flex h-10.5 cursor-pointer items-center justify-center rounded-md border border-border-strong text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
              direction === value &&
                'border-primary bg-primary-soft text-primary-ink shadow-[0_0_0_1px_var(--primary)]',
            )}
          >
            <input
              type="radio"
              name="direction"
              className="absolute opacity-0"
              checked={direction === value}
              onChange={() => setDirection(value)}
            />
            {t(value === 'credit' ? 'platform.adjust.credit' : 'platform.adjust.debit')}
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
        <Field id="adj-amount" label={t('platform.adjust.amount')} error={errors.amount}>
          {(aria) => (
            <div className="relative">
              <Input
                {...aria}
                inputMode="numeric"
                className="pr-8 tabular-nums"
                value={amountText}
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, '').slice(0, 9);
                  setAmountText(digits ? VND.format(Number(digits)) : '');
                }}
              />
              <span className="absolute top-1/2 right-3.5 -translate-y-1/2 text-sm text-muted-foreground">
                đ
              </span>
            </div>
          )}
        </Field>
        <Field id="adj-reason" label={t('platform.adjust.reason')}>
          {(aria) => (
            <Select
              {...aria}
              value={reason}
              onChange={(event) => setReason(event.target.value as CreditReason)}
            >
              {REASONS.map((value) => (
                <option key={value} value={value}>
                  {t(`credit.reason.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field
        id="adj-note"
        label={t('platform.adjust.note')}
        hint={t('platform.adjust.noteHint')}
        error={errors.note}
      >
        {(aria) => (
          <Textarea
            {...aria}
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>
      <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 rounded-md bg-canvas px-4 py-3.5 text-sm tabular-nums">
        <dt className="text-muted-foreground">{t('platform.adjust.current')}</dt>
        <dd className="m-0 text-right font-semibold">{formatVnd(company.balanceVnd)}</dd>
        <dt className="text-muted-foreground">
          {t(
            direction === 'credit'
              ? 'platform.adjust.change.credit'
              : 'platform.adjust.change.debit',
          )}
        </dt>
        <dd
          className={cn(
            'm-0 text-right font-semibold',
            direction === 'credit' && 'text-success-ink',
          )}
        >
          {formatSignedVnd(signed)}
        </dd>
        <dt className="border-t pt-1.5 text-muted-foreground">{t('platform.adjust.after')}</dt>
        <dd className="m-0 border-t pt-1.5 text-right font-semibold">
          {formatVnd(company.balanceVnd + signed)}
        </dd>
      </dl>
      {company.state === 'exhausted' && direction === 'credit' ? (
        <Callout tone="info">{t('platform.adjust.revive')}</Callout>
      ) : null}
    </Dialog>
  );
}

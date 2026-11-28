import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { t, tf } from '@/i18n/t';
import type { MessageKey } from '@/i18n/vi';
import { api } from '@/lib/api';
import { formatPermille, parsePermille, parseVnd } from '@/lib/money';
import type { CompanySummary } from '@/lib/platform';

/** A one-field dialog (exchange rate, default multiplier). */
function ValueDialog({
  title,
  description,
  label,
  hint,
  initial,
  parse,
  errorKey,
  save,
  extra,
  onClose,
}: {
  title: string;
  description: string;
  label: string;
  hint?: string;
  initial: string;
  parse: (text: string) => number | null;
  errorKey: MessageKey;
  save: (value: number) => Promise<unknown>;
  extra?: (busy: boolean) => React.ReactNode;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({ mutationFn: save, onSuccess: onClose });
  const submit = () => {
    const value = parse(text);
    if (value === null) {
      setError(t(errorKey));
      return;
    }
    setError(null);
    mutation.mutate(value);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? null : onClose())}
      title={title}
      description={description}
      footer={
        <>
          {extra?.(mutation.isPending)}
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('platform.cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner /> : null}
            {t('platform.rate.save')}
          </Button>
        </>
      }
    >
      {mutation.isError ? (
        <Callout tone="danger" role="alert">
          {t(errorKey)}
        </Callout>
      ) : null}
      <Field id="rate-value" label={label} hint={hint} error={error ?? undefined}>
        {(aria) => (
          <Input
            {...aria}
            inputMode="decimal"
            className="tabular-nums"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}

const permilleInRange = (text: string) => {
  const value = parsePermille(text);
  return value !== null && value >= 1000 && value <= 10_000 ? value : null;
};

export function FxRateDialog({ current, onClose }: { current: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  return (
    <ValueDialog
      title={t('platform.fx.title')}
      description={t('platform.rate.lead')}
      label={t('platform.fx.value')}
      initial={new Intl.NumberFormat('vi-VN').format(current)}
      parse={(text) => {
        const value = parseVnd(text);
        return value !== null && value >= 1 && value <= 1_000_000 ? value : null;
      }}
      errorKey="platform.fx.error"
      save={async (vndPerUsd) => {
        await api('/api/platform/fx-rates', { method: 'POST', body: { vndPerUsd } });
        await queryClient.invalidateQueries({ queryKey: ['platform', 'prices'] });
      }}
      onClose={onClose}
    />
  );
}

export function DefaultMultiplierDialog({
  current,
  onClose,
}: {
  current: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  return (
    <ValueDialog
      title={t('platform.defaultMultiplier.title')}
      description={t('platform.rate.lead')}
      label={t('platform.multiplier.value')}
      hint={t('platform.multiplier.hint')}
      initial={formatPermille(current)}
      parse={permilleInRange}
      errorKey="platform.multiplier.error"
      save={async (permille) => {
        await api('/api/platform/multipliers', { method: 'POST', body: { permille } });
        await queryClient.invalidateQueries({ queryKey: ['platform', 'prices'] });
      }}
      onClose={onClose}
    />
  );
}

/** Company-specific multiplier: set, or clear back to the default. */
export function CompanyMultiplierDialog({
  company,
  onClose,
}: {
  company: CompanySummary;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['platform', 'companies'] });
  const url = `/api/platform/companies/${company.id}/multiplier`;
  return (
    <ValueDialog
      title={tf('platform.multiplier.title', { company: company.name })}
      description={t('platform.multiplier.lead')}
      label={t('platform.multiplier.value')}
      hint={t('platform.multiplier.hint')}
      initial={
        company.multiplierPermille === null ? '' : formatPermille(company.multiplierPermille)
      }
      parse={permilleInRange}
      errorKey="platform.multiplier.error"
      save={async (permille) => {
        await api(url, { method: 'PUT', body: { permille } });
        await refresh();
      }}
      extra={(busy) =>
        company.multiplierPermille === null ? null : (
          <Button
            type="button"
            variant="dangerOutline"
            className="mr-auto"
            disabled={busy}
            onClick={async () => {
              await api(url, { method: 'DELETE' });
              await refresh();
              onClose();
            }}
          >
            {t('platform.multiplier.clear')}
          </Button>
        )
      }
      onClose={onClose}
    />
  );
}

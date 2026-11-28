import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { t } from '@/i18n/t';
import type { MessageKey } from '@/i18n/vi';
import { ApiError, api } from '@/lib/api';
import { vnDate } from '@/lib/credit';
import { parseUsdToMicros } from '@/lib/money';
import { PROVIDERS, type Provider } from '@/lib/platform';

type PriceField = 'input' | 'output' | 'cacheRead' | 'cacheWrite';
const FIELDS: ReadonlyArray<readonly [PriceField, MessageKey]> = [
  ['input', 'platform.price.input'],
  ['output', 'platform.price.output'],
  ['cacheRead', 'platform.price.cacheRead'],
  ['cacheWrite', 'platform.price.cacheWrite'],
];

/**
 * "Thêm giá mới" (spec model-pricing). USD amounts are parsed digit by digit into
 * micro-USD integers; a date of today means "from now", otherwise 00:00 Vietnam time.
 */
export function AddPriceDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const today = vnDate(new Date().toISOString());
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [model, setModel] = useState('');
  const [usd, setUsd] = useState<Record<PriceField, string>>({
    input: '',
    output: '',
    cacheRead: '',
    cacheWrite: '',
  });
  const [from, setFrom] = useState(today);
  const [errors, setErrors] = useState<
    Partial<Record<PriceField | 'model' | 'from' | 'form', string>>
  >({});

  const mutation = useMutation({
    mutationFn: (body: object) => api('/api/platform/model-prices', { method: 'POST', body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform', 'prices'] });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'EFFECTIVE_IN_PAST') {
        setErrors({ from: t('platform.price.error.past') });
      } else if (error instanceof ApiError && error.code === 'PRICE_EXISTS') {
        setErrors({ form: t('platform.price.error.exists') });
      } else {
        setErrors({
          form: error instanceof ApiError ? t('app.error.generic') : t('app.error.network'),
        });
      }
    },
  });

  function submit() {
    const next: typeof errors = {};
    const micros: Partial<Record<PriceField, number | null>> = {};
    for (const [field] of FIELDS) {
      const text = usd[field].trim();
      if (field === 'cacheWrite' && text === '') {
        micros[field] = null;
        continue;
      }
      const value = parseUsdToMicros(text);
      if (value === null) next[field] = t('platform.price.error.usd');
      micros[field] = value;
    }
    if (model.trim() === '') next.model = t('platform.price.error.model');
    if (from < today) next.from = t('platform.price.error.past');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    mutation.mutate({
      provider,
      model: model.trim(),
      inputUsdMicrosPerMtok: micros.input,
      outputUsdMicrosPerMtok: micros.output,
      cacheReadUsdMicrosPerMtok: micros.cacheRead,
      cacheWriteUsdMicrosPerMtok: micros.cacheWrite ?? null,
      ...(from === today ? {} : { effectiveFrom: `${from}T00:00:00+07:00` }),
    });
  }

  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => (open ? null : onClose())}
      title={t('platform.price.title')}
      description={t('platform.price.lead')}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('platform.cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner /> : null}
            {t('platform.price.submit')}
          </Button>
        </>
      }
    >
      {errors.form ? (
        <Callout tone="danger" role="alert">
          {errors.form}
        </Callout>
      ) : null}
      <div className="grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
        <Field id="price-provider" label={t('platform.pricing.provider')}>
          {(aria) => (
            <Select
              {...aria}
              value={provider}
              onChange={(event) => setProvider(event.target.value as Provider)}
            >
              {PROVIDERS.map((value) => (
                <option key={value} value={value}>
                  {t(`platform.provider.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="price-model" label={t('platform.price.model')} error={errors.model}>
          {(aria) => (
            <Input
              {...aria}
              className="font-mono text-sm"
              maxLength={100}
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          )}
        </Field>
        {FIELDS.map(([field, label]) => (
          <Field
            key={field}
            id={`price-${field}`}
            label={t(label)}
            hint={field === 'cacheWrite' ? t('platform.price.cacheWriteHint') : undefined}
            error={errors[field]}
          >
            {(aria) => (
              <Input
                {...aria}
                inputMode="decimal"
                placeholder="0,00"
                className="tabular-nums"
                value={usd[field]}
                onChange={(event) =>
                  setUsd((current) => ({ ...current, [field]: event.target.value }))
                }
              />
            )}
          </Field>
        ))}
      </div>
      <Field
        id="price-from"
        label={t('platform.price.from')}
        hint={t('platform.price.fromHint')}
        error={errors.from}
      >
        {(aria) => (
          <Input
            {...aria}
            type="date"
            min={today}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}

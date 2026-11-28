import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/app/page-header';
import { PlatformError, platformCard } from '@/components/platform/platform-shell';
import { StatusBadge } from '@/components/ui/badge';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { t, tf } from '@/i18n/t';
import { ApiError, api } from '@/lib/api';
import { dayLabel, vnDate } from '@/lib/credit';
import { type KeyStatus, keysQuery, type Provider } from '@/lib/platform';

/** Platform API keys: status only, never the value (spec secret-encryption). */
export function PlatformKeysPage() {
  const keys = useQuery(keysQuery);
  const [replacing, setReplacing] = useState<Provider | null>(null);
  return (
    <>
      <PageHeader
        eyebrow={t('platform.keys.eyebrow')}
        title={t('platform.keys.title')}
        lead={t('platform.keys.lead')}
      />
      {keys.isError ? <PlatformError error={keys.error} /> : null}
      <div className="grid gap-3">
        {(keys.data?.keys ?? []).map((key) => (
          <KeyCard key={key.provider} status={key} onReplace={() => setReplacing(key.provider)} />
        ))}
        {keys.data ? <Callout tone="info">{t('platform.keys.limit')}</Callout> : null}
      </div>
      {replacing ? (
        <ReplaceKeyDialog provider={replacing} onClose={() => setReplacing(null)} />
      ) : null}
    </>
  );
}

function KeyCard({ status, onReplace }: { status: KeyStatus; onReplace: () => void }) {
  const name = t(`platform.provider.${status.provider}`);
  const titleId = `key-${status.provider}`;
  const updated = status.updatedAt ? vnDate(status.updatedAt) : null;
  return (
    <section
      aria-labelledby={titleId}
      className={`${platformCard} grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-5 py-4.5 max-[720px]:grid-cols-[auto_minmax(0,1fr)]`}
    >
      <span
        aria-hidden="true"
        className="grid size-11 place-items-center rounded-[10px] bg-muted text-sm font-bold text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]"
      >
        {name[0]}
      </span>
      <div className="min-w-0">
        <h3 id={titleId} className="flex flex-wrap items-center gap-2 font-semibold">
          {name}
          {status.configured ? (
            <StatusBadge tone="success">{t('platform.keys.configured')}</StatusBadge>
          ) : (
            <StatusBadge tone="muted">{t('platform.keys.missing')}</StatusBadge>
          )}
        </h3>
        <p className="text-sm text-muted-foreground">
          {updated
            ? tf('platform.keys.updated', { date: `${dayLabel(updated)}/${updated.slice(0, 4)}` })
            : t('platform.keys.none')}
        </p>
      </div>
      <div className="flex justify-end max-[720px]:col-span-2 max-[720px]:justify-start">
        <Button
          type="button"
          variant={status.configured ? 'outline' : 'default'}
          onClick={onReplace}
        >
          {status.configured ? t('platform.keys.replace') : t('platform.keys.add')}
        </Button>
      </div>
    </section>
  );
}

function ReplaceKeyDialog({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      api(`/api/platform/provider-keys/${provider}`, {
        method: 'PUT',
        body: { apiKey: apiKey.trim() },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform', 'keys'] });
      onClose();
    },
    onError: (failure) => {
      setError(
        failure instanceof ApiError && failure.code === 'INVALID_KEY'
          ? t('platform.key.error.invalid')
          : failure instanceof ApiError && failure.code === 'PROVIDER_UNREACHABLE'
            ? t('platform.key.error.unreachable')
            : failure instanceof ApiError && failure.status === 400
              ? t('platform.key.error.short')
              : t('app.error.generic'),
      );
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? null : onClose())}
      title={tf('platform.key.title', { provider: t(`platform.provider.${provider}`) })}
      description={t('platform.key.lead')}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('platform.cancel')}
          </Button>
          <Button
            type="button"
            disabled={mutation.isPending || apiKey.trim().length < 10}
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
          >
            {mutation.isPending ? (
              <>
                <Spinner />
                {t('platform.key.submitting')}
              </>
            ) : (
              t('platform.key.submit')
            )}
          </Button>
        </>
      }
    >
      {error ? (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      ) : null}
      <Field id="key-value" label={t('platform.key.value')} hint={t('platform.key.hint')}>
        {(aria) => (
          <Input
            {...aria}
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-sm"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}

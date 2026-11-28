import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { AuthHeader, AuthLayout } from '@/components/auth/auth-layout';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field, Input } from '@/components/ui/field';
import { t } from '@/i18n/t';
import { ApiError, api } from '@/lib/api';
import { forgetMe } from '@/lib/queries';

/** Maps a failed TOTP / backup-code check to a message. */
export function twoFactorError(error: unknown): string {
  if (!(error instanceof ApiError)) return t('app.error.network');
  if (error.status === 429) return t('twoFactor.error.locked');
  if (error.code.includes('COOKIE') || error.code.includes('SESSION')) {
    return t('twoFactor.error.expired');
  }
  return error.status === 401 || error.status === 400
    ? t('twoFactor.error.invalid')
    : t('app.error.generic');
}

/**
 * Second sign-in step (design D10): after a correct password Better Auth gives no
 * session yet, only a short-lived challenge cookie. "Ghi nhớ thiết bị" does not exist.
 */
export function TwoFactorPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    setSubmitting(true);
    try {
      await api(
        backup ? '/api/auth/two-factor/verify-backup-code' : '/api/auth/two-factor/verify-totp',
        {
          method: 'POST',
          body: { code: code.trim() },
        },
      );
      forgetMe(queryClient);
      await navigate({ to: '/' });
    } catch (error) {
      setFailure(twoFactorError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <AuthHeader
        eyebrow={t('twoFactor.eyebrow')}
        title={t('twoFactor.title')}
        lead={t('twoFactor.lead')}
      />
      {failure ? (
        <Callout tone="danger" role="alert">
          {failure}
        </Callout>
      ) : null}
      <form className="grid gap-4" noValidate onSubmit={onSubmit}>
        <Field id="code" label={backup ? t('twoFactor.backup') : t('twoFactor.code')}>
          {(aria) => (
            <Input
              {...aria}
              autoComplete="one-time-code"
              inputMode={backup ? 'text' : 'numeric'}
              maxLength={backup ? 32 : 6}
              className="text-center font-mono text-lg tracking-[0.4em]"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          )}
        </Field>
        <Button
          type="submit"
          size="lg"
          block
          disabled={submitting || code.trim() === ''}
          aria-busy={submitting}
        >
          {submitting ? (
            <>
              <Spinner />
              {t('twoFactor.submitting')}
            </>
          ) : (
            t('twoFactor.submit')
          )}
        </Button>
      </form>
      <p className="flex flex-wrap justify-between gap-2 text-sm">
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 text-primary-ink underline underline-offset-3"
          onClick={() => {
            setBackup((value) => !value);
            setCode('');
          }}
        >
          {backup ? t('twoFactor.code') : t('twoFactor.backup')}
        </button>
        <Link to="/login">{t('twoFactor.toLogin')}</Link>
      </p>
    </AuthLayout>
  );
}

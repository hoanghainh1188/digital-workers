import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { VerifyEmailBanner } from '@/components/app/verify-banner';
import { AuthHeader, AuthLayout } from '@/components/auth/auth-layout';
import { PasswordInput } from '@/components/auth/password-input';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field, Input } from '@/components/ui/field';
import { t, tf } from '@/i18n/t';
import { ApiError, api } from '@/lib/api';
import { forgetMe, type Me } from '@/lib/queries';
import { twoFactorError } from './two-factor.tsx';

type Enrollment = { totpURI: string; backupCodes: string[] };

/**
 * Turning TOTP on for a platform admin (design D10). The secret is shown as text and
 * as an otpauth:// link to type into an authenticator app; no QR code (0.2 #099).
 */
export function PlatformSetup2faPage({ me }: { me: Me }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    setBusy(true);
    try {
      setEnrollment(
        await api<Enrollment>('/api/auth/two-factor/enable', {
          method: 'POST',
          body: { password },
        }),
      );
    } catch (error) {
      setFailure(
        error instanceof ApiError && (error.status === 400 || error.status === 401)
          ? t('setup2fa.error.password')
          : error instanceof ApiError
            ? t('app.error.generic')
            : t('app.error.network'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function finish(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    setBusy(true);
    try {
      await api('/api/auth/two-factor/verify-totp', {
        method: 'POST',
        body: { code: code.trim() },
      });
      forgetMe(queryClient);
      await navigate({ to: '/platform/companies' });
    } catch (error) {
      setFailure(twoFactorError(error));
    } finally {
      setBusy(false);
    }
  }

  const secret = enrollment ? (new URL(enrollment.totpURI).searchParams.get('secret') ?? '') : '';

  return (
    <AuthLayout>
      <AuthHeader
        eyebrow={t('setup2fa.eyebrow')}
        title={t('setup2fa.title')}
        lead={t('setup2fa.lead')}
      />
      {failure ? (
        <Callout tone="danger" role="alert">
          {failure}
        </Callout>
      ) : null}
      {!me.user.emailVerified ? (
        <div className="grid gap-3 overflow-hidden rounded-lg border">
          <p className="px-4 pt-3 text-sm">
            {tf('setup2fa.verifyFirst', { email: me.user.email })}
          </p>
          <VerifyEmailBanner email={me.user.email} />
        </div>
      ) : enrollment === null ? (
        <form className="grid gap-4" noValidate onSubmit={start}>
          <Field id="password" label={t('setup2fa.password')}>
            {(aria) => (
              <PasswordInput
                {...aria}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
          <Button type="submit" size="lg" block disabled={busy || password === ''}>
            {busy ? (
              <>
                <Spinner />
                {t('setup2fa.starting')}
              </>
            ) : (
              t('setup2fa.start')
            )}
          </Button>
        </form>
      ) : (
        <form className="grid gap-5" noValidate onSubmit={finish}>
          <ol className="grid gap-5">
            <li className="grid gap-3">
              <h2 className="flex gap-2 text-sm font-semibold">
                <span className="grid size-5.5 shrink-0 place-items-center rounded-full bg-primary-soft text-xs text-primary-ink">
                  1
                </span>
                {t('setup2fa.step1')}
              </h2>
              <div className="grid gap-1.5 rounded-lg bg-canvas p-4">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('setup2fa.secret')}
                </span>
                <code
                  data-testid="totp-secret"
                  className="font-mono text-base font-semibold tracking-[0.12em] break-all select-all"
                >
                  {secret}
                </code>
                <span className="text-xs text-muted-foreground">{t('setup2fa.secretHint')}</span>
                <a href={enrollment.totpURI} className="flex items-center gap-1.5 text-sm">
                  <KeyRound aria-hidden="true" className="size-4" />
                  {t('setup2fa.openApp')}
                </a>
              </div>
              <details className="rounded-lg border px-4 py-3 text-sm">
                <summary className="cursor-pointer font-medium">{t('setup2fa.backup')}</summary>
                <p className="mt-2 text-xs text-muted-foreground">{t('setup2fa.backupHint')}</p>
                <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">
                  {enrollment.backupCodes.map((backup) => (
                    <li key={backup}>{backup}</li>
                  ))}
                </ul>
              </details>
            </li>
            <li className="grid gap-3">
              <h2 className="flex gap-2 text-sm font-semibold">
                <span className="grid size-5.5 shrink-0 place-items-center rounded-full bg-primary-soft text-xs text-primary-ink">
                  2
                </span>
                {t('setup2fa.step2')}
              </h2>
              <Field id="code" label={t('twoFactor.code')}>
                {(aria) => (
                  <Input
                    {...aria}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    className="text-center font-mono text-lg tracking-[0.4em]"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                )}
              </Field>
            </li>
          </ol>
          <Button type="submit" size="lg" block disabled={busy || code.trim().length !== 6}>
            {busy ? <Spinner /> : null}
            {t('setup2fa.finish')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

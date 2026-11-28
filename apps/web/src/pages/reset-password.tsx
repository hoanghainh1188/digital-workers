import { resetPasswordInput } from '@dw/core/org-schemas';
import { Link } from '@tanstack/react-router';
import { Link2Off } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { AuthHeader, AuthLayout } from '@/components/auth/auth-layout';
import { PasswordInput } from '@/components/auth/password-input';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field } from '@/components/ui/field';
import { t } from '@/i18n/t';
import { authClient } from '@/lib/auth-client';
import { type FieldErrors, fromZodIssues, toFieldErrors } from '@/lib/form-errors';

/**
 * Đặt lại mật khẩu. The email link goes through Better Auth, which redirects here
 * with `?token=` while the link is valid and `?error=INVALID_TOKEN` once used or expired.
 */
export function ResetPasswordPage({ token }: { token: string | undefined }) {
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [state, setState] = useState<'form' | 'done' | 'invalid'>(token ? 'form' : 'invalid');
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const parsed = resetPasswordInput.safeParse({ token, newPassword: password });
    setErrors(parsed.success ? {} : toFieldErrors(fromZodIssues(parsed.error.issues)));
    if (!parsed.success) return;
    setSubmitting(true);
    try {
      const { error } = await authClient.resetPassword(parsed.data);
      if (!error) setState('done');
      else if (error.code === 'PASSWORD_COMMON')
        setErrors({ newPassword: t('form.password_common') });
      else if (error.code === 'INVALID_TOKEN') setState('invalid');
      else setFailure(t('app.error.generic'));
    } catch {
      setFailure(t('app.error.network'));
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'invalid') {
    return (
      <AuthLayout>
        <section className="grid justify-items-start gap-4" aria-labelledby="reset-invalid">
          <span className="grid size-12 place-items-center rounded-xl bg-warning-soft text-warning-ink">
            <Link2Off aria-hidden="true" className="size-6" />
          </span>
          <h2
            id="reset-invalid"
            className="text-[length:var(--text-title)] font-bold tracking-[-0.02em]"
          >
            {t('reset.invalid.title')}
          </h2>
          <p className="text-muted-foreground">{t('reset.invalid.body')}</p>
          <Button asChild>
            <Link to="/forgot-password">{t('reset.invalid.again')}</Link>
          </Button>
        </section>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthHeader eyebrow={t('reset.eyebrow')} title={t('reset.title')} lead={t('reset.lead')} />
      {state === 'done' ? (
        <>
          <Callout tone="info" role="status">
            {t('reset.done')}
          </Callout>
          <Button asChild size="lg" block>
            <Link to="/login">{t('reset.toLogin')}</Link>
          </Button>
        </>
      ) : (
        <form className="grid gap-4" noValidate onSubmit={onSubmit}>
          {failure ? (
            <Callout tone="danger" role="alert">
              {failure}
            </Callout>
          ) : null}
          <Field
            id="new-password"
            label={t('reset.password')}
            hint={t('signup.password.hint')}
            error={errors.newPassword}
          >
            {(aria) => (
              <PasswordInput
                {...aria}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
          <Button type="submit" size="lg" block disabled={submitting} aria-busy={submitting}>
            {submitting ? (
              <>
                <Spinner />
                {t('reset.submitting')}
              </>
            ) : (
              t('reset.submit')
            )}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

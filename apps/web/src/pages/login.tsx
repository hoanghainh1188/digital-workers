import { signinInput } from '@dw/core/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { AuthHeader, AuthLayout } from '@/components/auth/auth-layout';
import { GoogleSignIn } from '@/components/auth/google-button';
import { PasswordInput } from '@/components/auth/password-input';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field, Input } from '@/components/ui/field';
import { t } from '@/i18n/t';
import { authClient } from '@/lib/auth-client';
import { type FieldErrors, fromZodIssues, toFieldErrors } from '@/lib/form-errors';
import { forgetMe } from '@/lib/queries';

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const parsed = signinInput.safeParse({ email, password });
    setErrors(parsed.success ? {} : toFieldErrors(fromZodIssues(parsed.error.issues)));
    if (!parsed.success) return;
    setSubmitting(true);
    try {
      const { error } = await authClient.signIn.email(parsed.data);
      if (error) {
        setFailure(
          error.code === 'ACCOUNT_LOCKED'
            ? t('login.error.locked')
            : error.status === 429
              ? t('login.error.tooMany')
              : error.status === 401
                ? t('login.error.invalid')
                : t('app.error.generic'),
        );
        return;
      }
      forgetMe(queryClient);
      await navigate({ to: '/' });
    } catch {
      setFailure(t('app.error.network'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <AuthHeader eyebrow={t('login.eyebrow')} title={t('login.title')} lead={t('login.lead')} />
      {failure ? (
        <Callout tone="danger" role="alert">
          {failure}
        </Callout>
      ) : null}
      <GoogleSignIn />
      <form className="grid gap-4" noValidate onSubmit={onSubmit}>
        <Field id="email" label={t('login.email')} error={errors.email}>
          {(aria) => (
            <Input
              {...aria}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Field id="password" label={t('login.password')} error={errors.password}>
          {(aria) => (
            <PasswordInput
              {...aria}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <p className="-mt-2 text-right text-sm">
          <Link to="/forgot-password">{t('login.forgot')}</Link>
        </p>
        <Button type="submit" size="lg" block disabled={submitting} aria-busy={submitting}>
          {submitting ? (
            <>
              <Spinner />
              {t('login.submitting')}
            </>
          ) : (
            t('login.submit')
          )}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        {t('login.noAccount')} <Link to="/signup">{t('login.toSignup')}</Link>
      </p>
    </AuthLayout>
  );
}

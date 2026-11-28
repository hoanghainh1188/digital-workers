import { forgotPasswordInput } from '@dw/core/org-schemas';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { AuthHeader, AuthLayout } from '@/components/auth/auth-layout';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field, Input } from '@/components/ui/field';
import { t } from '@/i18n/t';
import { authClient } from '@/lib/auth-client';
import { type FieldErrors, fromZodIssues, toFieldErrors } from '@/lib/form-errors';

/** Quên mật khẩu (0.2 #069: login-page style, no separate design). */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [result, setResult] = useState<'sent' | 'tooMany' | 'failed' | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setResult(null);
    const parsed = forgotPasswordInput.safeParse({ email });
    setErrors(parsed.success ? {} : toFieldErrors(fromZodIssues(parsed.error.issues)));
    if (!parsed.success) return;
    setSubmitting(true);
    try {
      const { error } = await authClient.requestPasswordReset({
        email: parsed.data.email,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      // Same message whether or not the email has an account (spec authentication).
      setResult(error ? (error.status === 429 ? 'tooMany' : 'failed') : 'sent');
    } catch {
      setResult('failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <AuthHeader eyebrow={t('forgot.eyebrow')} title={t('forgot.title')} lead={t('forgot.lead')} />
      {result === 'sent' ? (
        <Callout tone="info" role="status">
          {t('forgot.sent')}
        </Callout>
      ) : null}
      {result === 'tooMany' || result === 'failed' ? (
        <Callout tone="danger" role="alert">
          {result === 'tooMany' ? t('forgot.tooMany') : t('app.error.network')}
        </Callout>
      ) : null}
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
        <Button type="submit" size="lg" block disabled={submitting} aria-busy={submitting}>
          {submitting ? (
            <>
              <Spinner />
              {t('forgot.submitting')}
            </>
          ) : (
            t('forgot.submit')
          )}
        </Button>
      </form>
      <p className="text-center text-sm">
        <Link to="/login">{t('forgot.back')}</Link>
      </p>
    </AuthLayout>
  );
}

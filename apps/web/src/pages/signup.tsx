import { signupInput } from '@dw/core/schemas';
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
import { ApiError, api } from '@/lib/api';
import { type FieldErrors, fromZodIssues, toFieldErrors } from '@/lib/form-errors';
import { forgetMe } from '@/lib/queries';

type Values = { companyName: string; name: string; phone: string; email: string; password: string };
const empty: Values = { companyName: '', name: '', phone: '', email: '', password: '' };

export function SignupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState(empty);
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const bind = (field: keyof Values) => ({
    name: field,
    value: values[field],
    onChange: (event: { target: { value: string } }) =>
      setValues((current) => ({ ...current, [field]: event.target.value })),
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const parsed = signupInput.safeParse(values);
    const fieldErrors = parsed.success ? {} : toFieldErrors(fromZodIssues(parsed.error.issues));
    const allErrors = accepted
      ? fieldErrors
      : { ...fieldErrors, terms: t('signup.terms.required') };
    setErrors(allErrors);
    if (!parsed.success || !accepted) {
      setFailure(t('signup.error.summary'));
      return;
    }
    setSubmitting(true);
    try {
      await api('/api/signup', { method: 'POST', body: parsed.data });
      forgetMe(queryClient);
      await navigate({ to: '/' });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_TAKEN') {
        setErrors({ email: t('signup.error.emailTaken') });
        setFailure(t('signup.error.summary'));
      } else if (error instanceof ApiError && error.details.length > 0) {
        setErrors(toFieldErrors(error.details));
        setFailure(t('signup.error.summary'));
      } else {
        setFailure(error instanceof ApiError ? t('app.error.generic') : t('app.error.network'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <AuthHeader eyebrow={t('signup.eyebrow')} title={t('signup.title')} lead={t('signup.lead')} />
      {failure ? (
        <Callout tone="danger" role="alert">
          {failure}
        </Callout>
      ) : null}
      <GoogleSignIn />
      <form className="grid gap-4" noValidate onSubmit={onSubmit}>
        <Field id="companyName" label={t('signup.companyName')} error={errors.companyName}>
          {(aria) => <Input {...aria} {...bind('companyName')} autoComplete="organization" />}
        </Field>
        <div className="grid grid-cols-1 gap-3 min-[421px]:grid-cols-2">
          <Field id="name" label={t('signup.name')} error={errors.name}>
            {(aria) => <Input {...aria} {...bind('name')} autoComplete="name" />}
          </Field>
          <Field
            id="phone"
            label={
              <>
                {t('signup.phone')}{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  {t('signup.optional')}
                </span>
              </>
            }
            error={errors.phone}
          >
            {(aria) => (
              <Input
                {...aria}
                {...bind('phone')}
                autoComplete="tel"
                inputMode="tel"
                placeholder="09…"
              />
            )}
          </Field>
        </div>
        <Field id="email" label={t('signup.email')} error={errors.email}>
          {(aria) => <Input {...aria} {...bind('email')} type="email" autoComplete="email" />}
        </Field>
        <Field
          id="password"
          label={t('signup.password')}
          hint={t('signup.password.hint')}
          error={errors.password}
        >
          {(aria) => <PasswordInput {...aria} {...bind('password')} autoComplete="new-password" />}
        </Field>
        <div className="grid gap-1.5">
          <label className="grid grid-cols-[1.125rem_1fr] gap-2.5 text-sm text-muted-foreground">
            <input
              type="checkbox"
              name="terms"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              aria-invalid={Boolean(errors.terms)}
              aria-describedby={errors.terms ? 'terms-error' : undefined}
              className="mt-0.5 size-4.5 accent-primary"
            />
            <span>
              <span className="font-medium text-foreground">{t('signup.terms')}</span>
              <span className="mt-1.5 block text-xs">{t('signup.terms.note')}</span>
            </span>
          </label>
          {errors.terms ? (
            <span id="terms-error" className="text-xs text-destructive-ink">
              {errors.terms}
            </span>
          ) : null}
        </div>
        <Button type="submit" size="lg" block disabled={submitting} aria-busy={submitting}>
          {submitting ? (
            <>
              <Spinner />
              {t('signup.submitting')}
            </>
          ) : (
            t('signup.submit')
          )}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        {t('signup.haveAccount')} <Link to="/login">{t('signup.toLogin')}</Link>
      </p>
    </AuthLayout>
  );
}

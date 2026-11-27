import { companyInput } from '@dw/core/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { AuthHeader, AuthLayout } from '@/components/auth/auth-layout';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field, Input } from '@/components/ui/field';
import { t } from '@/i18n/t';
import { ApiError, api } from '@/lib/api';
import { type FieldErrors, fromZodIssues, toFieldErrors } from '@/lib/form-errors';
import { forgetMe, meQuery } from '@/lib/queries';

/** "Tạo công ty" for a signed-in user without a company (after Google, or a failed signup). */
export function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);
  const [name, setName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const parsed = companyInput.safeParse({ name, contactPhone });
    setErrors(
      parsed.success
        ? {}
        : toFieldErrors(
            fromZodIssues(parsed.error.issues).map((issue) =>
              issue.path === 'name' ? { ...issue, path: 'companyName' } : issue,
            ),
          ),
    );
    if (!parsed.success) return;
    setSubmitting(true);
    try {
      await api('/api/companies', { method: 'POST', body: parsed.data });
      forgetMe(queryClient);
      await navigate({ to: '/' });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ALREADY_IN_COMPANY') {
        forgetMe(queryClient);
        await navigate({ to: '/' });
        return;
      }
      setFailure(error instanceof ApiError ? t('app.error.generic') : t('app.error.network'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <AuthHeader
        eyebrow={t('onboarding.eyebrow')}
        title={t('onboarding.title')}
        lead={t('onboarding.lead')}
      />
      {me.data ? (
        <p className="text-sm text-muted-foreground">
          {t('onboarding.signedInAs')} <b className="text-foreground">{me.data.user.email}</b>
        </p>
      ) : null}
      {failure ? (
        <Callout tone="danger" role="alert">
          {failure}
        </Callout>
      ) : null}
      <form className="grid gap-4" noValidate onSubmit={onSubmit}>
        <Field id="companyName" label={t('signup.companyName')} error={errors.companyName}>
          {(aria) => (
            <Input
              {...aria}
              autoComplete="organization"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field
          id="contactPhone"
          label={`${t('signup.phone')} ${t('signup.optional')}`}
          error={errors.contactPhone}
        >
          {(aria) => (
            <Input
              {...aria}
              autoComplete="tel"
              inputMode="tel"
              value={contactPhone}
              onChange={(event) => setContactPhone(event.target.value)}
            />
          )}
        </Field>
        <Button type="submit" size="lg" block disabled={submitting} aria-busy={submitting}>
          {submitting ? (
            <>
              <Spinner />
              {t('onboarding.submitting')}
            </>
          ) : (
            t('onboarding.submit')
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}

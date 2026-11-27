import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { AuthHeader, AuthLayout } from '@/components/auth/auth-layout';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { t } from '@/i18n/t';
import { forgetMe } from '@/lib/queries';

type State = 'pending' | 'success' | 'used' | 'invalid';

/** Opens from the email link: /verify-email?token=… → asks Better Auth to verify it. */
export function VerifyEmailPage({ token }: { token: string | undefined }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>(token ? 'pending' : 'invalid');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
      credentials: 'same-origin',
    })
      .then(async (response) => {
        if (response.ok) {
          setState('success');
          forgetMe(queryClient);
          return;
        }
        const body = await response.json().catch(() => null);
        setState(body?.code === 'TOKEN_ALREADY_USED' ? 'used' : 'invalid');
      })
      .catch(() => setState('invalid'));
  }, [token, queryClient]);

  return (
    <AuthLayout>
      <AuthHeader eyebrow={t('app.name')} title={t('verify.title')} />
      <div aria-live="polite">
        {state === 'pending' ? <Callout tone="info">{t('verify.pending')}</Callout> : null}
        {state === 'success' ? (
          <Callout tone="info" role="status">
            {t('verify.success')}
          </Callout>
        ) : null}
        {state === 'used' ? <Callout tone="warning">{t('verify.used')}</Callout> : null}
        {state === 'invalid' ? <Callout tone="danger">{t('verify.invalid')}</Callout> : null}
      </div>
      {state !== 'pending' ? (
        <Button asChild size="lg" block>
          <Link to="/">{t('verify.continue')}</Link>
        </Button>
      ) : null}
    </AuthLayout>
  );
}

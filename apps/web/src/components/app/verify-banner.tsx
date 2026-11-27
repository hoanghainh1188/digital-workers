import { MailWarning } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n/t';
import { authClient } from '@/lib/auth-client';

type SendState = 'idle' | 'sending' | 'sent' | 'failed';

/** Shown in the app frame while the email is unverified (0.2 #033), with "Gửi lại". */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<SendState>('idle');

  async function resend() {
    setState('sending');
    const { error } = await authClient
      .sendVerificationEmail({ email })
      .catch(() => ({ error: true }));
    setState(error ? 'failed' : 'sent');
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[oklch(90%_0.06_85)] bg-warning-soft px-[clamp(1rem,0.5rem+3vw,3rem)] py-3 text-sm text-warning-ink"
    >
      <MailWarning aria-hidden="true" className="size-4.5 shrink-0" />
      <p className="min-w-0 flex-1">
        {t('banner.verify')} <b className="break-all">{email}</b>.
      </p>
      {state === 'sent' ? <span className="font-medium">{t('banner.sent')}</span> : null}
      {state === 'failed' ? <span className="font-medium">{t('banner.failed')}</span> : null}
      <Button
        type="button"
        variant="outline"
        className="h-8 bg-background"
        disabled={state === 'sending'}
        onClick={resend}
      >
        {state === 'sending' ? t('banner.sending') : t('banner.resend')}
      </Button>
    </div>
  );
}

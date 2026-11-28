import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Building2, CircleDollarSign, KeyRound, LogOut, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { initials } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { t } from '@/i18n/t';
import { ApiError } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { type Me, meQuery } from '@/lib/queries';

const link =
  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium whitespace-nowrap text-[oklch(80%_0.015_258)] no-underline transition-colors duration-150 hover:bg-[oklch(30%_0.03_262)] hover:text-white';
const active =
  'bg-[oklch(33%_0.04_262)] text-white shadow-[inset_2px_0_0_oklch(80%_0.15_75)] hover:bg-[oklch(33%_0.04_262)]';
const group =
  'hidden px-2.5 pt-3 pb-1 text-[0.6875rem] font-semibold tracking-[0.06em] text-[oklch(70%_0.02_258)] uppercase min-[901px]:block';

/**
 * Platform admin frame (docs/design/screens/platform-admin.html): a dark rail with an
 * amber accent, so it is never confused with a company's workspace.
 */
export function PlatformShell({ me, children }: { me: Me; children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await authClient.signOut().catch(() => null);
    queryClient.clear();
    queryClient.setQueryData(meQuery.queryKey, null);
    await navigate({ to: '/login' });
  }

  return (
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] bg-canvas min-[901px]:grid-cols-[15.5rem_minmax(0,1fr)]">
      <aside className="flex min-w-0 items-center gap-3 overflow-x-auto border-b border-[oklch(30%_0.03_262)] bg-[oklch(23%_0.03_262)] px-4 py-3 text-[oklch(92%_0.01_258)] min-[901px]:sticky min-[901px]:top-0 min-[901px]:h-dvh min-[901px]:flex-col min-[901px]:items-stretch min-[901px]:gap-4 min-[901px]:overflow-visible min-[901px]:border-r min-[901px]:border-b-0 min-[901px]:px-3.5 min-[901px]:py-5">
        <div className="flex items-center gap-2.5 px-2 font-bold tracking-tight whitespace-nowrap">
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-[9px] bg-[linear-gradient(145deg,oklch(80%_0.15_75),oklch(66%_0.16_55))] text-[0.8rem] font-bold text-[oklch(25%_0.05_60)]"
          >
            DW
          </span>
          <span className="hidden min-[901px]:inline">{t('platform.brand')}</span>
        </div>
        <p className="hidden items-center gap-2 rounded-lg bg-[oklch(80%_0.15_75/0.14)] px-2.5 py-2 text-xs font-semibold text-[oklch(86%_0.12_80)] min-[901px]:flex">
          <ShieldAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {t('platform.env')}
        </p>
        <nav
          aria-label={t('platform.nav.label')}
          className="flex gap-1 min-[901px]:grid min-[901px]:gap-0.5"
        >
          <h2 className={group}>{t('platform.nav.ops')}</h2>
          <Link to="/platform/companies" className={link} activeProps={{ className: active }}>
            <Building2 aria-hidden="true" className="size-4.25 shrink-0" />
            <span className="max-[560px]:sr-only">{t('platform.nav.companies')}</span>
          </Link>
          <h2 className={group}>{t('platform.nav.models')}</h2>
          <Link to="/platform/pricing" className={link} activeProps={{ className: active }}>
            <CircleDollarSign aria-hidden="true" className="size-4.25 shrink-0" />
            <span className="max-[560px]:sr-only">{t('platform.nav.pricing')}</span>
          </Link>
          <Link to="/platform/keys" className={link} activeProps={{ className: active }}>
            <KeyRound aria-hidden="true" className="size-4.25 shrink-0" />
            <span className="max-[560px]:sr-only">{t('platform.nav.keys')}</span>
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-2.5 text-sm min-[901px]:mt-auto min-[901px]:ml-0 min-[901px]:p-2">
          <span className="hidden size-9 shrink-0 place-items-center rounded-full bg-[oklch(80%_0.15_75/0.2)] text-xs font-semibold text-[oklch(86%_0.12_80)] min-[901px]:grid">
            {initials(me.user.name)}
          </span>
          <span className="hidden min-w-0 flex-1 min-[901px]:block">
            <b className="block truncate font-semibold">{me.user.name}</b>
            <small className="block truncate text-xs text-[oklch(70%_0.02_258)]">
              {t('platform.role')}
            </small>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-[oklch(80%_0.015_258)] hover:bg-[oklch(30%_0.03_262)] hover:text-white"
            aria-label={t('shell.signOut')}
            title={t('shell.signOut')}
            onClick={signOut}
          >
            <LogOut />
          </Button>
        </div>
      </aside>
      <main className="w-full min-w-0 max-w-[76rem] px-[clamp(1rem,0.5rem+3vw,3rem)] pt-[clamp(1.25rem,1rem+2vw,2.5rem)] pb-16">
        {children}
      </main>
    </div>
  );
}

/** A failed platform query: 401 REAUTH_REQUIRED (12 h passed) asks to sign in again. */
export function PlatformError({ error }: { error: unknown }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  if (error instanceof ApiError && error.code === 'REAUTH_REQUIRED') {
    return (
      <Callout tone="warning" role="alert">
        <p>{t('platform.reauth')}</p>
        <Button
          type="button"
          variant="outline"
          className="mt-3 bg-background"
          onClick={async () => {
            await authClient.signOut().catch(() => null);
            queryClient.clear();
            await navigate({ to: '/login' });
          }}
        >
          {t('platform.reauth.cta')}
        </Button>
      </Callout>
    );
  }
  return (
    <Callout tone="danger" role="alert">
      {t('app.error.generic')}
    </Callout>
  );
}

export const platformCard =
  'rounded-[calc(var(--radius)+4px)] border bg-card shadow-[var(--shadow-card)]';

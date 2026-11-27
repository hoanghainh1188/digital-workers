import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Bot, House, LogOut, Users } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { BrandMark } from '@/components/auth/auth-layout';
import { RoleBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { t } from '@/i18n/t';
import { authClient } from '@/lib/auth-client';
import type { Me } from '@/lib/queries';
import { meQuery } from '@/lib/queries';
import { VerifyEmailBanner } from './verify-banner.tsx';

type SignedInMe = Me & { member: NonNullable<Me['member']>; company: NonNullable<Me['company']> };

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const letters = words.length > 1 ? [words[0], words.at(-1)] : [words[0]];
  return letters
    .map((word) => word?.[0] ?? '')
    .join('')
    .toUpperCase();
}

const soonLinks = [
  { label: 'shell.nav.workers', Icon: Bot },
  { label: 'shell.nav.people', Icon: Users },
] as const;

/** App frame with sidebar (from _shared.css .app / .sidebar). */
export function AppShell({ me, children }: { me: SignedInMe; children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [signOutFailed, setSignOutFailed] = useState(false);

  async function signOut() {
    // The client returns { error } on 4xx/5xx instead of throwing: only leave when the
    // server really ended the session.
    const result = await authClient.signOut().catch(() => ({ error: true }));
    if (result.error) {
      setSignOutFailed(true);
      return;
    }
    queryClient.setQueryData(meQuery.queryKey, null);
    await navigate({ to: '/login' });
  }

  return (
    <div className="grid min-h-dvh grid-cols-1 bg-canvas min-[901px]:grid-cols-[15.5rem_minmax(0,1fr)]">
      <aside className="flex items-center gap-3 overflow-x-auto border-b bg-background px-4 py-3 min-[901px]:sticky min-[901px]:top-0 min-[901px]:h-dvh min-[901px]:flex-col min-[901px]:items-stretch min-[901px]:gap-5 min-[901px]:overflow-visible min-[901px]:border-r min-[901px]:border-b-0 min-[901px]:px-3.5 min-[901px]:py-5">
        <div className="flex items-center gap-2.5 px-2 font-bold tracking-tight whitespace-nowrap">
          <BrandMark />
          <span className="hidden min-[901px]:inline">{t('app.name')}</span>
        </div>
        <div className="hidden items-center gap-2.5 rounded-lg border bg-canvas p-2 text-sm min-[901px]:flex">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-[0.7rem] font-semibold text-primary-ink">
            {initials(me.company.name)}
          </span>
          <span className="min-w-0">
            <b className="block truncate font-semibold">{me.company.name}</b>
            <RoleBadge role={me.member.role} className="mt-0.5 h-5" />
          </span>
        </div>
        <nav
          aria-label={t('shell.nav.label')}
          className="flex gap-1 min-[901px]:grid min-[901px]:gap-0.5"
        >
          <h2 className="hidden px-2.5 pb-1 text-[0.6875rem] font-semibold tracking-[0.06em] text-muted-foreground uppercase min-[901px]:block">
            {t('shell.nav.group')}
          </h2>
          <Link
            to="/"
            aria-current="page"
            className="flex items-center gap-2.5 rounded-lg bg-primary-soft px-2.5 py-2 text-sm font-medium whitespace-nowrap text-primary-ink no-underline"
          >
            <House aria-hidden="true" className="size-4.25 shrink-0" />
            {t('shell.nav.home')}
          </Link>
          {soonLinks.map(({ label, Icon }) => (
            <span
              key={label}
              aria-disabled="true"
              className="hidden items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground min-[901px]:flex"
            >
              <Icon aria-hidden="true" className="size-4.25 shrink-0" />
              {t(label)}
              <span className="ml-auto text-[0.625rem] font-semibold opacity-80">
                {t('shell.nav.soon')}
              </span>
            </span>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2.5 text-sm min-[901px]:mt-auto min-[901px]:ml-0 min-[901px]:p-2">
          <span className="hidden size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary-ink min-[901px]:grid">
            {initials(me.user.name)}
          </span>
          <span className="hidden min-w-0 flex-1 min-[901px]:block">
            <b className="block truncate font-semibold">{me.user.name}</b>
            <small className="block truncate text-xs text-muted-foreground">{me.user.email}</small>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('shell.signOut')}
            title={t('shell.signOut')}
            onClick={signOut}
          >
            <LogOut />
          </Button>
        </div>
      </aside>
      <div className="min-w-0">
        {signOutFailed ? (
          <Callout tone="danger" role="alert" className="rounded-none">
            {t('shell.signOut.failed')}
          </Callout>
        ) : null}
        {me.user.emailVerified ? null : <VerifyEmailBanner email={me.user.email} />}
        <main className="w-full max-w-[76rem] px-[clamp(1rem,0.5rem+3vw,3rem)] pt-[clamp(1.25rem,1rem+2vw,2.5rem)] pb-16">
          {children}
        </main>
      </div>
    </div>
  );
}

export type { SignedInMe };

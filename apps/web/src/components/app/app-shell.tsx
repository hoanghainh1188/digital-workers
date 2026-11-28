import { can } from '@dw/core/permissions';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Bot, Building2, House, LogOut, Users } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { BrandMark } from '@/components/auth/auth-layout';
import { initials } from '@/components/ui/avatar';
import { RoleBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { t } from '@/i18n/t';
import { authClient } from '@/lib/auth-client';
import type { Me } from '@/lib/queries';
import { meQuery } from '@/lib/queries';
import { VerifyEmailBanner } from './verify-banner.tsx';

type SignedInMe = Me & { member: NonNullable<Me['member']>; company: NonNullable<Me['company']> };

const navLinkClass =
  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground no-underline transition-colors duration-150 hover:bg-muted hover:text-foreground';
const navActiveClass =
  'bg-primary-soft text-primary-ink hover:bg-primary-soft hover:text-primary-ink';
const navGroupClass =
  'hidden px-2.5 pt-3 pb-1 text-[0.6875rem] font-semibold tracking-[0.06em] text-muted-foreground uppercase min-[901px]:block';

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
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] bg-canvas min-[901px]:grid-cols-[15.5rem_minmax(0,1fr)]">
      <aside className="flex min-w-0 items-center gap-3 overflow-x-auto border-b bg-background px-4 py-3 min-[901px]:sticky min-[901px]:top-0 min-[901px]:h-dvh min-[901px]:flex-col min-[901px]:items-stretch min-[901px]:gap-5 min-[901px]:overflow-visible min-[901px]:border-r min-[901px]:border-b-0 min-[901px]:px-3.5 min-[901px]:py-5">
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
            activeOptions={{ exact: true }}
            className={navLinkClass}
            activeProps={{ className: navActiveClass }}
          >
            <House aria-hidden="true" className="size-4.25 shrink-0" />
            <span className="max-[560px]:sr-only">{t('shell.nav.home')}</span>
          </Link>
          <Link to="/workers" className={navLinkClass} activeProps={{ className: navActiveClass }}>
            <Bot aria-hidden="true" className="size-4.25 shrink-0" />
            <span className="max-[560px]:sr-only">{t('shell.nav.orgChart')}</span>
          </Link>
          <h2 className={navGroupClass}>{t('shell.nav.company')}</h2>
          <Link
            to="/departments"
            className={navLinkClass}
            activeProps={{ className: navActiveClass }}
          >
            <Building2 aria-hidden="true" className="size-4.25 shrink-0" />
            <span className="max-[560px]:sr-only">{t('shell.nav.departments')}</span>
          </Link>
          {/* Nhân viên do not see the Người dùng page (0.2 #038, #068). */}
          {can(me.member.role, 'member.list') === false ? null : (
            <Link to="/users" className={navLinkClass} activeProps={{ className: navActiveClass }}>
              <Users aria-hidden="true" className="size-4.25 shrink-0" />
              <span className="max-[560px]:sr-only">{t('shell.nav.people')}</span>
            </Link>
          )}
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

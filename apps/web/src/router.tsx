import { ROLES } from '@dw/core/permissions';
import { RISK_LEVELS, SKILL_STATUSES } from '@dw/core/skills';
import { WORKER_STATUSES } from '@dw/core/workers';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { AppShell, type SignedInMe } from '@/components/app/app-shell';
import { NotFoundPage } from '@/components/app/not-found';
import { PlatformShell } from '@/components/platform/platform-shell';
import { Callout } from '@/components/ui/callout';
import { t } from '@/i18n/t';
import { type Me, meQuery } from '@/lib/queries';
import { CreditPage } from '@/pages/credit';
import { DepartmentsPage } from '@/pages/departments';
import { ForgotPasswordPage } from '@/pages/forgot-password';
import { HomePage } from '@/pages/home';
import { InvitePage } from '@/pages/invite';
import { LoginPage } from '@/pages/login';
import { OnboardingPage } from '@/pages/onboarding';
import { PlatformCompaniesPage } from '@/pages/platform-companies';
import { PlatformKeysPage } from '@/pages/platform-keys';
import { PlatformPricingPage } from '@/pages/platform-pricing';
import { PlatformSetup2faPage } from '@/pages/platform-setup-2fa';
import { ResetPasswordPage } from '@/pages/reset-password';
import { SignupPage } from '@/pages/signup';
import { SkillDetailPage } from '@/pages/skill-detail';
import { SkillEditorPage } from '@/pages/skill-editor';
import { SkillsPage } from '@/pages/skills';
import { TwoFactorPage } from '@/pages/two-factor';
import { UsersPage } from '@/pages/users';
import { VerifyEmailPage } from '@/pages/verify-email';
import { WorkerProfilePage } from '@/pages/worker-profile';
import { WorkersPage } from '@/pages/workers';

type RouterContext = { queryClient: QueryClient };

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
  errorComponent: () => (
    <div className="mx-auto max-w-md p-6">
      <Callout tone="danger" role="alert">
        {t('app.error.generic')}
      </Callout>
    </div>
  ),
});

const loadMe = (context: RouterContext) => context.queryClient.ensureQueryData(meQuery);

/** Signed-in users skip the sign-in / sign-up pages. */
const guestOnly = async ({ context }: { context: RouterContext }) => {
  if (await loadMe(context)) throw redirect({ to: '/' });
};

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signup',
  beforeLoad: guestOnly,
  component: SignupPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: guestOnly,
  component: LoginPage,
});

/** Where a platform admin belongs: TOTP setup until it is on, then the admin pages. */
function platformHome(me: Me): '/platform/setup-2fa' | '/platform/companies' {
  return me.platformAdmin?.twoFactorEnabled ? '/platform/companies' : '/platform/setup-2fa';
}

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  beforeLoad: async ({ context }) => {
    const me = await loadMe(context);
    if (!me) throw redirect({ to: '/login' });
    if (me.platformAdmin) throw redirect({ to: platformHome(me) });
    if (me.member) throw redirect({ to: '/' });
  },
  component: OnboardingPage,
});

const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/verify-email',
  validateSearch: z.object({ token: z.string().optional() }),
  component: function VerifyEmailRoute() {
    const { token } = verifyEmailRoute.useSearch();
    return <VerifyEmailPage token={token} />;
  },
});

// Design D9: not signed in → /login; signed in without a company → /onboarding.
const requireCompany = async ({ context }: { context: RouterContext }) => {
  const me = await loadMe(context);
  if (!me) throw redirect({ to: '/login' });
  if (me.platformAdmin) throw redirect({ to: platformHome(me) });
  if (!me.member || !me.company) throw redirect({ to: '/onboarding' });
};

/** Renders the page inside the app frame once `me` is a member of a company. */
function InApp({ render }: { render: (me: SignedInMe) => ReactNode }) {
  const { data: me } = useQuery(meQuery);
  if (!me?.member || !me.company) return null;
  const signedIn = me as SignedInMe;
  return <AppShell me={signedIn}>{render(signedIn)}</AppShell>;
}

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: requireCompany,
  component: () => <InApp render={(me) => <HomePage me={me} />} />,
});

const departmentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/departments',
  beforeLoad: requireCompany,
  component: () => <InApp render={(me) => <DepartmentsPage me={me} />} />,
});

/** The status filter lives in the URL (spec worker-profile "Lọc theo trạng thái"). */
const workersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workers',
  validateSearch: z.object({
    status: z
      .enum(WORKER_STATUSES.filter((status) => status !== 'offboarded') as [string, ...string[]])
      .optional()
      .catch(undefined),
  }),
  beforeLoad: requireCompany,
  component: function WorkersRoute() {
    const { status } = workersRoute.useSearch();
    return (
      <InApp
        render={(me) => (
          <WorkersPage me={me} status={status as Parameters<typeof WorkersPage>[0]['status']} />
        )}
      />
    );
  },
});

const workerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workers/$id',
  beforeLoad: requireCompany,
  component: function WorkerRoute() {
    const { id } = workerRoute.useParams();
    return <InApp render={(me) => <WorkerProfilePage key={id} me={me} id={id} />} />;
  },
});

/** Library filters live in the URL (spec skill-library "Lọc theo rủi ro"). */
const skillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/skills',
  validateSearch: z.object({
    tab: z.enum(['company', 'templates']).optional().catch(undefined),
    q: z.string().max(100).optional().catch(undefined),
    status: z.enum(SKILL_STATUSES).optional().catch(undefined),
    risk: z.enum(RISK_LEVELS).optional().catch(undefined),
  }),
  beforeLoad: requireCompany,
  component: function SkillsRoute() {
    const search = skillsRoute.useSearch();
    return <InApp render={(me) => <SkillsPage me={me} search={search} />} />;
  },
});

const skillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/skills/$id',
  validateSearch: z.object({ v: z.coerce.number().int().min(1).optional().catch(undefined) }),
  beforeLoad: requireCompany,
  component: function SkillRoute() {
    const { id } = skillRoute.useParams();
    const { v } = skillRoute.useSearch();
    return <InApp render={(me) => <SkillDetailPage key={id} me={me} id={id} version={v} />} />;
  },
});

const skillEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/skills/$id/edit',
  beforeLoad: requireCompany,
  component: function SkillEditRoute() {
    const { id } = skillEditRoute.useParams();
    return <InApp render={() => <SkillEditorPage key={id} id={id} />} />;
  },
});

/** Filters live in the URL so a filtered list can be shared (spec member-management). */
const usersSearch = z.object({
  q: z.string().max(100).optional().catch(undefined),
  role: z.enum(ROLES).optional().catch(undefined),
  department: z
    .union([z.uuid(), z.literal('none')])
    .optional()
    .catch(undefined),
  status: z.enum(['active', 'invited', 'locked']).optional().catch(undefined),
});
export type UsersSearch = z.output<typeof usersSearch>;

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users',
  validateSearch: usersSearch,
  beforeLoad: async ({ context }) => {
    await requireCompany({ context });
    // Nhân viên do not open the Người dùng page (0.2 #038).
    const me = await loadMe(context);
    if (me?.member?.role === 'member') throw redirect({ to: '/' });
  },
  component: function UsersRoute() {
    const search = usersRoute.useSearch();
    return <InApp render={(me) => <UsersPage me={me} search={search} />} />;
  },
});

/** History filters live in the URL (spec credit-ledger "Lịch sử credit"). */
const creditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/credit',
  validateSearch: z.object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional()
      .catch(undefined),
    type: z.enum(['all', 'credit', 'usage']).optional().catch(undefined),
  }),
  beforeLoad: async ({ context }) => {
    await requireCompany({ context });
    // Owner and Admin only (credit.view); Trưởng phòng / Nhân viên go home.
    const role = (await loadMe(context))?.member?.role;
    if (role !== 'owner' && role !== 'admin') throw redirect({ to: '/' });
  },
  component: function CreditRoute() {
    const search = creditRoute.useSearch();
    return <InApp render={(me) => <CreditPage me={me} search={search} />} />;
  },
});

/** Second sign-in step; reachable only with Better Auth's challenge cookie. */
const twoFactorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/two-factor',
  beforeLoad: guestOnly,
  component: TwoFactorPage,
});

/**
 * Platform admin pages (design D10). Anyone else gets the not-found page, the same as
 * for a path that does not exist; the API answers 404 to them as well.
 */
function InPlatform({ render }: { render: () => ReactNode }) {
  const { data: me } = useQuery(meQuery);
  if (!me?.platformAdmin?.twoFactorEnabled) return <NotFoundPage />;
  return <PlatformShell me={me}>{render()}</PlatformShell>;
}

const requirePlatformAdmin = async ({ context }: { context: RouterContext }) => {
  const me = await loadMe(context);
  if (me?.platformAdmin && !me.platformAdmin.twoFactorEnabled) {
    throw redirect({ to: '/platform/setup-2fa' });
  }
};

const platformSetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/platform/setup-2fa',
  beforeLoad: async ({ context }) => {
    const me = await loadMe(context);
    if (!me) throw redirect({ to: '/login' });
    if (me.platformAdmin?.twoFactorEnabled) throw redirect({ to: '/platform/companies' });
  },
  component: function PlatformSetupRoute() {
    const { data: me } = useQuery(meQuery);
    if (!me) return null;
    return me.platformAdmin ? <PlatformSetup2faPage me={me} /> : <NotFoundPage />;
  },
});

const platformCompaniesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/platform/companies',
  validateSearch: z.object({
    state: z.enum(['all', 'normal', 'low', 'exhausted']).optional().catch(undefined),
    q: z.string().max(100).optional().catch(undefined),
  }),
  beforeLoad: requirePlatformAdmin,
  component: function PlatformCompaniesRoute() {
    const search = platformCompaniesRoute.useSearch();
    return <InPlatform render={() => <PlatformCompaniesPage search={search} />} />;
  },
});

const platformPricingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/platform/pricing',
  beforeLoad: requirePlatformAdmin,
  component: () => <InPlatform render={() => <PlatformPricingPage />} />,
});

const platformKeysRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/platform/keys',
  beforeLoad: requirePlatformAdmin,
  component: () => <InPlatform render={() => <PlatformKeysPage />} />,
});

// The token is read from location.hash (#token=…) by the page: never sent to the server in a URL.
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite',
  component: InvitePage,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  beforeLoad: guestOnly,
  component: ForgotPasswordPage,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  validateSearch: z.object({
    token: z.string().max(200).optional().catch(undefined),
    error: z.string().max(50).optional().catch(undefined),
  }),
  component: function ResetPasswordRoute() {
    const { token, error } = resetPasswordRoute.useSearch();
    return <ResetPasswordPage token={error ? undefined : token} />;
  },
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  departmentsRoute,
  workersRoute,
  workerRoute,
  skillsRoute,
  skillRoute,
  skillEditRoute,
  usersRoute,
  creditRoute,
  twoFactorRoute,
  platformSetupRoute,
  platformCompaniesRoute,
  platformPricingRoute,
  platformKeysRoute,
  inviteRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  signupRoute,
  loginRoute,
  onboardingRoute,
  verifyEmailRoute,
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

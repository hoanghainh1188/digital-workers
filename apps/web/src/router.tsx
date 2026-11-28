import { ROLES } from '@dw/core/permissions';
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
import { Callout } from '@/components/ui/callout';
import { t } from '@/i18n/t';
import { meQuery } from '@/lib/queries';
import { DepartmentsPage } from '@/pages/departments';
import { ForgotPasswordPage } from '@/pages/forgot-password';
import { HomePage } from '@/pages/home';
import { InvitePage } from '@/pages/invite';
import { LoginPage } from '@/pages/login';
import { OnboardingPage } from '@/pages/onboarding';
import { ResetPasswordPage } from '@/pages/reset-password';
import { SignupPage } from '@/pages/signup';
import { UsersPage } from '@/pages/users';
import { VerifyEmailPage } from '@/pages/verify-email';
import { WorkerProfilePage } from '@/pages/worker-profile';
import { WorkersPage } from '@/pages/workers';

type RouterContext = { queryClient: QueryClient };

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
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

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  beforeLoad: async ({ context }) => {
    const me = await loadMe(context);
    if (!me) throw redirect({ to: '/login' });
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
  usersRoute,
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

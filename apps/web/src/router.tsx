import { type QueryClient, useQuery } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { z } from 'zod';
import { AppShell, type SignedInMe } from '@/components/app/app-shell';
import { Callout } from '@/components/ui/callout';
import { t } from '@/i18n/t';
import { meQuery } from '@/lib/queries';
import { HomePage } from '@/pages/home';
import { LoginPage } from '@/pages/login';
import { OnboardingPage } from '@/pages/onboarding';
import { SignupPage } from '@/pages/signup';
import { VerifyEmailPage } from '@/pages/verify-email';

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
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: async ({ context }) => {
    const me = await loadMe(context);
    if (!me) throw redirect({ to: '/login' });
    if (!me.member || !me.company) throw redirect({ to: '/onboarding' });
  },
  component: function HomeRoute() {
    const { data: me } = useQuery(meQuery);
    if (!me?.member || !me.company) return null;
    const signedIn = me as SignedInMe;
    return (
      <AppShell me={signedIn}>
        <HomePage me={signedIn} />
      </AppShell>
    );
  },
});

const routeTree = rootRoute.addChildren([
  homeRoute,
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

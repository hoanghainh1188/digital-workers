import { acceptInvitationInput } from '@dw/core/org-schemas';
import type { Role } from '@dw/core/permissions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { CalendarX2, Link2Off } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { AuthHeader, AuthLayout, Divider } from '@/components/auth/auth-layout';
import { GoogleLogo } from '@/components/auth/google-button';
import { PasswordInput } from '@/components/auth/password-input';
import { Avatar } from '@/components/ui/avatar';
import { RoleBadge } from '@/components/ui/badge';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field, Input } from '@/components/ui/field';
import { t } from '@/i18n/t';
import type { MessageKey } from '@/i18n/vi';
import { ApiError, api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { type FieldErrors, fromZodIssues, toFieldErrors } from '@/lib/form-errors';
import { forgetMe, meQuery, publicConfigQuery } from '@/lib/queries';

/** Survives the round trip to Google; cleared once the invitation is used (design D4). */
const TOKEN_KEY = 'dw.invite.token';
const GOOGLE_KEY = 'dw.invite.google';

type Preview = {
  companyName: string;
  inviterName: string;
  email: string;
  role: Role;
  departmentName: string | null;
  expiresAt: string;
};

const ACCEPT_ERRORS: Readonly<Record<string, MessageKey>> = {
  EMAIL_TAKEN: 'invite.error.emailTaken',
  ALREADY_IN_COMPANY: 'invite.error.otherCompany',
  INVITATION_EMAIL_MISMATCH: 'invite.error.mismatch',
  DEPARTMENT_HAS_HEAD: 'invite.error.headTaken',
};

/** Token from `#token=…` (moved to sessionStorage and removed from the address bar). */
function readToken(): string | null {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (fromHash) {
    sessionStorage.setItem(TOKEN_KEY, fromHash);
    window.history.replaceState(null, '', window.location.pathname);
    return fromHash;
  }
  return sessionStorage.getItem(TOKEN_KEY);
}

function forgetToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(GOOGLE_KEY);
}

/** Nhận lời mời (signup.html, flow "Nhận lời mời"; spec invitations). */
export function InvitePage() {
  const [token] = useState(readToken);
  const preview = useQuery({
    queryKey: ['invitation-preview', token],
    enabled: token !== null,
    retry: false,
    queryFn: () => api<Preview>('/api/invitations/preview', { method: 'POST', body: { token } }),
  });

  if (!token) return <Unusable kind="invalid" />;
  if (preview.isPending) {
    return (
      <AuthLayout>
        <p className="text-muted-foreground">{t('invite.loading')}</p>
      </AuthLayout>
    );
  }
  if (preview.error) {
    // Only a 410 means the link is dead; a 429 or network error keeps the token for a retry.
    if (!(preview.error instanceof ApiError) || preview.error.status !== 410) {
      return (
        <AuthLayout>
          <Callout tone="danger" role="alert">
            {preview.error instanceof ApiError ? t('app.error.generic') : t('app.error.network')}
          </Callout>
          <Button type="button" variant="outline" onClick={() => preview.refetch()}>
            {t('invite.retry')}
          </Button>
        </AuthLayout>
      );
    }
    const expired = preview.error.code === 'INVITATION_EXPIRED';
    return <Unusable kind={expired ? 'expired' : 'invalid'} />;
  }
  return <AcceptInvitation token={token} invitation={preview.data} />;
}

function Unusable({ kind }: { kind: 'expired' | 'invalid' }) {
  useEffect(forgetToken, []);
  const Icon = kind === 'expired' ? CalendarX2 : Link2Off;
  return (
    <AuthLayout>
      <section className="grid justify-items-start gap-4" aria-labelledby="unusable-title">
        <span className="grid size-12 place-items-center rounded-xl bg-warning-soft text-warning-ink">
          <Icon aria-hidden="true" className="size-6" />
        </span>
        <h2
          id="unusable-title"
          className="text-[length:var(--text-title)] font-bold tracking-[-0.02em]"
        >
          {kind === 'expired' ? t('invite.expired.title') : t('invite.invalid.title')}
        </h2>
        <p className="text-muted-foreground">
          {kind === 'expired' ? t('invite.expired.body') : t('invite.invalid.body')}
        </p>
        <Button asChild variant="outline">
          <Link to="/login">{t('invite.toLogin')}</Link>
        </Button>
      </section>
    </AuthLayout>
  );
}

function AcceptInvitation({ token, invitation }: { token: string; invitation: Preview }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery(meQuery);
  const config = useQuery(publicConfigQuery);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: (body: { token: string; name?: string; password?: string }) =>
      api<{ companyId: string }>('/api/invitations/accept', { method: 'POST', body }),
    onSuccess: async () => {
      forgetToken();
      forgetMe(queryClient);
      await navigate({ to: '/' });
    },
    onError: (error) => {
      // An account may have been created before the membership step failed: refetch `me`
      // so a retry goes through the signed-in path (design D4).
      forgetMe(queryClient);
      if (error instanceof ApiError && error.details.length > 0) {
        setErrors(toFieldErrors(error.details));
        return;
      }
      const key = error instanceof ApiError ? ACCEPT_ERRORS[error.code] : undefined;
      setFailure(
        key ? t(key) : error instanceof ApiError ? t('app.error.generic') : t('app.error.network'),
      );
    },
  });

  const { mutate } = accept;
  const signedIn = me.data ?? null;
  const sameEmail = signedIn?.user.email.toLowerCase() === invitation.email;

  // Back from Google with the invited email: finish without another click.
  useEffect(() => {
    if (signedIn && !signedIn.member && sameEmail && sessionStorage.getItem(GOOGLE_KEY)) {
      sessionStorage.removeItem(GOOGLE_KEY);
      mutate({ token });
    }
  }, [signedIn, sameEmail, token, mutate]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const parsed = acceptInvitationInput.safeParse({ token, name, password });
    if (!parsed.success) {
      setErrors(toFieldErrors(fromZodIssues(parsed.error.issues)));
      return;
    }
    setErrors({});
    accept.mutate(parsed.data);
  }

  function withGoogle() {
    sessionStorage.setItem(GOOGLE_KEY, '1');
    void authClient.signIn.social({ provider: 'google', callbackURL: '/invite' });
  }

  async function signOut() {
    await authClient.signOut().catch(() => null);
    forgetMe(queryClient);
  }

  return (
    <AuthLayout>
      <AuthHeader eyebrow={t('invite.eyebrow')} title={t('invite.title')} lead={t('invite.lead')} />
      <InvitationCard invitation={invitation} />
      {failure ? (
        <Callout tone="danger" role="alert">
          {failure}
        </Callout>
      ) : null}

      {signedIn ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            {t('invite.signedInAs')} <b className="text-foreground">{signedIn.user.email}</b>
          </p>
          {sameEmail && !signedIn.member ? (
            <SubmitButton busy={accept.isPending} onClick={() => accept.mutate({ token })}>
              {t('invite.acceptSignedIn')}
            </SubmitButton>
          ) : (
            <>
              {failure ? null : (
                <Callout tone="warning">
                  {signedIn.member ? t('invite.error.otherCompany') : t('invite.error.mismatch')}
                </Callout>
              )}
              <Button type="button" variant="outline" onClick={signOut}>
                {t('invite.signOut')}
              </Button>
            </>
          )}
        </div>
      ) : (
        <form className="grid gap-4" noValidate onSubmit={onSubmit}>
          <Field id="inv-email" label={t('signup.email')} hint={t('invite.email.hint')}>
            {(aria) => <Input {...aria} type="email" value={invitation.email} readOnly />}
          </Field>
          <Field id="inv-name" label={t('signup.name')} error={errors.name}>
            {(aria) => (
              <Input
                {...aria}
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Field
            id="inv-password"
            label={t('signup.password')}
            hint={t('signup.password.hint')}
            error={errors.password}
          >
            {(aria) => (
              <PasswordInput
                {...aria}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
          <SubmitButton busy={accept.isPending}>{t('invite.submit')}</SubmitButton>
          {config.data?.googleEnabled ? (
            <>
              <Divider>{t('invite.divider')}</Divider>
              <Button type="button" variant="google" block onClick={withGoogle}>
                <GoogleLogo />
                {t('invite.google')} ({invitation.email})
              </Button>
            </>
          ) : null}
        </form>
      )}
    </AuthLayout>
  );
}

function SubmitButton({
  busy,
  onClick,
  children,
}: {
  busy: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type={onClick ? 'button' : 'submit'}
      size="lg"
      block
      disabled={busy}
      aria-busy={busy}
      onClick={onClick}
    >
      {busy ? (
        <>
          <Spinner />
          {t('invite.submitting')}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

function InvitationCard({ invitation }: { invitation: Preview }) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-3.5 rounded-lg border bg-canvas p-4">
      <Avatar name={invitation.companyName} className="size-11 rounded-xl text-sm" />
      <div className="min-w-0">
        <b className="block truncate">{invitation.companyName}</b>
        <small className="text-sm text-muted-foreground">
          {invitation.inviterName} {t('invite.invitedBy')}
        </small>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <RoleBadge role={invitation.role} />
          {invitation.departmentName ? (
            <span className="inline-flex h-6 items-center rounded-md bg-muted px-2 text-xs font-semibold text-muted-foreground">
              {t('invite.department')} {invitation.departmentName}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

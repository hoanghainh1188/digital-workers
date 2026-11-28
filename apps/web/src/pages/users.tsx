import { canManageMember } from '@dw/core/member-rules';
import { can, ROLES, type Role } from '@dw/core/permissions';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Search, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SignedInMe } from '@/components/app/app-shell';
import { PageHeader } from '@/components/app/page-header';
import { Avatar } from '@/components/ui/avatar';
import { RoleBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Select } from '@/components/ui/field';
import { type MenuItem, RowMenu } from '@/components/ui/menu';
import { InviteDialog } from '@/components/users/invite-dialog';
import {
  LastOwnerDialog,
  LockDialog,
  MoveDialog,
  RoleDialog,
} from '@/components/users/member-dialogs';
import {
  type InviteResult,
  useInvitationAction,
  useMemberAction,
} from '@/components/users/use-members';
import { t, tf } from '@/i18n/t';
import { apiErrorMessage } from '@/lib/form-errors';
import {
  dayMonth,
  daysLeft,
  departmentsQuery,
  filterInvitations,
  type InvitationRow,
  invitationsQuery,
  type MemberRow,
  membersQuery,
  seenLabel,
} from '@/lib/org';
import type { UsersSearch } from '@/router';

type Open =
  | { kind: 'invite' }
  | { kind: 'role' | 'move' | 'lock'; member: MemberRow }
  | { kind: 'lastOwner' }
  | null;

const cell = 'px-4 py-3 align-middle';
const headCell =
  'px-4 py-2.5 text-left text-[0.6875rem] font-semibold tracking-[0.05em] text-muted-foreground uppercase';

/** Người dùng (docs/design/screens/users.html, spec member-management). */
export function UsersPage({ me, search }: { me: SignedInMe; search: UsersSearch }) {
  const navigate = useNavigate({ from: '/users' });
  const manages = can(me.member.role, 'org.manage') !== false;
  const members = useQuery(membersQuery(search));
  const invitations = useQuery({ ...invitationsQuery, enabled: manages });
  const departments = useQuery({ ...departmentsQuery, enabled: manages });
  const unlock = useMemberAction('unlock');
  const resend = useInvitationAction('resend');
  const cancel = useInvitationAction('cancel');
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [q, setQ] = useState(search.q ?? '');

  // Search box → URL after a short pause, so the filtered list can be shared.
  useEffect(() => {
    const id = setTimeout(() => {
      const value = q.trim() || undefined;
      if (value !== search.q)
        navigate({ search: (prev) => ({ ...prev, q: value }), replace: true });
    }, 300);
    return () => clearTimeout(id);
  }, [q, search.q, navigate]);

  const setFilter = (patch: Partial<UsersSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }) });

  const memberRows = members.data ?? [];
  const inviteRows = manages ? filterInvitations(invitations.data ?? [], search) : [];
  const activeOwners = memberRows.filter((row) => row.role === 'owner' && row.status === 'active');
  const ownRow = memberRows.find((row) => row.id === me.member.id);
  const hasFilters = Boolean(search.q || search.role || search.department || search.status);
  const empty = members.data && memberRows.length === 0 && inviteRows.length === 0;

  async function act(action: () => Promise<unknown>, done?: string) {
    setFailure(null);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
    } catch (error) {
      setFailure(apiErrorMessage(error));
    }
  }

  function onInviteSent(result: InviteResult) {
    setOpen(null);
    const skipped = result.skipped.map(
      (item) =>
        `${item.email} ${item.reason === 'already_member' ? t('invites.skipped.member') : t('invites.skipped.invited')}`,
    );
    setNotice([tf('invites.sent', { n: result.invited.length }), ...skipped].join(' · '));
  }

  function memberMenu(row: MemberRow): MenuItem[] {
    if (!canManageMember(me.member.role, row.role) || row.status === 'locked') return [];
    const isSelf = row.id === me.member.id;
    // The only active Owner cannot change their own role (0.2 #039): explain instead.
    const lastOwnerSelf = isSelf && row.role === 'owner' && activeOwners.length <= 1;
    const items: MenuItem[] = [
      {
        label: t('users.action.role'),
        onSelect: () =>
          setOpen(lastOwnerSelf ? { kind: 'lastOwner' } : { kind: 'role', member: row }),
      },
      { label: t('users.action.move'), onSelect: () => setOpen({ kind: 'move', member: row }) },
    ];
    if (!isSelf) {
      items.push({
        label: t('users.action.lock'),
        danger: true,
        separated: true,
        onSelect: () => setOpen({ kind: 'lock', member: row }),
      });
    }
    return items;
  }

  const managerTitle = ownRow?.departmentName
    ? `${t('users.titleManager')} ${ownRow.departmentName}`
    : t('users.title');

  return (
    <>
      <PageHeader
        eyebrow={t('users.eyebrow')}
        title={manages ? t('users.title') : managerTitle}
        lead={manages ? t('users.lead') : t('users.leadManager')}
        action={
          manages ? (
            <div className="grid justify-items-end gap-1.5">
              <Button
                type="button"
                disabled={!me.user.emailVerified}
                aria-describedby={me.user.emailVerified ? undefined : 'invite-needs-verify'}
                onClick={() => setOpen({ kind: 'invite' })}
              >
                <UserPlus />
                {t('users.invite')}
              </Button>
              {me.user.emailVerified ? null : (
                <small
                  id="invite-needs-verify"
                  className="max-w-[28ch] text-right text-xs text-warning-ink"
                >
                  {t('users.inviteNeedsVerify')}
                </small>
              )}
            </div>
          ) : null
        }
      />
      {notice ? (
        <Callout tone="info" role="status" className="mb-4">
          {notice}
        </Callout>
      ) : null}
      {failure || members.error ? (
        <Callout tone="danger" role="alert" className="mb-4">
          {failure ?? apiErrorMessage(members.error)}
        </Callout>
      ) : null}
      <section
        aria-label={t('users.title')}
        className="overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-card)]"
      >
        {manages ? (
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <label className="relative min-w-[14rem] flex-[1_1_16rem]">
              <span className="sr-only">{t('users.search')}</span>
              <Search
                aria-hidden="true"
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder={t('users.search')}
                className="h-10 w-full rounded-md border border-border-strong bg-background pr-3 pl-9 text-sm focus:border-primary focus:shadow-[0_0_0_3px_oklch(62%_0.19_258/0.18)] focus:outline-none"
              />
            </label>
            <FilterSelect
              label={t('users.filter.role')}
              value={search.role ?? ''}
              onChange={(value) => setFilter({ role: (value || undefined) as Role | undefined })}
              options={[
                ['', t('users.filter.allRoles')],
                ...ROLES.map((role) => [role, t(`role.${role}`)] as const),
              ]}
            />
            <FilterSelect
              label={t('users.filter.department')}
              value={search.department ?? ''}
              onChange={(value) => setFilter({ department: value || undefined })}
              options={[
                ['', t('users.filter.allDepartments')],
                ...(departments.data?.departments ?? []).map(
                  (dept) => [dept.id, dept.name] as const,
                ),
                ['none', t('users.filter.noDepartment')],
              ]}
            />
            <FilterSelect
              label={t('users.filter.status')}
              value={search.status ?? ''}
              onChange={(value) =>
                setFilter({ status: (value || undefined) as UsersSearch['status'] })
              }
              options={[
                ['', t('users.filter.allStatuses')],
                ['active', t('users.status.active')],
                ['invited', t('users.status.invited')],
                ['locked', t('users.status.locked')],
              ]}
            />
            <span className="ml-auto px-1 text-sm text-muted-foreground tabular-nums">
              {memberRows.length} {t('users.count.people')}
              {inviteRows.length > 0 ? ` · ${inviteRows.length} ${t('users.count.invites')}` : ''}
            </span>
          </div>
        ) : null}

        {members.isPending ? <p className="p-6 text-muted-foreground">{t('app.loading')}</p> : null}

        {empty ? (
          <div className="grid justify-items-center gap-2 px-6 py-12 text-center">
            <b>{search.q ? `${t('users.empty.title')}: "${search.q}"` : t('users.empty.title')}</b>
            <span className="text-sm text-muted-foreground">{t('users.empty.body')}</span>
            {hasFilters ? (
              <Button
                type="button"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  setQ('');
                  navigate({ search: {} });
                }}
              >
                {t('users.empty.clear')}
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* relative: keeps absolutely positioned sr-only text inside the scroll box */}
        {!empty && members.data ? (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead className="bg-canvas">
                <tr>
                  <th scope="col" className={headCell}>
                    {t('users.col.person')}
                  </th>
                  <th scope="col" className={headCell}>
                    {t('users.col.role')}
                  </th>
                  <th scope="col" className={`${headCell} max-[700px]:hidden`}>
                    {t('users.col.department')}
                  </th>
                  <th scope="col" className={headCell}>
                    {t('users.col.status')}
                  </th>
                  <th scope="col" className={`${headCell} max-[900px]:hidden`}>
                    {t('users.col.seen')}
                  </th>
                  <th scope="col" className={headCell}>
                    <span className="sr-only">{t('users.col.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {memberRows.map((row) => (
                  <MemberLine
                    key={row.id}
                    row={row}
                    isSelf={row.id === me.member.id}
                    menu={memberMenu(row)}
                    canUnlock={row.status === 'locked' && canManageMember(me.member.role, row.role)}
                    onUnlock={() => act(() => unlock.mutateAsync(row.id))}
                  />
                ))}
                {inviteRows.map((row) => (
                  <InvitationLine
                    key={row.id}
                    row={row}
                    canManage={canManageMember(me.member.role, row.role)}
                    busy={resend.isPending || cancel.isPending}
                    onResend={() => act(() => resend.mutateAsync(row.id), t('users.resent'))}
                    onCancel={() => act(() => cancel.mutateAsync(row.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {open?.kind === 'invite' ? (
        <InviteDialog
          actorRole={me.member.role}
          onClose={() => setOpen(null)}
          onSent={onInviteSent}
        />
      ) : null}
      {open?.kind === 'role' ? (
        <RoleDialog
          member={open.member}
          actorRole={me.member.role}
          onClose={() => setOpen(null)}
          onLastOwner={() => setOpen({ kind: 'lastOwner' })}
        />
      ) : null}
      {open?.kind === 'move' ? (
        <MoveDialog member={open.member} onClose={() => setOpen(null)} />
      ) : null}
      {open?.kind === 'lock' ? (
        <LockDialog member={open.member} onClose={() => setOpen(null)} />
      ) : null}
      {open?.kind === 'lastOwner' ? <LastOwnerDialog onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <Select
      aria-label={label}
      className="h-10 min-w-[9rem] flex-[1_1_9rem] text-sm min-[701px]:flex-[0_1_12rem]"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map(([optionValue, text]) => (
        <option key={optionValue} value={optionValue}>
          {text}
        </option>
      ))}
    </Select>
  );
}

function MemberLine({
  row,
  isSelf,
  menu,
  canUnlock,
  onUnlock,
}: {
  row: MemberRow;
  isSelf: boolean;
  menu: MenuItem[];
  canUnlock: boolean;
  onUnlock: () => void;
}) {
  const seen = seenLabel(row.lastSeenAt);
  const locked = row.status === 'locked';
  return (
    <tr className={locked ? 'bg-canvas/60 text-muted-foreground' : undefined}>
      <td className={cell}>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={row.name} seed={row.id} className={locked ? 'opacity-60' : undefined} />
          <div className="min-w-0">
            <b className="block truncate font-semibold text-foreground">
              {row.name}
              {isSelf ? (
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {t('common.you')}
                </span>
              ) : null}
            </b>
            <small className="block truncate text-xs text-muted-foreground">{row.email}</small>
          </div>
        </div>
      </td>
      <td className={cell}>
        <RoleBadge role={row.role} />
      </td>
      <td className={`${cell} max-[700px]:hidden`}>
        {row.departmentName ?? <span className="text-muted-foreground">{t('common.none')}</span>}
      </td>
      <td className={cell}>
        {locked ? (
          <span className="grid gap-0.5">
            <StatusBadge tone="muted">{t('users.status.locked')}</StatusBadge>
            {row.lockedAt ? (
              <small className="text-xs">
                {t('users.lockedOn')} {dayMonth(row.lockedAt)}
              </small>
            ) : null}
          </span>
        ) : (
          <StatusBadge tone="success">{t('users.status.active')}</StatusBadge>
        )}
      </td>
      <td className={`${cell} text-muted-foreground tabular-nums max-[900px]:hidden`}>
        {'n' in seen ? tf(seen.key, { n: seen.n }) : t(seen.key)}
      </td>
      <td className={`${cell} text-right`}>
        {canUnlock ? (
          <Button type="button" variant="outline" className="h-8 text-xs" onClick={onUnlock}>
            {t('users.action.unlock')}
          </Button>
        ) : (
          <RowMenu label={`${t('users.actionsFor')} ${row.name}`} items={menu} />
        )}
      </td>
    </tr>
  );
}

function InvitationLine({
  row,
  canManage,
  busy,
  onResend,
  onCancel,
}: {
  row: InvitationRow;
  canManage: boolean;
  busy: boolean;
  onResend: () => void;
  onCancel: () => void;
}) {
  const days = daysLeft(row.expiresAt);
  return (
    <tr>
      <td className={cell}>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={row.email} dashed />
          <div className="min-w-0">
            <b className="block font-semibold text-muted-foreground">{t('users.notAccepted')}</b>
            <small className="block truncate text-xs text-muted-foreground">{row.email}</small>
          </div>
        </div>
      </td>
      <td className={cell}>
        <RoleBadge role={row.role} />
      </td>
      <td className={`${cell} max-[700px]:hidden`}>
        {row.departmentName ?? <span className="text-muted-foreground">{t('common.none')}</span>}
      </td>
      <td className={cell}>
        <span className="grid gap-0.5">
          {row.state === 'expired' ? (
            <StatusBadge tone="danger">{t('users.status.expired')}</StatusBadge>
          ) : (
            <>
              <StatusBadge tone="warning">{t('users.status.invited')}</StatusBadge>
              <small className="text-xs text-muted-foreground">
                {days > 0 ? tf('users.expiresIn', { days }) : t('users.expiresToday')}
              </small>
            </>
          )}
        </span>
      </td>
      <td className={`${cell} text-muted-foreground max-[900px]:hidden`}>{t('common.none')}</td>
      <td className={`${cell} text-right whitespace-nowrap`}>
        {canManage ? (
          <span className="inline-flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              className="h-8 text-xs"
              disabled={busy}
              onClick={onResend}
            >
              {t('users.action.resend')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-8 text-xs"
              disabled={busy}
              aria-label={`${t('users.action.cancel')} ${row.email}`}
              onClick={onCancel}
            >
              {t('users.action.cancel')}
            </Button>
          </span>
        ) : null}
      </td>
    </tr>
  );
}

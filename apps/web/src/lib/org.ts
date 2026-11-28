import type { Role } from '@dw/core/permissions';
import { queryOptions } from '@tanstack/react-query';
import { api } from './api.ts';

/** Shapes returned by /api/departments, /api/members and /api/invitations. */
export type Person = { id: string; name: string };
export type Department = {
  id: string;
  name: string;
  description: string | null;
  head: Person | null;
  memberCount: number;
  members: Person[];
};
export type DepartmentList = { departments: Department[]; unassignedCount: number | null };

export type MemberRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'locked';
  departmentId: string | null;
  departmentName: string | null;
  lockedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
};

export type InvitationRow = {
  id: string;
  email: string;
  role: Role;
  departmentId: string | null;
  departmentName: string | null;
  state: 'pending' | 'expired';
  expiresAt: string;
  createdAt: string;
};

export const departmentsQuery = queryOptions({
  queryKey: ['departments'],
  queryFn: () => api<DepartmentList>('/api/departments'),
});

/** Every member (no filter): used for pickers. */
export const allMembersQuery = queryOptions({
  queryKey: ['members', 'all'],
  queryFn: () => api<{ members: MemberRow[] }>('/api/members').then((body) => body.members),
});

export type MemberFilters = {
  q?: string;
  role?: Role;
  department?: string;
  status?: 'active' | 'invited' | 'locked';
};

/** Members for the Người dùng page. "invited" is not a member state: no members then. */
export function membersQuery(filters: MemberFilters) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.role) params.set('role', filters.role);
  if (filters.department) params.set('department', filters.department);
  if (filters.status && filters.status !== 'invited') params.set('status', filters.status);
  return queryOptions({
    queryKey: ['members', filters],
    queryFn: async () =>
      filters.status === 'invited'
        ? []
        : (await api<{ members: MemberRow[] }>(`/api/members?${params}`)).members,
  });
}

export const invitationsQuery = queryOptions({
  queryKey: ['invitations'],
  queryFn: () =>
    api<{ invitations: InvitationRow[] }>('/api/invitations').then((body) => body.invitations),
});

/** Invitations that match the page filters (search, role, department). */
export function filterInvitations(rows: readonly InvitationRow[], filters: MemberFilters) {
  if (filters.status === 'active' || filters.status === 'locked') return [];
  const q = filters.q?.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (!q || row.email.includes(q)) &&
      (!filters.role || row.role === filters.role) &&
      (!filters.department ||
        (filters.department === 'none'
          ? row.departmentId === null
          : row.departmentId === filters.department)),
  );
}

/** Whole days left until `iso` (0 when it is today or past). */
export function daysLeft(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000));
}

/** "dd/mm" for the lock date (0.2 #070). */
export function dayMonth(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export type SeenLabel =
  | { key: 'users.seen.never' | 'users.seen.now' | 'users.seen.yesterday' }
  | { key: 'users.seen.hours' | 'users.seen.days' | 'users.seen.weeks'; n: number };

/** "Hoạt động" column. `last_seen_at` is updated at most hourly (design D6). */
export function seenLabel(iso: string | null, now: number = Date.now()): SeenLabel {
  if (!iso) return { key: 'users.seen.never' };
  const hours = Math.floor((now - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return { key: 'users.seen.now' };
  if (hours < 24) return { key: 'users.seen.hours', n: hours };
  const days = Math.floor(hours / 24);
  if (days === 1) return { key: 'users.seen.yesterday' };
  if (days < 14) return { key: 'users.seen.days', n: days };
  return { key: 'users.seen.weeks', n: Math.floor(days / 7) };
}

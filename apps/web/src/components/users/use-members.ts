import type { Role } from '@dw/core/permissions';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** People, invitations and departments (head, counts) all change together. */
function useRefresh() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      ['members', 'invitations', 'departments'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
}

export function usePatchMember() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: Role; departmentId?: string | null }) =>
      api(`/api/members/${id}`, { method: 'PATCH', body }),
    onSuccess: refresh,
  });
}

export function useMemberAction(action: 'lock' | 'unlock') {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => api(`/api/members/${id}/${action}`, { method: 'POST' }),
    onSuccess: refresh,
  });
}

export function useInvitationAction(action: 'resend' | 'cancel') {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => api(`/api/invitations/${id}/${action}`, { method: 'POST' }),
    onSuccess: refresh,
  });
}

export type InviteResult = {
  invited: { id: string; email: string }[];
  skipped: { email: string; reason: 'already_member' | 'already_invited' }[];
};

export function useInvite() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { emails: string[]; role: Role; departmentId: string | null }) =>
      api<InviteResult>('/api/invitations', { method: 'POST', body }),
    onSuccess: refresh,
  });
}

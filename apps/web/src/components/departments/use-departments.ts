import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

type DepartmentBody = {
  name?: string;
  description?: string | null;
  headMemberId?: string | null;
};

/** Department changes also change people (head = role), so both lists are refreshed. */
function useRefresh() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['departments'] }),
      queryClient.invalidateQueries({ queryKey: ['members'] }),
    ]);
}

export function useCreateDepartment() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: DepartmentBody & { name: string }) =>
      api<{ id: string }>('/api/departments', { method: 'POST', body }),
    onSuccess: refresh,
  });
}

export function useUpdateDepartment(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: DepartmentBody) =>
      api<{ id: string }>(`/api/departments/${id}`, { method: 'PATCH', body }),
    onSuccess: refresh,
  });
}

export function useArchiveDepartment(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () => api<{ id: string }>(`/api/departments/${id}/archive`, { method: 'POST' }),
    onSuccess: refresh,
  });
}

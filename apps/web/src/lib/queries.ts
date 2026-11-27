import type { Role } from '@dw/core/permissions';
import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { ApiError, api } from './api.ts';

export type Me = {
  user: { id: string; name: string; email: string; emailVerified: boolean };
  member: { id: string; role: Role } | null;
  company: { id: string; name: string; contactPhone: string | null } | null;
};

/** `null` when signed out. Drives every redirect (design D9). */
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async (): Promise<Me | null> => {
    try {
      return await api<Me>('/api/me');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  staleTime: 30_000,
});

export const publicConfigQuery = queryOptions({
  queryKey: ['config', 'public'],
  queryFn: () => api<{ googleEnabled: boolean }>('/api/config/public'),
  staleTime: Number.POSITIVE_INFINITY,
});

/**
 * Drops the cached `me` after sign-in, sign-up, company creation or verification,
 * so the next route guard fetches it again instead of reusing a stale `null`.
 */
export function forgetMe(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: meQuery.queryKey });
}

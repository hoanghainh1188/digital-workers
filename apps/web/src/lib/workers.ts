import type { WorkerEvent, WorkerStatus } from '@dw/core/workers';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api.ts';
import type { Person } from './org.ts';

/** Shapes returned by /api/workers* (apps/api/src/workers/views.ts). */
export type Probation = {
  startedOn: string;
  endsOn: string;
  day: number;
  total: number;
  expired: boolean;
};

export type WorkerCard = {
  id: string;
  name: string;
  avatarColor: number;
  jobSummary: string;
  status: WorkerStatus;
  department: { id: string; name: string };
  manager: Person | null;
  monthlyBudgetVnd: number;
  probation: Probation | null;
  hasPendingProposal: boolean;
};

export type WorkerList = {
  workers: WorkerCard[];
  counts: Record<WorkerStatus, number>;
  otherDepartments: { departmentId: string; name: string; count: number }[];
  myDepartmentId: string | null;
};

export type WorkerDetail = Omit<WorkerCard, 'jobSummary' | 'hasPendingProposal' | 'department'> & {
  jobDescription: string;
  voicePreset: 'polite' | 'friendly' | 'formal' | null;
  voiceCustom: string | null;
  templateId: string | null;
  department: { id: string; name: string; archived: boolean };
  testers: Person[];
  pendingProposal: {
    id: string;
    requestedBy: Person | null;
    note: string | null;
    createdAt: string;
  } | null;
  lastReturnedProposal: {
    requestedBy: Person | null;
    decidedBy: Person | null;
    reason: string | null;
    decidedAt: string | null;
  } | null;
  revision: number;
  statusChangedAt: string;
  offboardedAt: string | null;
  createdAt: string;
  availableEvents: WorkerEvent[];
  canEdit: boolean;
  budgetLocked: boolean;
};

export type HistoryEvent = {
  id: string;
  kind: 'created' | 'status_changed' | 'proposed' | 'proposal_returned' | 'probation_extended';
  fromStatus: WorkerStatus | null;
  toStatus: WorkerStatus;
  actor: Person | null;
  reason: string | null;
  days: number | null;
  templateId: string | null;
  proposer: Person | null;
  createdAt: string;
};

export const workersQuery = (status?: WorkerStatus) =>
  queryOptions({
    queryKey: ['workers', 'list', status ?? 'all'],
    queryFn: () => api<WorkerList>(status ? `/api/workers?status=${status}` : '/api/workers'),
  });

export const workerQuery = (id: string) =>
  queryOptions({
    queryKey: ['workers', 'detail', id],
    queryFn: () => api<WorkerDetail>(`/api/workers/${id}`),
  });

export const workerHistoryQuery = (id: string) =>
  queryOptions({
    queryKey: ['workers', 'history', id],
    queryFn: () => api<{ events: HistoryEvent[] }>(`/api/workers/${id}/history`),
  });

export const workerTemplatesQuery = queryOptions({
  queryKey: ['worker-templates'],
  queryFn: () =>
    api<{ templates: { id: string; suggestedName: string }[] }>('/api/worker-templates'),
  staleTime: Number.POSITIVE_INFINITY,
});

/** Every worker change refreshes lists, profiles and histories (they are small). */
function useRefreshWorkers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['workers'] });
}

/** A POST / PATCH / PUT to a worker route that refreshes worker data on success. */
export function useWorkerMutation<Body, Result = unknown>(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT' = 'POST',
) {
  const refresh = useRefreshWorkers();
  return useMutation({
    mutationFn: (body: Body) => api<Result>(path, { method, body }),
    onSuccess: refresh,
  });
}

const money = new Intl.NumberFormat('vi-VN');
/** 300000 → "300.000đ". */
export function formatVnd(amount: number): string {
  return `${money.format(amount)}đ`;
}

/** "300.000" (typed) → 300000; null when it is not a whole number of đồng. */
export function parseVnd(text: string): number | null {
  const digits = text.replace(/[.\s đ,]/g, '');
  return /^\d{1,9}$/.test(digits) ? Number(digits) : null;
}

const shortDate = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Ho_Chi_Minh',
});
/** ISO timestamp or YYYY-MM-DD → "23/11" in Vietnam time. */
export function formatShortDate(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00+07:00`)
    : new Date(value);
  return shortDate.format(date);
}

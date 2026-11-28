import { type WorkerStatus, workerInitials } from '@dw/core/workers';
import { t, tf } from '@/i18n/t';
import type { Probation } from '@/lib/workers';

/** Squircle avatar with a spark (workers.css). Decorative: the name is always next to it. */
export function WorkerAvatar({
  name,
  color,
  offboarded = false,
  size,
}: {
  name: string;
  color: number;
  offboarded?: boolean;
  size?: 'sm' | 'lg';
}) {
  return (
    <span
      aria-hidden="true"
      className="worker-avatar"
      data-tint={color}
      data-size={size}
      data-off={offboarded ? '' : undefined}
    >
      {workerInitials(name)}
    </span>
  );
}

/** Lifecycle pill; on probation it shows the day count or "expired" (spec worker-lifecycle). */
export function WorkerStatusBadge({
  status,
  probation,
}: {
  status: WorkerStatus;
  probation?: Probation | null;
}) {
  if (status === 'probation' && probation) {
    return (
      <span
        className="worker-status"
        data-status={status}
        data-expired={probation.expired ? '' : undefined}
      >
        {probation.expired
          ? t('worker.status.probationExpired')
          : tf('worker.status.probationDay', { day: probation.day, total: probation.total })}
      </span>
    );
  }
  return (
    <span className="worker-status" data-status={status}>
      {t(`worker.status.${status}`)}
    </span>
  );
}

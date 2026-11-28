import type {
  RiskLevel,
  SkillStatus,
  SkillVersionStatus,
  WorkerSkillStatus,
} from '@dw/core/skills';
import { FileCode2 } from 'lucide-react';
import { StatusBadge } from '@/components/ui/badge';
import { t, tf } from '@/i18n/t';
import { cn } from '@/lib/utils';

const RISK_STYLE: Record<RiskLevel, { text: string; bar: string; bars: number }> = {
  low: { text: 'text-success-ink', bar: 'bg-success', bars: 1 },
  medium: { text: 'text-warning-ink', bar: 'bg-warning', bars: 2 },
  high: { text: 'text-destructive-ink', bar: 'bg-destructive', bars: 3 },
};

/** Three bars, filled by level (skill-library.html .risk). */
export function RiskMeter({ risk }: { risk: RiskLevel }) {
  const style = RISK_STYLE[risk];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap',
        style.text,
      )}
      title={tf('risk.label', { level: t(`risk.${risk}`) })}
    >
      <span aria-hidden="true" className="inline-flex gap-0.5">
        {[0, 1, 2].map((index) => (
          <b
            key={index}
            className={cn(
              'h-2.5 w-1 rounded-[1px]',
              index < style.bars ? style.bar : 'bg-border-strong',
            )}
          />
        ))}
      </span>
      <span className="sr-only">{tf('risk.label', { level: '' })}</span>
      {t(`risk.${risk}`)}
    </span>
  );
}

export function ScriptBadge() {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-md bg-destructive-soft px-2 text-xs font-semibold whitespace-nowrap text-destructive-ink">
      <FileCode2 aria-hidden="true" className="size-3.5" />
      {t('skill.hasScripts')}
    </span>
  );
}

const STATUS_TONE: Record<SkillStatus, 'success' | 'warning' | 'muted'> = {
  active: 'success',
  pending: 'warning',
  draft: 'muted',
  archived: 'muted',
};

export function SkillStatusBadge({ status }: { status: SkillStatus }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{t(`skill.status.${status}`)}</StatusBadge>;
}

const VERSION_TONE: Record<SkillVersionStatus, 'success' | 'warning' | 'muted' | 'danger'> = {
  approved: 'success',
  pending: 'warning',
  draft: 'muted',
  rejected: 'danger',
  superseded: 'muted',
};

export function VersionStatusBadge({
  status,
  current,
}: {
  status: SkillVersionStatus;
  current: boolean;
}) {
  return current ? (
    <StatusBadge tone="success">{t('skill.version.current')}</StatusBadge>
  ) : (
    <StatusBadge tone={VERSION_TONE[status]} dot={status !== 'superseded'}>
      {t(`skill.version.${status}`)}
    </StatusBadge>
  );
}

const ASSIGN_TONE: Record<WorkerSkillStatus, 'success' | 'warning' | 'danger'> = {
  active: 'success',
  pending: 'warning',
  suspended: 'danger',
};

export function AssignmentBadge({ status }: { status: WorkerSkillStatus }) {
  return <StatusBadge tone={ASSIGN_TONE[status]}>{t(`assign.status.${status}`)}</StatusBadge>;
}

import type { Role } from '@dw/core/permissions';
import { t } from '@/i18n/t';
import { cn } from '@/lib/utils';

const roleStyles: Record<Role, string> = {
  owner: 'bg-primary text-primary-foreground',
  admin: 'bg-role-admin-soft text-role-admin-ink',
  manager: 'bg-role-manager-soft text-role-manager-ink',
  member: 'bg-muted text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]',
};

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-md px-2 text-xs font-semibold whitespace-nowrap',
        roleStyles[role],
        className,
      )}
    >
      {t(`role.${role}`)}
    </span>
  );
}

const toneStyles = {
  success: 'bg-success-soft text-success-ink',
  warning: 'bg-warning-soft text-warning-ink',
  muted: 'bg-muted text-muted-foreground',
  danger: 'bg-destructive-soft text-destructive-ink',
} as const;

/** Status pill with a leading dot (_shared.css .badge-dot). */
export function StatusBadge({
  tone,
  children,
  dot = true,
}: {
  tone: keyof typeof toneStyles;
  children: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-semibold whitespace-nowrap',
        dot && "before:size-1.5 before:rounded-full before:bg-current before:content-['']",
        toneStyles[tone],
      )}
    >
      {children}
    </span>
  );
}

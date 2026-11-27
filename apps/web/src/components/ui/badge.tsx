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

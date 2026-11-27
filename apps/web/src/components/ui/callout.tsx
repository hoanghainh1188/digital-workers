import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const tones = {
  info: { className: 'bg-primary-soft text-primary-ink', Icon: Info },
  warning: { className: 'bg-warning-soft text-warning-ink', Icon: TriangleAlert },
  danger: { className: 'bg-destructive-soft text-destructive-ink', Icon: CircleAlert },
} as const;

export function Callout({
  tone,
  children,
  className,
  role,
}: {
  tone: keyof typeof tones;
  children: ReactNode;
  className?: string;
  role?: 'alert' | 'status';
}) {
  const { className: toneClass, Icon } = tones[tone];
  return (
    <div
      role={role}
      className={cn('flex items-start gap-3 rounded-lg px-4 py-3.5 text-sm', toneClass, className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

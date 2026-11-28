import type { ReactNode } from 'react';

/** Page title block (_shared.css .page-head): eyebrow, h1, lead and an optional action. */
export function PageHeader({
  eyebrow,
  title,
  lead,
  action,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="mb-1.5 text-xs font-semibold tracking-[0.06em] text-primary-ink uppercase">
          {eyebrow}
        </p>
        <h1 className="text-[length:var(--text-title)] leading-tight font-bold tracking-[-0.02em]">
          {title}
        </h1>
        <p className="mt-1.5 max-w-[60ch] text-muted-foreground">{lead}</p>
      </div>
      {action}
    </header>
  );
}

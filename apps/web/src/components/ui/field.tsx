import { CircleAlert } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const inputClass =
  'h-10.5 w-full rounded-md border border-border-strong bg-background px-3 transition-[border-color,box-shadow] duration-150 hover:border-[oklch(76%_0.04_258)] focus:border-primary focus:shadow-[0_0_0_3px_oklch(62%_0.19_258/0.18)] focus:outline-none aria-[invalid=true]:border-destructive aria-[invalid=true]:shadow-[0_0_0_3px_oklch(58%_0.22_27/0.12)]';

type FieldProps = {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
  }) => ReactNode;
};

/** Label + control + hint / error, with the ARIA wiring done once. */
export function Field({ id, label, hint, error, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': [errorId, hintId].filter(Boolean).join(' ') || undefined,
      })}
      {error ? (
        <span id={errorId} className="flex items-center gap-1.5 text-xs text-destructive-ink">
          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(inputClass, className)} {...props} />;
}

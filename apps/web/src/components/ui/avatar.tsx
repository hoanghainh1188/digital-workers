import { cn } from '@/lib/utils';

const tints = [
  'bg-primary-soft text-primary-ink',
  'bg-role-manager-soft text-role-manager-ink',
  'bg-role-admin-soft text-role-admin-ink',
  'bg-warning-soft text-warning-ink',
  'bg-success-soft text-success-ink',
];

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words.at(-1)] : [words[0]];
  return letters
    .map((word) => word?.[0] ?? '')
    .join('')
    .toUpperCase();
}

/** Stable tint per id, so the same person keeps the same colour everywhere. */
function tintFor(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tints[hash % tints.length] ?? tints[0] ?? '';
}

/** Initials avatar (_shared.css .avatar). Decorative: the name is always next to it. */
export function Avatar({
  name,
  seed,
  className,
  dashed = false,
}: {
  name: string;
  seed?: string;
  className?: string;
  dashed?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold',
        dashed
          ? 'border-[1.5px] border-dashed border-border-strong text-muted-foreground'
          : tintFor(seed ?? name),
        className,
      )}
    >
      {dashed ? '?' : initials(name)}
    </span>
  );
}

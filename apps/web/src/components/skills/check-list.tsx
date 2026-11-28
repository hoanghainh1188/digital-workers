import { t } from '@/i18n/t';
import { type Check, checkText } from '@/lib/skills';
import { cn } from '@/lib/utils';

const MARK = { ok: '✓', warn: '!', error: '✕' } as const;
const TONE = {
  ok: 'text-success-ink',
  warn: 'text-warning-ink',
  error: 'text-destructive-ink',
} as const;

/** Import / save check list (skill-library.html .checks): codes → Vietnamese with how-to-fix. */
export function CheckList({ checks }: { checks: readonly Check[] }) {
  // Errors first so the reason to fix is at the top.
  const order = { error: 0, warn: 1, ok: 2 } as const;
  const sorted = [...checks].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <ul aria-label={t('import.checks')} className="grid gap-2 text-sm">
      {sorted.map((item) => {
        const { title, fix } = checkText(item);
        return (
          <li
            key={`${item.level}-${item.check}-${item.path ?? ''}-${JSON.stringify(item.params ?? {})}`}
            className="grid grid-cols-[1.25rem_1fr] items-start gap-2"
            data-level={item.level}
          >
            <span aria-hidden="true" className={cn('font-bold', TONE[item.level])}>
              {MARK[item.level]}
            </span>
            <span className="min-w-0">
              <b className={item.level === 'ok' ? 'font-normal' : 'font-semibold'}>{title}</b>
              {item.path && item.level !== 'ok' ? (
                <code className="ml-1.5 rounded bg-muted px-1 font-mono text-[0.78rem] break-all">
                  {item.path}
                </code>
              ) : null}
              {fix ? (
                <small className="block text-xs break-words text-muted-foreground">{fix}</small>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

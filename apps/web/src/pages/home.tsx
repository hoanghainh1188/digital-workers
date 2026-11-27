import { Bot, Building2 } from 'lucide-react';
import type { SignedInMe } from '@/components/app/app-shell';
import { t } from '@/i18n/t';

export function HomePage({ me }: { me: SignedInMe }) {
  return (
    <>
      <header className="mb-8">
        <p className="mb-1.5 text-xs font-semibold tracking-[0.06em] text-primary-ink uppercase">
          {t('home.eyebrow')}
        </p>
        <h1 className="text-[length:var(--text-title)] leading-tight font-bold tracking-[-0.02em]">
          {t('home.greeting')}, {me.user.name}
        </h1>
        <p className="mt-1.5 max-w-[60ch] text-muted-foreground">{t('home.lead')}</p>
      </header>
      <section
        aria-labelledby="next-title"
        className="max-w-2xl rounded-2xl border bg-card p-6 shadow-[var(--shadow-card)]"
      >
        <h2 id="next-title" className="font-semibold">
          {t('home.next.title')}
        </h2>
        <ol className="mt-4 grid gap-3">
          {(
            [
              ['home.next.departments', Building2],
              ['home.next.worker', Bot],
            ] as const
          ).map(([key, Icon], index) => (
            <li
              key={key}
              className="flex items-center gap-3 rounded-lg bg-canvas px-4 py-3 text-sm"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-ink">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <span className="min-w-0 flex-1">{t(key)}</span>
              <span className="text-xs font-semibold text-muted-foreground">
                {index + 1}/2 · {t('shell.nav.soon')}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

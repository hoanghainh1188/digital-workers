import { Button } from '@/components/ui/button';
import { t } from '@/i18n/t';
import type { MessageKey } from '@/i18n/vi';

const steps: readonly MessageKey[] = ['home.steps.hire', 'home.steps.train', 'home.steps.work'];

export function App() {
  return (
    <>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">{t('app.name')}</span>
        <Button variant="outline" disabled>
          {t('home.cta.signin')}
        </Button>
      </header>

      <main className="mx-auto max-w-6xl px-6" style={{ paddingBlock: 'var(--space-section)' }}>
        <section
          aria-labelledby="home-title"
          className="grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:items-end"
        >
          <div>
            <p className="mb-4 inline-flex rounded-full bg-primary-soft px-3 py-1 text-sm font-medium text-primary">
              {t('home.eyebrow')}
            </p>
            <h1
              id="home-title"
              className="max-w-[18ch] font-semibold leading-[1.05] tracking-tight text-balance"
              style={{ fontSize: 'var(--text-hero)' }}
            >
              {t('home.title')}
            </h1>
            <p className="mt-6 max-w-[56ch] text-lg text-muted-foreground">{t('home.lead')}</p>
          </div>

          <aside className="relative rounded-xl border bg-card p-6 shadow-[0_1px_0_var(--border),0_24px_48px_-24px_oklch(55%_0.21_262/0.35)]">
            <ol className="mb-6 flex flex-wrap items-center gap-2 text-sm font-medium">
              {steps.map((key, index) => (
                <li key={key} className="flex items-center gap-2">
                  <span
                    className={
                      index === steps.length - 1
                        ? 'whitespace-nowrap rounded-md bg-primary px-2.5 py-1 text-primary-foreground'
                        : 'whitespace-nowrap rounded-md bg-muted px-2.5 py-1 text-muted-foreground'
                    }
                  >
                    {t(key)}
                  </span>
                  {index < steps.length - 1 && (
                    <span aria-hidden="true" className="text-border">
                      →
                    </span>
                  )}
                </li>
              ))}
            </ol>
            <h2 className="flex items-center gap-2 font-semibold">
              <span aria-hidden="true" className="size-2 rounded-full bg-success" />
              {t('home.status.title')}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{t('home.status.body')}</p>
          </aside>
        </section>
      </main>
    </>
  );
}

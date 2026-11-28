import { Link } from '@tanstack/react-router';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n/t';

/** Same page for a path that does not exist and one the user may not see (spec platform-admin). */
export function NotFoundPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-6">
      <section className="grid max-w-sm justify-items-center gap-3 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary-ink">
          <Compass aria-hidden="true" className="size-7" />
        </span>
        <h1 className="text-[length:var(--text-title)] font-bold tracking-[-0.02em]">
          {t('notFound.title')}
        </h1>
        <p className="text-muted-foreground">{t('notFound.body')}</p>
        <Button asChild>
          <Link to="/">{t('notFound.home')}</Link>
        </Button>
      </section>
    </main>
  );
}

import { Link } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import { t } from '@/i18n/t';

/**
 * Red banner at the top of every page while the company has no credit (spec credit-ledger
 * "Báo hết credit trên mọi trang"). Owner / Admin get a link to the Credit page.
 */
export function CreditExhaustedBanner({ showLink }: { showLink: boolean }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[oklch(88%_0.07_25)] bg-destructive-soft px-[clamp(1rem,0.5rem+3vw,3rem)] py-3 text-sm text-destructive-ink"
    >
      <TriangleAlert aria-hidden="true" className="size-4.5 shrink-0" />
      <p className="min-w-0 flex-1">
        <b>{t('creditBanner.title')}</b> {t('creditBanner.body')}
      </p>
      {showLink ? (
        <Link to="/credit" className="font-semibold text-destructive-ink">
          {t('creditBanner.link')}
        </Link>
      ) : null}
    </div>
  );
}

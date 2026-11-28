import { t, tf } from '@/i18n/t';
import type { MessageKey } from '@/i18n/vi';
import type { CreditOverview } from '@/lib/credit';
import { cn } from '@/lib/utils';

const TRIAL_VND = 200_000;

/** The five looks of the balance card in docs/design/screens/credit.html. */
export type BalanceLook = 'normal' | 'low' | 'exhausted' | 'unverified' | 'new';

export function balanceLook(overview: CreditOverview): BalanceLook {
  if (overview.trial === 'pending_verification' && overview.balanceVnd <= 0) return 'unverified';
  if (overview.state === 'exhausted') return 'exhausted';
  if (overview.state === 'low') return 'low';
  // Only the trial credit so far: 200.000đ, threshold 20% of it, nothing used yet.
  const onlyTrial =
    overview.trial === 'granted' &&
    overview.balanceVnd === TRIAL_VND &&
    overview.thresholdVnd === TRIAL_VND / 5 &&
    overview.month.calls === 0;
  if (onlyTrial) return 'new';
  return 'normal';
}

const backgrounds: Record<BalanceLook, string> = {
  normal:
    'bg-[radial-gradient(120%_140%_at_100%_0%,oklch(68%_0.17_245/0.55),transparent_60%),linear-gradient(150deg,oklch(52%_0.21_262),oklch(40%_0.18_266))]',
  new: 'bg-[radial-gradient(120%_140%_at_100%_0%,oklch(68%_0.17_245/0.55),transparent_60%),linear-gradient(150deg,oklch(52%_0.21_262),oklch(40%_0.18_266))]',
  unverified:
    'bg-[radial-gradient(120%_140%_at_100%_0%,oklch(68%_0.17_245/0.55),transparent_60%),linear-gradient(150deg,oklch(52%_0.21_262),oklch(40%_0.18_266))]',
  low: 'bg-[radial-gradient(120%_140%_at_100%_0%,oklch(80%_0.14_80/0.5),transparent_60%),linear-gradient(150deg,oklch(56%_0.15_60),oklch(44%_0.12_45))]',
  exhausted:
    'bg-[radial-gradient(120%_140%_at_100%_0%,oklch(70%_0.16_30/0.45),transparent_60%),linear-gradient(150deg,oklch(50%_0.19_27),oklch(38%_0.15_22))]',
};

const pills: Partial<Record<BalanceLook, MessageKey>> = {
  low: 'credit.pill.low',
  exhausted: 'credit.pill.exhausted',
  new: 'credit.pill.trial',
};

const VND = new Intl.NumberFormat('vi-VN');

function runway(look: BalanceLook, overview: CreditOverview): string {
  if (look === 'exhausted') return t('credit.runway.exhausted');
  if (look === 'unverified') return t('credit.runway.unverified');
  if (look === 'new') return t('credit.runway.new');
  return overview.estimatedDays === null
    ? t('credit.runway.none')
    : tf('credit.runway', { days: VND.format(overview.estimatedDays) });
}

function help(look: BalanceLook, isOwner: boolean): MessageKey | null {
  if (look === 'new') return null;
  if (look === 'unverified') return isOwner ? null : 'credit.help.unverifiedAdmin';
  if (isOwner) return look === 'normal' ? 'credit.help.owner' : 'credit.help.ownerLow';
  return look === 'normal' ? 'credit.help.admin' : 'credit.help.adminLow';
}

/**
 * Balance hero: the one number the page exists for. "Nạp credit" is visible but
 * disabled ("Sắp có", change 16) and only for the Owner (credit.topup).
 */
export function BalanceCard({ overview, isOwner }: { overview: CreditOverview; isOwner: boolean }) {
  const look = balanceLook(overview);
  const pill = pills[look];
  const helpKey = help(look, isOwner);
  return (
    <div
      data-state={look}
      data-testid="balance-card"
      className={cn(
        "relative isolate grid content-between gap-5 overflow-hidden rounded-[calc(var(--radius)+6px)] px-7 py-6 text-white shadow-[var(--shadow-card)] max-[720px]:p-5 after:absolute after:-right-16 after:-bottom-20 after:-z-10 after:size-64 after:rounded-full after:border-[1.5rem] after:border-[oklch(100%_0_0/0.06)] after:shadow-[0_0_0_2.5rem_oklch(100%_0_0/0.035)] after:content-['']",
        backgrounds[look],
      )}
    >
      <p className="flex flex-wrap items-center gap-2 text-sm opacity-85">
        {t('credit.balance')}
        {pill ? (
          <span className="inline-flex h-6 items-center rounded-full bg-[oklch(100%_0_0/0.18)] px-2.5 text-xs font-semibold">
            {t(pill)}
          </span>
        ) : null}
      </p>
      <div>
        <p className="text-[length:var(--text-hero)] leading-none font-bold tracking-[-0.03em] tabular-nums">
          {VND.format(overview.balanceVnd)}
          <span className="ml-[0.15em] text-[0.45em] font-semibold opacity-80">đ</span>
        </p>
        <p className="mt-2 max-w-[52ch] text-sm opacity-90">{runway(look, overview)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isOwner && look !== 'unverified' ? (
          <button
            type="button"
            disabled
            className="inline-flex h-10 cursor-not-allowed disabled:opacity-100 items-center gap-2 rounded-md bg-[oklch(100%_0_0/0.16)] px-4 text-sm font-medium"
          >
            {t('credit.topup')}
            <span className="rounded bg-[oklch(100%_0_0/0.2)] px-1.5 py-0.5 text-[0.625rem] font-bold tracking-wider uppercase">
              {t('credit.soon')}
            </span>
          </button>
        ) : null}
        {helpKey ? <span className="max-w-[34ch] text-xs opacity-85">{t(helpKey)}</span> : null}
      </div>
    </div>
  );
}

import { Check, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '@/i18n/t';
import type { MessageKey } from '@/i18n/vi';
import { cn } from '@/lib/utils';

const steps: ReadonlyArray<readonly [MessageKey, MessageKey]> = [
  ['story.step1.title', 'story.step1.body'],
  ['story.step2.title', 'story.step2.body'],
  ['story.step3.title', 'story.step3.body'],
];
const stepIndent = ['', 'ml-6', 'ml-12'];

export function BrandMark({ inverted = false }: { inverted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-8 place-items-center rounded-[9px] text-[0.8rem] font-bold',
        inverted
          ? 'bg-white text-primary-ink'
          : 'bg-[linear-gradient(145deg,oklch(62%_0.2_258),oklch(48%_0.22_266))] text-white shadow-[var(--shadow-sm),inset_0_1px_0_oklch(100%_0_0/0.25)]',
      )}
    >
      DW
    </span>
  );
}

/** Two-column auth frame from docs/design/screens/signup.html: brand story + form. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-1 min-[901px]:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section
        aria-labelledby="story-title"
        className="relative isolate flex flex-col justify-between gap-6 overflow-hidden p-[clamp(1.5rem,1rem+3vw,3.5rem)] text-[oklch(97%_0.01_258)] min-[901px]:gap-10 bg-[radial-gradient(120%_80%_at_100%_0%,oklch(62%_0.2_255/0.9),transparent_60%),linear-gradient(160deg,oklch(46%_0.2_264),oklch(32%_0.14_268))] before:absolute before:inset-0 before:-z-10 before:bg-[linear-gradient(oklch(100%_0_0/0.5)_1px,transparent_1px),linear-gradient(90deg,oklch(100%_0_0/0.5)_1px,transparent_1px)] before:bg-size-[32px_32px] before:opacity-[0.18] before:content-[''] before:[mask-image:radial-gradient(80%_70%_at_30%_40%,black,transparent)]"
      >
        <div className="flex items-center gap-2.5 font-bold tracking-tight text-white">
          <BrandMark inverted /> {t('app.name')}
        </div>
        <div>
          <h1
            id="story-title"
            className="max-w-[15ch] text-2xl leading-[1.05] font-bold tracking-[-0.03em] text-balance min-[901px]:text-[length:var(--text-hero)]"
          >
            {t('story.title.before')}{' '}
            <em className="text-[oklch(86%_0.09_230)] not-italic">{t('story.title.highlight')}</em>.
          </h1>
          <p className="mt-4 hidden max-w-[44ch] text-lg leading-normal text-[oklch(90%_0.03_258)] min-[901px]:block">
            {t('story.lead')}
          </p>
        </div>
        <ol
          aria-label={t('story.steps.label')}
          className="hidden max-w-md gap-2.5 min-[901px]:grid"
        >
          {steps.map(([title, body], index) => (
            <li
              key={title}
              className={cn(
                'grid grid-cols-[2rem_1fr] items-start gap-3.5 rounded-xl border border-white/14 bg-white/8 px-4 py-3.5 backdrop-blur-[6px]',
                stepIndent[index],
              )}
            >
              <span
                className={cn(
                  'grid size-8 place-items-center rounded-[9px] text-sm font-bold',
                  index === 0 ? 'bg-white text-primary-ink' : 'bg-white/14',
                )}
              >
                {index + 1}
              </span>
              <span>
                <b className="block font-semibold">{t(title)}</b>
                <small className="text-sm text-[oklch(88%_0.03_258)]">{t(body)}</small>
              </span>
            </li>
          ))}
        </ol>
        <div className="hidden flex-wrap gap-x-5 gap-y-2 text-sm text-[oklch(88%_0.03_258)] min-[901px]:flex">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck aria-hidden="true" className="size-4" />
            {t('story.trust.data')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check aria-hidden="true" className="size-4" />
            {t('story.trust.card')}
          </span>
        </div>
      </section>
      <main className="grid place-items-center px-[clamp(1rem,0.5rem+3vw,3rem)] py-[clamp(1.5rem,1rem+3vw,3.5rem)]">
        <div className="grid w-[min(27rem,100%)] gap-6">{children}</div>
      </main>
    </div>
  );
}

export function AuthHeader({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: string;
  lead?: ReactNode;
}) {
  return (
    <header>
      <p className="mb-1.5 text-xs font-semibold tracking-[0.06em] text-primary-ink uppercase">
        {eyebrow}
      </p>
      <h2 className="text-[length:var(--text-title)] font-bold tracking-[-0.02em]">{title}</h2>
      {lead ? <p className="mt-1.5 text-muted-foreground">{lead}</p> : null}
    </header>
  );
}

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
      {children}
    </div>
  );
}

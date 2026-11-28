import { can } from '@dw/core/permissions';
import type { WorkerEvent, WorkerStatus } from '@dw/core/workers';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { SignedInMe } from '@/components/app/app-shell';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { type DialogEvent, LifecycleDialog } from '@/components/workers/lifecycle-dialogs';
import { ProfileForm } from '@/components/workers/profile-form';
import {
  HistoryPanel,
  MoveDepartmentDialog,
  ProbationPanel,
  TestersDialog,
} from '@/components/workers/profile-side';
import { WorkerAvatar, WorkerStatusBadge } from '@/components/workers/worker-badges';
import { t, tf } from '@/i18n/t';
import type { MessageKey } from '@/i18n/vi';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/form-errors';
import { allMembersQuery, departmentsQuery, type Person } from '@/lib/org';
import { formatShortDate, formatVnd, type WorkerDetail, workerQuery } from '@/lib/workers';

/** Hero buttons, in the order of the design; the primary one per state is filled. */
const HERO_EVENTS: readonly DialogEvent[] = [
  'startProbation',
  'returnProposal',
  'activate',
  'propose',
  'suspend',
  'resume',
  'offboard',
];
const PRIMARY: ReadonlySet<WorkerEvent> = new Set([
  'startProbation',
  'activate',
  'propose',
  'resume',
]);

/** Tabs for later changes ("Sắp có · change N", design D9). */
const SOON_TABS: ReadonlyArray<readonly [MessageKey, number]> = [
  ['profile.tab.skills', 3],
  ['profile.tab.channels', 6],
  ['profile.tab.data', 9],
  ['profile.tab.schedules', 8],
  ['profile.tab.approvals', 7],
  ['profile.tab.tasks', 5],
];

type Open = { kind: 'event'; event: DialogEvent } | { kind: 'testers' } | { kind: 'move' } | null;

/** Hồ sơ worker (docs/design/screens/worker-profile.html, specs worker-profile / -lifecycle). */
export function WorkerProfilePage({ me, id }: { me: SignedInMe; id: string }) {
  const { data: worker, error, isPending } = useQuery(workerQuery(id));
  const [open, setOpen] = useState<Open>(null);
  const [done, setDone] = useState(false);
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const role = me.member.role;
  const listsPeople =
    can(role, 'member.list') !== false &&
    Boolean(worker?.canEdit || worker?.availableEvents.includes('editTesters'));
  const members = useQuery({ ...allMembersQuery, enabled: listsPeople });
  const manages = can(role, 'org.manage') !== false;
  const departments = useQuery({ ...departmentsQuery, enabled: manages });

  if (isPending) return <p className="text-muted-foreground">{t('app.loading')}</p>;
  if (error || !worker) {
    return (
      <Callout tone="danger" role="alert">
        {error instanceof ApiError && error.status === 404
          ? t('app.error.generic')
          : apiErrorMessage(error)}
      </Callout>
    );
  }

  const eligible: Person[] = (members.data ?? [])
    .filter(
      (person) =>
        person.status === 'active' &&
        (person.departmentId === worker.department.id ||
          person.role === 'owner' ||
          person.role === 'admin'),
    )
    .map((person) => ({ id: person.id, name: person.name }));
  const heroEvents = HERO_EVENTS.filter((event) => worker.availableEvents.includes(event));

  return (
    <>
      <nav
        aria-label={t('profile.crumbs')}
        className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        <Link to="/workers">{t('workers.title')}</Link>
        <span aria-hidden="true">/</span>
        <span>{worker.department.name}</span>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-foreground">
          {worker.name}
        </span>
      </nav>

      <Notices worker={worker} role={role} />
      {done ? (
        <p role="status" className="sr-only">
          {t('action.done')}
        </p>
      ) : null}

      <section
        aria-labelledby="worker-name"
        className="grid gap-5 rounded-[calc(var(--radius)+4px)] border bg-background p-6 shadow-[var(--shadow-card)] min-[901px]:grid-cols-[auto_1fr_auto]"
      >
        <WorkerAvatar
          name={worker.name}
          color={worker.avatarColor}
          offboarded={worker.status === 'offboarded'}
          size="lg"
        />
        <div className="min-w-0">
          <h1
            id="worker-name"
            className="flex flex-wrap items-center gap-2.5 text-2xl leading-tight font-bold tracking-[-0.02em]"
          >
            {worker.name}
            <WorkerStatusBadge status={worker.status} probation={worker.probation} />
          </h1>
          {worker.jobDescription ? (
            <p className="mt-1 line-clamp-3 max-w-[56ch] text-muted-foreground">
              {worker.jobDescription}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
            <span>{tf('profile.department', { name: worker.department.name })}</span>
            <span className="inline-flex items-center gap-1.5">
              {worker.manager ? (
                <>
                  <Avatar
                    name={worker.manager.name}
                    seed={worker.manager.id}
                    className="size-5.5 text-[0.55rem]"
                  />
                  {tf('workers.card.manager', { name: worker.manager.name })}
                </>
              ) : (
                t('workers.card.noManager')
              )}
            </span>
            <span className="tabular-nums">
              {tf('profile.budget', { amount: formatVnd(worker.monthlyBudgetVnd) })}
            </span>
          </div>
        </div>
        {heroEvents.length > 0 ? (
          <div className="flex flex-wrap content-start gap-2 min-[901px]:justify-end">
            {heroEvents.map((event) => (
              <Button
                key={event}
                type="button"
                variant={
                  event === 'offboard'
                    ? 'dangerOutline'
                    : PRIMARY.has(event)
                      ? 'default'
                      : 'outline'
                }
                onClick={() => {
                  setDone(false);
                  setOpen({ kind: 'event', event });
                }}
              >
                {t(`action.${event}`)}
              </Button>
            ))}
          </div>
        ) : null}
        <LifecycleRail status={worker.status} />
      </section>

      <div
        role="tablist"
        aria-label={t('profile.tabs.label')}
        className="my-6 flex gap-1 overflow-x-auto border-b"
      >
        <button
          type="button"
          role="tab"
          aria-selected="true"
          className="-mb-px border-b-2 border-primary px-3.5 py-2.5 text-sm font-medium whitespace-nowrap"
        >
          {t('profile.tab.profile')}
        </button>
        {SOON_TABS.map(([label, change]) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected="false"
            aria-disabled="true"
            title={tf('profile.tab.soon', { n: change })}
            className="-mb-px inline-flex cursor-not-allowed items-center gap-1.5 border-b-2 border-transparent px-3.5 py-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground"
          >
            {t(label)}
            <span className="rounded bg-muted px-1.5 py-0.5 text-[0.625rem] font-semibold">
              {tf('profile.tab.soon', { n: change })}
            </span>
          </button>
        ))}
      </div>

      <div className="grid items-start gap-5 min-[1025px]:grid-cols-[minmax(0,1.6fr)_minmax(17rem,1fr)]">
        <ProfileForm
          key={worker.revision}
          worker={worker}
          managers={eligible}
          isManagerRole={role === 'manager'}
          saved={savedRevision === worker.revision}
          onSaved={setSavedRevision}
          onMoveDepartment={manages ? () => setOpen({ kind: 'move' }) : undefined}
        />
        <aside className="grid gap-5">
          {worker.status === 'probation' ? (
            <ProbationPanel
              worker={worker}
              canEditTesters={worker.availableEvents.includes('editTesters')}
              canExtend={worker.availableEvents.includes('extendProbation')}
              onEditTesters={() => setOpen({ kind: 'testers' })}
              onExtend={() => setOpen({ kind: 'event', event: 'extendProbation' })}
            />
          ) : null}
          <HistoryPanel workerId={worker.id} />
        </aside>
      </div>

      {open?.kind === 'event' ? (
        <LifecycleDialog
          worker={worker}
          event={open.event}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            setDone(true);
          }}
        />
      ) : null}
      {open?.kind === 'testers' ? (
        <TestersDialog worker={worker} people={eligible} onClose={() => setOpen(null)} />
      ) : null}
      {open?.kind === 'move' ? (
        <MoveDepartmentDialog
          worker={worker}
          departments={departments.data?.departments ?? []}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </>
  );
}

function Notices({ worker, role }: { worker: WorkerDetail; role: SignedInMe['member']['role'] }) {
  const notices: { tone: 'warning' | 'info' | 'danger'; text: string }[] = [];
  if (worker.status === 'offboarded' && worker.offboardedAt) {
    notices.push({
      tone: 'danger',
      text: tf('profile.offboarded', {
        name: worker.name,
        date: formatShortDate(worker.offboardedAt),
      }),
    });
  }
  if (worker.pendingProposal) {
    const date = formatShortDate(worker.pendingProposal.createdAt);
    notices.push(
      worker.availableEvents.includes('returnProposal')
        ? {
            tone: 'warning',
            text: tf('profile.proposal.owner', {
              name: worker.pendingProposal.requestedBy?.name ?? '',
              date,
            }),
          }
        : { tone: 'info', text: tf('profile.proposal.manager', { date }) },
    );
  } else if (worker.lastReturnedProposal) {
    notices.push({
      tone: 'warning',
      text: tf('profile.proposal.returned', {
        name: worker.lastReturnedProposal.decidedBy?.name ?? '',
        reason: worker.lastReturnedProposal.reason ?? '',
      }),
    });
  } else if (
    worker.status === 'probation' &&
    role === 'manager' &&
    worker.availableEvents.includes('propose')
  ) {
    notices.push({ tone: 'info', text: t('profile.proposal.hint') });
  }
  if (worker.probation?.expired && worker.availableEvents.length > 0) {
    notices.push({ tone: 'danger', text: t('profile.expired') });
  }
  return (
    <>
      {notices.map((notice) => (
        <Callout key={notice.text} tone={notice.tone} className="mb-4">
          {notice.text}
        </Callout>
      ))}
    </>
  );
}

const RAIL: readonly WorkerStatus[] = ['draft', 'probation', 'active'];

/** Nháp → Thử việc → Chính thức ⇄ Tạm nghỉ … Nghỉ việc (worker-profile.html .rail). */
function LifecycleRail({ status }: { status: WorkerStatus }) {
  const reached = status === 'suspended' ? 3 : RAIL.indexOf(status) + 1;
  const stateOf = (index: number) =>
    status === 'offboarded'
      ? 'todo'
      : index + 1 < reached
        ? 'done'
        : index + 1 === reached
          ? 'now'
          : 'todo';
  const dot = (state: string, label: string) =>
    `grid size-6.5 place-items-center rounded-full border-[1.5px] text-[0.7rem] font-bold ${
      state === 'done'
        ? 'border-primary bg-primary text-primary-foreground'
        : state === 'now'
          ? 'border-primary bg-background text-primary-ink shadow-[0_0_0_4px_var(--primary-soft)]'
          : 'border-border-strong bg-background'
    } ${label}`;
  return (
    <div className="col-span-full flex items-center overflow-x-auto border-t pt-5">
      <h2 className="sr-only">{t('profile.rail.label')}</h2>
      <ol className="lifecycle-rail flex items-center">
        {RAIL.map((step, index) => {
          const state = status === 'suspended' && step === 'active' ? 'done' : stateOf(index);
          return (
            <li
              key={step}
              data-state={state}
              aria-current={state === 'now' ? 'step' : undefined}
              className={`flex items-center gap-2 text-sm whitespace-nowrap ${state === 'todo' ? 'text-muted-foreground' : 'text-foreground'} ${state === 'now' ? 'font-semibold' : ''}`}
            >
              <span aria-hidden="true" className={dot(state, '')}>
                {state === 'done' ? '✓' : index + 1}
              </span>
              {t(`worker.status.${step}`)}
            </li>
          );
        })}
      </ol>
      <span aria-hidden="true" className="mx-2 text-muted-foreground">
        ⇄
      </span>
      <ol className="flex items-center">
        <li
          aria-current={status === 'suspended' ? 'step' : undefined}
          className={`flex items-center gap-2 text-sm whitespace-nowrap ${status === 'suspended' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
        >
          <span aria-hidden="true" className={dot(status === 'suspended' ? 'now' : 'todo', '')}>
            ⏸
          </span>
          {t('worker.status.suspended')}
        </li>
      </ol>
      <ol className="ml-auto flex items-center pl-6">
        <li
          aria-current={status === 'offboarded' ? 'step' : undefined}
          className={`flex items-center gap-2 text-sm whitespace-nowrap ${status === 'offboarded' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
        >
          <span
            aria-hidden="true"
            className={`grid size-6.5 place-items-center rounded-full border-[1.5px] text-[0.7rem] font-bold ${status === 'offboarded' ? 'border-muted-foreground shadow-[0_0_0_4px_var(--muted)]' : 'border-border-strong'}`}
          >
            ✕
          </span>
          {t('worker.status.offboarded')}
        </li>
      </ol>
    </div>
  );
}

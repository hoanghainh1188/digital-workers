import { can } from '@dw/core/permissions';
import {
  WORKER_STATUSES,
  WORKER_TEMPLATES,
  type WorkerStatus,
  workerNameKey,
} from '@dw/core/workers';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { SignedInMe } from '@/components/app/app-shell';
import { PageHeader } from '@/components/app/page-header';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { HireDialog } from '@/components/workers/hire-dialog';
import { WorkerAvatar, WorkerStatusBadge } from '@/components/workers/worker-badges';
import { t, tf } from '@/i18n/t';
import type { MessageKey } from '@/i18n/vi';
import { apiErrorMessage } from '@/lib/form-errors';
import { type Department, departmentsQuery } from '@/lib/org';
import { formatVnd, type WorkerCard, workersQuery } from '@/lib/workers';

/** Counted and filterable statuses, in display order; offboarded workers sit at the bottom. */
const LIVE_STATUSES = WORKER_STATUSES.filter((status) => status !== 'offboarded');
const FILTER_ORDER: readonly WorkerStatus[] = ['active', 'probation', 'suspended', 'draft'];

type Hiring = { departmentId?: string; template?: string } | null;

/** Sơ đồ nhân sự số (docs/design/screens/org-chart.html, spec worker-profile). */
export function WorkersPage({ me, status }: { me: SignedInMe; status?: WorkerStatus }) {
  const hireScope = can(me.member.role, 'worker.create');
  const { data, error, isPending } = useQuery(workersQuery());
  const departments = useQuery(departmentsQuery);
  const [hiring, setHiring] = useState<Hiring>(null);

  const all = data?.workers ?? [];
  const live = all.filter((worker) => worker.status !== 'offboarded');
  const gone = all.filter((worker) => worker.status === 'offboarded');
  const shown = status ? live.filter((worker) => worker.status === status) : live;
  const liveTotal = LIVE_STATUSES.reduce((sum, s) => sum + (data?.counts[s] ?? 0), 0);

  const lanes = laneDepartments(
    departments.data?.departments ?? [],
    all,
    data?.myDepartmentId,
    hireScope,
  );
  const hireDepartments = (departments.data?.departments ?? []).filter(
    (dept) =>
      hireScope === 'all' || (hireScope === 'own-department' && dept.id === data?.myDepartmentId),
  );
  const canHire = hireScope !== false && hireDepartments.length > 0;
  const takenNames = new Set(live.map((worker) => workerNameKey(worker.name)));

  return (
    <>
      <PageHeader
        eyebrow={t('workers.eyebrow')}
        title={t('workers.title')}
        lead={t('workers.lead')}
        action={
          canHire && all.length > 0 ? (
            <Button type="button" onClick={() => setHiring({})}>
              <Plus />
              {t('workers.hire')}
            </Button>
          ) : null
        }
      />
      {error ? (
        <Callout tone="danger" role="alert">
          {apiErrorMessage(error)}
        </Callout>
      ) : null}
      {isPending ? <p className="text-muted-foreground">{t('app.loading')}</p> : null}
      {hireScope !== false && departments.data && hireDepartments.length === 0 ? (
        <Callout tone="info" className="mb-5">
          {t('workers.noDepartment')}{' '}
          <Link to="/departments">{t('workers.noDepartment.link')}</Link>
        </Callout>
      ) : null}

      {data && all.length === 0 ? (
        <EmptyHire canHire={canHire} onHire={(template) => setHiring({ template })} />
      ) : null}

      {data && all.length > 0 ? (
        <>
          <div className="mb-5 grid gap-4 rounded-[calc(var(--radius)+4px)] border bg-background p-4 shadow-[var(--shadow-sm)] min-[901px]:grid-cols-[auto_1fr] min-[901px]:items-center">
            <div className="flex items-baseline gap-2">
              <b className="text-[2rem] leading-none font-bold tracking-[-0.03em] tabular-nums">
                {liveTotal}
              </b>
              <span className="text-sm text-muted-foreground">{t('workers.total')}</span>
            </div>
            <nav
              aria-label={t('workers.filter.label')}
              className="flex flex-wrap gap-2 min-[901px]:justify-end"
            >
              <FilterLink
                current={status}
                value={undefined}
                count={liveTotal}
                label={t('workers.filter.all')}
              />
              {FILTER_ORDER.map((value) => (
                <FilterLink
                  key={value}
                  current={status}
                  value={value}
                  count={data.counts[value]}
                  label={t(`worker.status.${value}`)}
                />
              ))}
            </nav>
          </div>

          {status && shown.length === 0 ? (
            <p className="mb-5 text-muted-foreground">{t('workers.noMatch')}</p>
          ) : null}

          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-4">
            {lanes.map((dept) => {
              const inLane = shown.filter((worker) => worker.department.id === dept.id);
              if (status && inLane.length === 0) return null;
              return (
                <Lane
                  key={dept.id}
                  department={dept}
                  workers={inLane}
                  liveCount={live.filter((worker) => worker.department.id === dept.id).length}
                  onHire={
                    canHire && hireDepartments.some((d) => d.id === dept.id)
                      ? () => setHiring({ departmentId: dept.id })
                      : undefined
                  }
                />
              );
            })}
            {data.otherDepartments.length > 0 ? (
              <OtherDepartments items={data.otherDepartments} />
            ) : null}
          </div>

          {gone.length > 0 && !status ? (
            <details className="group mt-7">
              <summary className="cursor-pointer text-sm font-semibold text-muted-foreground">
                {tf('workers.gone', { count: gone.length })}
              </summary>
              <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-2">
                {gone.map((worker) => (
                  <li key={worker.id}>
                    <WorkerCardLink worker={worker} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}

      {hiring ? (
        <HireDialog
          departments={hireDepartments}
          initialDepartmentId={hiring.departmentId}
          initialTemplate={hiring.template}
          takenNames={takenNames}
          managerOnly={hireScope === 'own-department'}
          onClose={() => setHiring(null)}
        />
      ) : null}
    </>
  );
}

/** Departments shown as lanes: every one for Owner / Admin, the viewer's own otherwise. */
function laneDepartments(
  departments: readonly Department[],
  workers: readonly WorkerCard[],
  myDepartmentId: string | null | undefined,
  scope: ReturnType<typeof can>,
): { id: string; name: string; head: Department['head'] }[] {
  const lanes = departments
    .filter((dept) => scope === 'all' || dept.id === myDepartmentId)
    .map((dept) => ({ id: dept.id, name: dept.name, head: dept.head }));
  // Live workers may sit in a department not listed (not possible today, but never hide one).
  for (const worker of workers) {
    if (worker.status !== 'offboarded' && !lanes.some((lane) => lane.id === worker.department.id)) {
      lanes.push({ id: worker.department.id, name: worker.department.name, head: null });
    }
  }
  return lanes;
}

function FilterLink({
  current,
  value,
  count,
  label,
}: {
  current: WorkerStatus | undefined;
  value: WorkerStatus | undefined;
  count: number;
  label: string;
}) {
  const pressed = current === value;
  return (
    <Link
      to="/workers"
      search={value ? { status: value } : {}}
      aria-current={pressed ? 'true' : undefined}
      className={`inline-flex h-8.5 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium no-underline transition-colors duration-150 ${
        pressed
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border-strong bg-background text-foreground hover:border-[oklch(80%_0.06_258)] hover:bg-primary-soft hover:text-primary-ink'
      }`}
    >
      {label}
      <b className="tabular-nums">{count}</b>
    </Link>
  );
}

function Lane({
  department,
  workers,
  liveCount,
  onHire,
}: {
  department: { id: string; name: string; head: Department['head'] };
  workers: readonly WorkerCard[];
  liveCount: number;
  onHire?: () => void;
}) {
  const titleId = `lane-${department.id}`;
  return (
    <section aria-labelledby={titleId} className="grid content-start gap-2.5">
      <div className="flex items-center gap-2.5 rounded-xl border bg-background px-3 py-2.5">
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-sm font-semibold">
            {department.name}
          </h2>
          <small className="block text-xs text-muted-foreground">
            {tf('workers.lane.count', { count: liveCount })}
          </small>
        </div>
        {department.head ? (
          <span className="ml-auto" title={tf('workers.lane.head', { name: department.head.name })}>
            <Avatar
              name={department.head.name}
              seed={department.head.id}
              className="size-7 text-[0.6rem]"
            />
            <span className="sr-only">
              {tf('workers.lane.head', { name: department.head.name })}
            </span>
          </span>
        ) : (
          <span className="ml-auto" title={t('workers.lane.noHead')}>
            <Avatar name="?" dashed className="size-7 text-[0.6rem]" />
            <span className="sr-only">{t('workers.lane.noHead')}</span>
          </span>
        )}
      </div>
      <ul className="relative grid gap-2 pl-4 before:absolute before:top-0 before:bottom-5 before:left-1.5 before:w-[1.5px] before:bg-border">
        {workers.map((worker) => (
          <li key={worker.id}>
            <WorkerCardLink worker={worker} />
          </li>
        ))}
        {workers.length === 0 && !onHire ? (
          <li className="py-2 text-sm text-muted-foreground">{t('workers.lane.empty')}</li>
        ) : null}
        {onHire ? (
          <li>
            <button
              type="button"
              onClick={onHire}
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-border-strong text-sm font-medium text-muted-foreground transition-colors duration-150 hover:border-primary hover:bg-primary-soft hover:text-primary-ink"
            >
              <Plus aria-hidden="true" className="size-3.5" />
              {tf('workers.hireFor', { department: department.name })}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function WorkerCardLink({ worker }: { worker: WorkerCard }) {
  const off = worker.status === 'offboarded';
  const dim = off || worker.status === 'suspended';
  return (
    <Link
      to="/workers/$id"
      params={{ id: worker.id }}
      className={`relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-xl border bg-background p-3 text-foreground no-underline shadow-[var(--shadow-sm)] transition-[border-color,box-shadow,transform] duration-[var(--duration-normal)] ease-[var(--ease-out-expo)] hover:-translate-y-px hover:border-[oklch(82%_0.06_258)] hover:shadow-[var(--shadow-card)] ${dim ? 'opacity-70' : ''}`}
    >
      <span className="row-span-2">
        <WorkerAvatar name={worker.name} color={worker.avatarColor} offboarded={off} />
      </span>
      <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <b className="text-sm leading-tight">{worker.name}</b>
        <WorkerStatusBadge status={worker.status} probation={worker.probation} />
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {off && worker.jobSummary === '' ? '' : worker.jobSummary || t('common.none')}
      </span>
      {off ? null : (
        <span className="col-span-full mt-1.5 flex flex-wrap justify-between gap-x-2 gap-y-0.5 border-t border-dashed pt-2 text-xs text-muted-foreground">
          <span>
            {worker.hasPendingProposal
              ? t('workers.card.proposed')
              : worker.manager
                ? tf('workers.card.manager', { name: worker.manager.name })
                : t('workers.card.noManager')}
          </span>
          <span className="tabular-nums">
            {tf('workers.card.budget', { amount: formatVnd(worker.monthlyBudgetVnd) })}
          </span>
        </span>
      )}
    </Link>
  );
}

function OtherDepartments({
  items,
}: {
  items: { departmentId: string; name: string; count: number }[];
}) {
  return (
    <section aria-labelledby="lane-others" className="grid content-start gap-2.5">
      <div className="rounded-xl border bg-canvas px-3 py-2.5">
        <h2 id="lane-others" className="text-sm font-semibold">
          {t('workers.others.title')}
        </h2>
        <small className="block text-xs text-muted-foreground">
          {t('workers.others.readOnly')}
        </small>
      </div>
      <div className="rounded-xl border border-dashed p-3 text-center text-sm text-muted-foreground">
        <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1">
          {items.map((item) => (
            <li key={item.departmentId} className="tabular-nums">
              {tf('workers.others.item', { name: item.name, count: item.count })}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-xs">{t('workers.others.note')}</p>
      </div>
    </section>
  );
}

function EmptyHire({ canHire, onHire }: { canHire: boolean; onHire: (template: string) => void }) {
  if (!canHire) {
    return <p className="text-muted-foreground">{t('workers.empty.view')}</p>;
  }
  return (
    <section
      aria-labelledby="empty-hire"
      className="grid gap-5 rounded-[calc(var(--radius)+6px)] border bg-background p-[clamp(1.5rem,1rem+3vw,3rem)] shadow-[var(--shadow-sm)]"
    >
      <div>
        <p className="mb-1.5 text-xs font-semibold tracking-[0.06em] text-primary-ink uppercase">
          {t('workers.empty.eyebrow')}
        </p>
        <h2 id="empty-hire" className="text-xl font-bold tracking-[-0.01em]">
          {t('workers.empty.title')}
        </h2>
        <p className="mt-1.5 max-w-[56ch] text-muted-foreground">{t('workers.empty.lead')}</p>
      </div>
      <ul className="grid gap-2.5 min-[901px]:grid-cols-3">
        {WORKER_TEMPLATES.map((tpl, index) => (
          <li key={tpl.id}>
            <button
              type="button"
              onClick={() => onHire(tpl.id)}
              className="grid h-full w-full grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-lg border border-border-strong bg-background p-3.5 text-left transition-[border-color,background-color,transform] duration-150 hover:-translate-y-px hover:border-primary hover:bg-primary-soft"
            >
              <span className="row-span-3">
                <WorkerAvatar
                  name={t(`template.${tpl.id}.title` as MessageKey)}
                  color={index}
                  size="sm"
                />
              </span>
              <b className="text-sm">{t(`template.${tpl.id}.title` as MessageKey)}</b>
              <small className="text-xs leading-[1.45] text-muted-foreground">
                {t(`template.${tpl.id}.body` as MessageKey)}
              </small>
              <small className="text-[0.6875rem] text-primary-ink">
                {t(`template.${tpl.id}.skill` as MessageKey)}
              </small>
            </button>
          </li>
        ))}
      </ul>
      <div>
        <Button type="button" variant="outline" onClick={() => onHire('blank')}>
          {t('workers.empty.blank')}
        </Button>
      </div>
    </section>
  );
}

import { can } from '@dw/core/permissions';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Archive, Building2, CircleAlert, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import type { SignedInMe } from '@/components/app/app-shell';
import { PageHeader } from '@/components/app/page-header';
import { ArchiveDepartmentDialogs } from '@/components/departments/archive-dialogs';
import { DepartmentDialog } from '@/components/departments/department-dialog';
import { useCreateDepartment } from '@/components/departments/use-departments';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { t } from '@/i18n/t';
import type { MessageKey } from '@/i18n/vi';
import { apiErrorMessage } from '@/lib/form-errors';
import { type Department, departmentsQuery } from '@/lib/org';

const SUGGESTIONS: readonly MessageKey[] = [
  'departments.suggest.sales',
  'departments.suggest.accounting',
  'departments.suggest.support',
  'departments.suggest.admin',
];

type Editing = { mode: 'add' } | { mode: 'edit'; department: Department } | null;

/** Phòng ban (docs/design/screens/departments.html, spec departments). */
export function DepartmentsPage({ me }: { me: SignedInMe }) {
  const manages = can(me.member.role, 'org.manage') !== false;
  const { data, isPending, error } = useQuery(departmentsQuery);
  const [editing, setEditing] = useState<Editing>(null);
  const [archiving, setArchiving] = useState<Department | null>(null);
  const quickCreate = useCreateDepartment();

  const departments = data?.departments ?? [];
  const assigned = departments.reduce((sum, dept) => sum + dept.memberCount, 0);

  return (
    <>
      <PageHeader
        eyebrow={t('departments.eyebrow')}
        title={t('departments.title')}
        lead={t('departments.lead')}
        action={
          manages && departments.length > 0 ? (
            <Button type="button" onClick={() => setEditing({ mode: 'add' })}>
              <Plus />
              {t('departments.add')}
            </Button>
          ) : null
        }
      />
      {manages ? null : (
        <Callout tone="info" className="mb-5">
          {t('departments.readOnly')}
        </Callout>
      )}
      {error ? (
        <Callout tone="danger" role="alert">
          {apiErrorMessage(error)}
        </Callout>
      ) : null}
      {quickCreate.error ? (
        <Callout tone="danger" role="alert" className="mb-5">
          {apiErrorMessage(quickCreate.error)}
        </Callout>
      ) : null}
      {isPending ? <p className="text-muted-foreground">{t('app.loading')}</p> : null}

      {data && departments.length === 0 ? (
        <EmptyState
          manages={manages}
          busy={quickCreate.isPending}
          onSuggest={(name) => quickCreate.mutate({ name })}
          onCustom={() => setEditing({ mode: 'add' })}
        />
      ) : null}

      {departments.length > 0 ? (
        <>
          <div className="mb-5 flex flex-wrap gap-2">
            <Stat value={departments.length} label={t('departments.stat.count')} />
            <Stat value={assigned} label={t('departments.stat.assigned')} />
            {manages && data?.unassignedCount ? (
              <Link
                to="/users"
                search={{ department: 'none' }}
                className="inline-flex items-baseline gap-1.5 rounded-full border border-[oklch(88%_0.07_80)] bg-warning-soft px-3.5 py-2 text-sm text-warning-ink no-underline transition-[transform] duration-150 hover:-translate-y-px"
              >
                <b className="text-base tabular-nums">{data.unassignedCount}</b>
                {t('departments.stat.unassigned')}
              </Link>
            ) : null}
          </div>
          <ul className="grid gap-3">
            {departments.map((dept) => (
              <DepartmentCard
                key={dept.id}
                department={dept}
                manages={manages}
                onEdit={() => setEditing({ mode: 'edit', department: dept })}
                onArchive={() => setArchiving(dept)}
              />
            ))}
          </ul>
        </>
      ) : null}

      {editing ? (
        <DepartmentDialog
          key={editing.mode === 'edit' ? editing.department.id : 'add'}
          department={editing.mode === 'edit' ? editing.department : null}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {archiving ? (
        <ArchiveDepartmentDialogs department={archiving} onClose={() => setArchiving(null)} />
      ) : null}
    </>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-full border bg-background px-3.5 py-2 text-sm text-muted-foreground">
      <b className="text-base text-foreground tabular-nums">{value}</b>
      {label}
    </span>
  );
}

function DepartmentCard({
  department,
  manages,
  onEdit,
  onArchive,
}: {
  department: Department;
  manages: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const titleId = `dept-${department.id}`;
  return (
    <li
      aria-labelledby={titleId}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-4 rounded-[calc(var(--radius)+4px)] border bg-background px-5 py-4 shadow-[var(--shadow-sm)] transition-[border-color,box-shadow,transform] duration-[var(--duration-normal)] ease-[var(--ease-out-expo)] hover:-translate-y-px hover:border-[oklch(84%_0.05_258)] hover:shadow-[var(--shadow-card)] min-[901px]:grid-cols-[minmax(12rem,1.4fr)_minmax(11rem,1fr)_minmax(9rem,0.8fr)_auto]"
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-primary-soft text-primary-ink">
          <Building2 aria-hidden="true" className="size-4.5" />
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className="font-semibold">
            {department.name}
          </h2>
          {department.description ? (
            <p className="truncate text-sm text-muted-foreground">{department.description}</p>
          ) : null}
        </div>
      </div>
      <div className="col-span-full min-[901px]:col-span-1">
        <span className="mb-1 block text-[0.6875rem] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
          {t('departments.head')}
        </span>
        {department.head ? (
          <span className="flex items-center gap-2 text-sm font-medium">
            <Avatar
              name={department.head.name}
              seed={department.head.id}
              className="size-7 text-[0.65rem]"
            />
            {department.head.name}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-warning-ink">
            <CircleAlert aria-hidden="true" className="size-3.75" />
            {t('departments.noHead')}
          </span>
        )}
      </div>
      <div className="col-span-full min-[901px]:col-span-1">
        <span className="mb-1 block text-[0.6875rem] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
          {t('departments.members')}
        </span>
        <span className="flex items-center">
          {department.members.map((person, index) => (
            <Avatar
              key={person.id}
              name={person.name}
              seed={person.id}
              className={`size-7 text-[0.6rem] shadow-[0_0_0_2px_var(--background)] ${index > 0 ? '-ml-1.5' : ''}`}
            />
          ))}
          <span
            className={`text-sm text-muted-foreground tabular-nums ${department.members.length > 0 ? 'ml-2' : ''}`}
          >
            {department.memberCount} {t('common.people')}
          </span>
        </span>
      </div>
      {manages ? (
        <div className="col-start-2 row-start-1 flex gap-1 min-[901px]:col-start-4">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${t('departments.edit')} ${department.name}`}
            title={t('departments.edit')}
            onClick={onEdit}
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${t('departments.archive')} ${department.name}`}
            title={t('departments.archive')}
            onClick={onArchive}
          >
            <Archive />
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function EmptyState({
  manages,
  busy,
  onSuggest,
  onCustom,
}: {
  manages: boolean;
  busy: boolean;
  onSuggest: (name: string) => void;
  onCustom: () => void;
}) {
  return (
    <section
      aria-labelledby="empty-title"
      className="grid justify-items-center gap-4 rounded-[calc(var(--radius)+6px)] border-[1.5px] border-dashed border-border-strong bg-background px-6 py-[clamp(2rem,1rem+5vw,4.5rem)] text-center"
    >
      <OrgArt />
      <h2 id="empty-title" className="text-xl font-bold tracking-[-0.01em]">
        {t('departments.empty.title')}
      </h2>
      <p className="max-w-[46ch] text-muted-foreground">
        {manages ? t('departments.empty.manage') : t('departments.empty.view')}
      </p>
      {manages ? (
        <>
          <div className="flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((key) => (
              <button
                key={key}
                type="button"
                disabled={busy}
                onClick={() => onSuggest(t(key))}
                className="inline-flex h-8.5 items-center gap-1.5 rounded-full border border-border-strong bg-background px-3.5 text-sm font-medium transition-colors duration-150 hover:border-[oklch(80%_0.06_258)] hover:bg-primary-soft hover:text-primary-ink disabled:opacity-50"
              >
                <Plus aria-hidden="true" className="size-3.5" />
                {t(key)}
              </button>
            ))}
          </div>
          <Button type="button" onClick={onCustom}>
            {t('departments.empty.custom')}
          </Button>
        </>
      ) : null}
    </section>
  );
}

/** Three linked boxes (departments.html .empty-art). */
function OrgArt() {
  return (
    <div aria-hidden="true" className="relative h-22 w-36">
      <span className="absolute top-0 left-[2.875rem] h-9 w-13 rounded-[9px] bg-primary" />
      <span className="absolute top-13 left-0 h-9 w-13 rounded-[9px] border border-[oklch(86%_0.05_258)] bg-primary-soft" />
      <span className="absolute top-13 right-0 h-9 w-13 rounded-[9px] border border-[oklch(86%_0.05_258)] bg-primary-soft" />
      <span className="absolute top-9 left-[1.625rem] h-4 w-[2.875rem] rounded-tl-md border-[1.5px] border-r-0 border-b-0 border-border-strong" />
      <span className="absolute top-9 right-[1.625rem] h-4 w-[2.875rem] rounded-tr-md border-[1.5px] border-b-0 border-l-0 border-border-strong" />
    </div>
  );
}

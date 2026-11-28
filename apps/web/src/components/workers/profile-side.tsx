import { MAX_TESTERS } from '@dw/core/workers';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/field';
import { t, tf } from '@/i18n/t';
import type { MessageKey } from '@/i18n/vi';
import { apiErrorMessage } from '@/lib/form-errors';
import type { Person } from '@/lib/org';
import {
  formatShortDate,
  type HistoryEvent,
  useWorkerMutation,
  type WorkerDetail,
  workerHistoryQuery,
} from '@/lib/workers';

/** "Đang thử việc" block: day x / total, rules, testers (worker-profile.html .probation). */
export function ProbationPanel({
  worker,
  canEditTesters,
  canExtend,
  onEditTesters,
  onExtend,
}: {
  worker: WorkerDetail;
  canEditTesters: boolean;
  canExtend: boolean;
  onEditTesters: () => void;
  onExtend: () => void;
}) {
  const probation = worker.probation;
  return (
    <section
      aria-labelledby="probation-title"
      className={`grid gap-3.5 rounded-[calc(var(--radius)+4px)] border p-5 ${probation?.expired ? 'border-[oklch(86%_0.06_25)] bg-destructive-soft' : 'border-[oklch(88%_0.07_80)] bg-warning-soft'}`}
    >
      <h2 id="probation-title" className="font-semibold">
        {probation?.expired ? t('worker.status.probationExpired') : t('probation.title')}
      </h2>
      {probation ? (
        <div className="flex flex-wrap items-baseline gap-x-2">
          <b className="text-[2rem] leading-none font-bold tracking-[-0.03em] tabular-nums">
            {Math.min(probation.day, probation.total)}
          </b>
          <span className="text-sm text-muted-foreground">
            {tf('probation.days', { total: probation.total })} ·{' '}
            {tf('probation.endsOn', { date: formatShortDate(probation.endsOn) })}
          </span>
        </div>
      ) : null}
      <ul className="grid gap-1 text-sm">
        <li>{t('probation.rule.webOnly')}</li>
        <li>{t('probation.rule.approval')}</li>
      </ul>
      <div>
        <span className="text-sm font-medium">{t('probation.testers')}</span>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <TesterList testers={worker.testers} />
          <span className="ml-auto flex gap-1">
            {canExtend ? (
              <Button type="button" variant="ghost" className="h-8" onClick={onExtend}>
                {t('probation.extend')}
              </Button>
            ) : null}
            {canEditTesters ? (
              <Button type="button" variant="ghost" className="h-8" onClick={onEditTesters}>
                {t('probation.testers.edit')}
              </Button>
            ) : null}
          </span>
        </div>
      </div>
    </section>
  );
}

function TesterList({ testers }: { testers: readonly Person[] }) {
  if (testers.length === 0) {
    return <span className="text-sm text-muted-foreground">{t('probation.testers.none')}</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm">
      <span className="flex">
        {testers.slice(0, 4).map((person, index) => (
          <Avatar
            key={person.id}
            name={person.name}
            seed={person.id}
            className={`size-7 text-[0.6rem] shadow-[0_0_0_2px_var(--background)] ${index > 0 ? '-ml-1.5' : ''}`}
          />
        ))}
      </span>
      <span className="min-w-0">{testers.map((person) => person.name).join(', ')}</span>
    </span>
  );
}

function historyTitle(event: HistoryEvent): string {
  switch (event.kind) {
    case 'created':
      return event.templateId
        ? tf('history.createdFrom', {
            template: t(`template.${event.templateId}.title` as MessageKey),
          })
        : t('history.created');
    case 'proposed':
      return t('history.proposed');
    case 'proposal_returned':
      return t('history.returned');
    case 'probation_extended':
      return tf('history.extended', { days: event.days ?? 0 });
    default:
      if (event.toStatus === 'active' && event.fromStatus === 'suspended')
        return t('history.to.resumed');
      return t(`history.to.${event.toStatus}` as MessageKey);
  }
}

/** Status history, newest first (spec worker-lifecycle "Lịch sử trạng thái"). */
export function HistoryPanel({ workerId }: { workerId: string }) {
  const { data, error } = useQuery(workerHistoryQuery(workerId));
  return (
    <section
      aria-labelledby="history-title"
      className="rounded-[calc(var(--radius)+4px)] border bg-background p-5 shadow-[var(--shadow-sm)]"
    >
      <h2 id="history-title" className="mb-3 font-semibold">
        {t('history.title')}
      </h2>
      {error ? (
        <Callout tone="danger" role="alert">
          {apiErrorMessage(error)}
        </Callout>
      ) : null}
      {data && data.events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('history.empty')}</p>
      ) : null}
      <ol className="relative grid gap-3.5 before:absolute before:top-1.5 before:bottom-1.5 before:left-[0.3125rem] before:w-px before:bg-border">
        {data?.events.map((event, index) => {
          const who =
            event.proposer && event.actor
              ? tf('history.approvedProposal', {
                  actor: event.actor.name,
                  proposer: event.proposer.name,
                })
              : (event.actor?.name ?? '');
          return (
            <li key={event.id} className="relative grid grid-cols-[0.75rem_1fr] gap-3">
              <i
                aria-hidden="true"
                className={`relative mt-1.5 size-2.5 rounded-full border-2 border-background ${index === 0 ? 'bg-primary' : 'bg-border-strong'}`}
              />
              <div className="min-w-0">
                <b className="block text-sm">{historyTitle(event)}</b>
                <small className="block text-xs text-muted-foreground">
                  {[
                    formatShortDate(event.createdAt),
                    who,
                    event.reason ? `"${event.reason}"` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Edit the testers list: department members or Owner / Admin, at most 10 (#110). */
export function TestersDialog({
  worker,
  people,
  onClose,
}: {
  worker: WorkerDetail;
  people: readonly Person[];
  onClose: () => void;
}) {
  const ids = useId();
  const [chosen, setChosen] = useState<string[]>(() => worker.testers.map((p) => p.id));
  const save = useWorkerMutation<{ memberIds: string[] }>(
    `/api/workers/${worker.id}/testers`,
    'PUT',
  );
  const options = [
    ...worker.testers,
    ...people.filter((p) => !worker.testers.some((tst) => tst.id === p.id)),
  ];
  const tooMany = chosen.length > MAX_TESTERS;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (tooMany) return;
    save.mutate({ memberIds: chosen }, { onSuccess: onClose });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? null : onClose())}
      title={t('dialog.testers.title')}
      description={t('dialog.testers.body')}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={`${ids}-form`} disabled={save.isPending || tooMany}>
            {save.isPending ? <Spinner /> : null}
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id={`${ids}-form`} onSubmit={submit} className="grid gap-3">
        <fieldset className="grid max-h-72 gap-1 overflow-y-auto">
          <legend className="sr-only">{t('dialog.testers.title')}</legend>
          {options.map((person) => (
            <label
              key={person.id}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted"
            >
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={chosen.includes(person.id)}
                onChange={(e) =>
                  setChosen((current) =>
                    e.target.checked
                      ? [...current, person.id]
                      : current.filter((id) => id !== person.id),
                  )
                }
              />
              <Avatar name={person.name} seed={person.id} className="size-7 text-[0.6rem]" />
              <span className="text-sm">{person.name}</span>
            </label>
          ))}
        </fieldset>
        {tooMany ? (
          <Callout tone="danger" role="alert">
            {t('dialog.testers.tooMany')}
          </Callout>
        ) : null}
        {save.error ? (
          <Callout tone="danger" role="alert">
            {apiErrorMessage(save.error)}
          </Callout>
        ) : null}
      </form>
    </Dialog>
  );
}

/** Owner / Admin move a worker to another department (#052). */
export function MoveDepartmentDialog({
  worker,
  departments,
  onClose,
}: {
  worker: WorkerDetail;
  departments: readonly { id: string; name: string }[];
  onClose: () => void;
}) {
  const ids = useId();
  const others = departments.filter((dept) => dept.id !== worker.department.id);
  const [departmentId, setDepartmentId] = useState(others[0]?.id ?? '');
  const move = useWorkerMutation<{ departmentId: string }>(`/api/workers/${worker.id}/department`);

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? null : onClose())}
      title={t('dialog.department.title')}
      description={t('dialog.department.body')}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={move.isPending || !departmentId}
            onClick={() => move.mutate({ departmentId }, { onSuccess: onClose })}
          >
            {move.isPending ? <Spinner /> : null}
            {t('dialog.confirm')}
          </Button>
        </>
      }
    >
      <Field id={`${ids}-dept`} label={t('profile.form.department')}>
        {(aria) => (
          <Select {...aria} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {others.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {move.error ? (
        <Callout tone="danger" role="alert">
          {apiErrorMessage(move.error)}
        </Callout>
      ) : null}
    </Dialog>
  );
}

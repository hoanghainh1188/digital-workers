import { type WorkerEvent, workerNameKey } from '@dw/core/workers';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/field';
import { t, tf } from '@/i18n/t';
import { apiErrorMessage } from '@/lib/form-errors';
import { useWorkerMutation, type WorkerDetail } from '@/lib/workers';

/** Events with their own dialog here ('editTesters' has the testers dialog). */
export type DialogEvent = Exclude<WorkerEvent, 'editTesters'>;

type Kind = 'transition' | 'propose' | 'return' | 'extend';
const KIND: Record<DialogEvent, Kind> = {
  startProbation: 'transition',
  activate: 'transition',
  suspend: 'transition',
  resume: 'transition',
  offboard: 'transition',
  propose: 'propose',
  returnProposal: 'return',
  extendProbation: 'extend',
};

const TITLE = {
  startProbation: 'dialog.startProbation.title',
  activate: 'dialog.activate.title',
  suspend: 'dialog.suspend.title',
  resume: 'dialog.resume.title',
  offboard: 'dialog.offboard.title',
  propose: 'dialog.propose.title',
  returnProposal: 'dialog.return.title',
  extendProbation: 'dialog.extend.title',
} as const;

const BODY = {
  startProbation: 'dialog.startProbation.body',
  activate: 'dialog.activate.body',
  suspend: 'dialog.suspend.body',
  resume: 'dialog.resume.body',
  offboard: 'dialog.offboard.body',
  propose: 'dialog.propose.body',
  returnProposal: 'dialog.return.body',
  extendProbation: 'dialog.extend.body',
} as const;

/** Reason: required for offboarding and returning (#054), optional for suspending. */
const REASON: Partial<Record<DialogEvent, 'required' | 'optional'>> = {
  offboard: 'required',
  returnProposal: 'required',
  suspend: 'optional',
};

/**
 * One dialog per lifecycle action (worker-profile.html). The api re-checks everything;
 * the dialog only collects what it needs: reason, typed name, note or days.
 */
export function LifecycleDialog({
  worker,
  event,
  onDone,
  onClose,
}: {
  worker: WorkerDetail;
  event: DialogEvent;
  onDone: () => void;
  onClose: () => void;
}) {
  const ids = useId();
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [note, setNote] = useState('');
  const [days, setDays] = useState<7 | 14>(7);
  const kind = KIND[event];
  const base = `/api/workers/${worker.id}`;
  const transition = useWorkerMutation<Record<string, unknown>>(`${base}/transitions`);
  const propose = useWorkerMutation<Record<string, unknown>>(`${base}/promotion-request`);
  const giveBack = useWorkerMutation<Record<string, unknown>>(`${base}/promotion-request/return`);
  const extend = useWorkerMutation<Record<string, unknown>>(`${base}/probation/extend`);
  const mutation = { transition, propose, return: giveBack, extend }[kind];

  const reasonMode = REASON[event];
  const nameMatches = workerNameKey(confirmName) === workerNameKey(worker.name);
  const blocked =
    (reasonMode === 'required' && reason.trim() === '') || (event === 'offboard' && !nameMatches);

  function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (blocked) return;
    const body =
      kind === 'transition'
        ? {
            event,
            expectedStatus: worker.status,
            ...(reasonMode ? { reason } : {}),
            ...(event === 'offboard' ? { confirmName } : {}),
          }
        : kind === 'propose'
          ? { note }
          : kind === 'return'
            ? { reason }
            : { days };
    mutation.mutate(body, { onSuccess: onDone });
  }

  const danger = event === 'offboard';
  return (
    <Dialog
      open
      role={danger ? 'alertdialog' : 'dialog'}
      onOpenChange={(open) => (open ? null : onClose())}
      title={tf(TITLE[event], { name: worker.name })}
      description={t(BODY[event])}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form={`${ids}-form`}
            variant={danger ? 'danger' : 'default'}
            disabled={mutation.isPending || blocked}
          >
            {mutation.isPending ? <Spinner /> : null}
            {t(`action.${event}`)}
          </Button>
        </>
      }
    >
      <form id={`${ids}-form`} onSubmit={submit} className="grid gap-4" noValidate>
        {danger ? <OffboardConsequences /> : null}
        {kind === 'extend' ? (
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">{t('dialog.extend.title')}</legend>
            {([7, 14] as const).map((value) => (
              <Choice
                key={value}
                name={`${ids}-days`}
                checked={days === value}
                onChange={() => setDays(value)}
              >
                {tf('dialog.extend.days', { days: value })}
              </Choice>
            ))}
          </fieldset>
        ) : null}
        {kind === 'propose' ? (
          <Field id={`${ids}-note`} label={t('dialog.note')} hint={t('dialog.reason.optional')}>
            {(aria) => (
              <Textarea
                {...aria}
                rows={3}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        {reasonMode ? (
          <Field
            id={`${ids}-reason`}
            label={
              <>
                {t('dialog.reason')}{' '}
                <span className="font-normal text-muted-foreground">
                  {t(
                    reasonMode === 'required' ? 'dialog.reason.required' : 'dialog.reason.optional',
                  )}
                </span>
              </>
            }
          >
            {(aria) => (
              <Input
                {...aria}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        {event === 'offboard' ? (
          <Field id={`${ids}-confirm`} label={tf('dialog.offboard.confirm', { name: worker.name })}>
            {(aria) => (
              <Input
                {...aria}
                autoComplete="off"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        {mutation.error ? (
          <Callout tone="danger" role="alert">
            {apiErrorMessage(mutation.error)}
          </Callout>
        ) : null}
      </form>
    </Dialog>
  );
}

function OffboardConsequences() {
  return (
    <ul className="grid gap-1.5 rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive-ink">
      <li>{t('dialog.offboard.revoke')}</li>
      <li>{t('dialog.offboard.stop')}</li>
      <li className="text-muted-foreground">{t('dialog.offboard.keep')}</li>
    </ul>
  );
}

/** Pill radio (worker-profile.html .voice). */
export function Choice({
  name,
  checked,
  onChange,
  disabled = false,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="relative inline-flex h-9 cursor-pointer items-center rounded-full border border-border-strong px-3.5 text-sm transition-colors duration-150 hover:border-[oklch(76%_0.06_258)] has-checked:border-primary has-checked:bg-primary-soft has-checked:font-semibold has-checked:text-primary-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring has-disabled:cursor-default has-disabled:opacity-60">
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="absolute opacity-0"
      />
      {children}
    </label>
  );
}

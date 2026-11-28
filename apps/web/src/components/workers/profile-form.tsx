import { JOB_DESCRIPTION_MAX, VOICE_PRESETS, workerPatchInput } from '@dw/core/workers';
import { type FormEvent, useId, useState } from 'react';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { t } from '@/i18n/t';
import { ApiError } from '@/lib/api';
import { apiErrorMessage, fromZodIssues, toFieldErrors } from '@/lib/form-errors';
import type { Person } from '@/lib/org';
import { formatVnd, parseVnd, useWorkerMutation, type WorkerDetail } from '@/lib/workers';
import { Choice } from './lifecycle-dialogs.tsx';

const CUSTOM = 'custom';
type Voice = (typeof VOICE_PRESETS)[number] | typeof CUSTOM | null;

type Draft = {
  name: string;
  jobDescription: string;
  voice: Voice;
  voiceCustom: string;
  budget: string;
  managerMemberId: string;
};

const money = new Intl.NumberFormat('vi-VN');

function draftOf(worker: WorkerDetail): Draft {
  return {
    name: worker.name,
    jobDescription: worker.jobDescription,
    voice: worker.voiceCustom ? CUSTOM : worker.voicePreset,
    voiceCustom: worker.voiceCustom ?? '',
    budget: money.format(worker.monthlyBudgetVnd),
    managerMemberId: worker.manager?.id ?? '',
  };
}

/**
 * Profile tab form (worker-profile.html "Hồ sơ"). Sends every field with the
 * `revision` it was loaded with; the api answers 409 PROFILE_CHANGED when stale.
 */
export function ProfileForm({
  worker,
  managers,
  isManagerRole,
  saved,
  onSaved,
  onMoveDepartment,
}: {
  worker: WorkerDetail;
  /** People who may manage this worker (department members, Owner / Admin). */
  managers: readonly Person[];
  isManagerRole: boolean;
  /** The page remounts the form on every new revision, so it owns the "saved" note. */
  saved: boolean;
  onSaved: (revision: number) => void;
  onMoveDepartment?: () => void;
}) {
  const ids = useId();
  const [draft, setDraft] = useState(() => draftOf(worker));
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const save = useWorkerMutation<Record<string, unknown>, { revision: number }>(
    `/api/workers/${worker.id}`,
    'PATCH',
  );
  const editable = worker.canEdit;
  const [dirty, setDirty] = useState(false);
  const set = (patch: Partial<Draft>) => {
    setDirty(true);
    setDraft((current) => ({ ...current, ...patch }));
  };

  const serverErrors = save.error instanceof ApiError ? toFieldErrors(save.error.details) : {};
  const errors = { ...serverErrors, ...clientErrors };
  const nameError =
    errors.name ??
    (save.error instanceof ApiError && save.error.code === 'WORKER_NAME_TAKEN'
      ? t('error.WORKER_NAME_TAKEN')
      : undefined);
  const general = save.error && !nameError && Object.keys(serverErrors).length === 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    const budget = parseVnd(draft.budget);
    const body = {
      revision: worker.revision,
      name: draft.name,
      jobDescription: draft.jobDescription,
      voicePreset: draft.voice === CUSTOM ? null : draft.voice,
      voiceCustom: draft.voice === CUSTOM ? draft.voiceCustom : null,
      monthlyBudgetVnd: budget ?? Number.NaN,
      managerMemberId: draft.managerMemberId || null,
    };
    const parsed = workerPatchInput.safeParse(body);
    if (!parsed.success || budget === null) {
      const issues = parsed.success ? [] : fromZodIssues(parsed.error.issues);
      const found = toFieldErrors(issues);
      setClientErrors(
        budget === null ? { ...found, monthlyBudgetVnd: t('form.budget_integer') } : found,
      );
      return;
    }
    setClientErrors({});
    save.mutate(parsed.data, { onSuccess: (result) => onSaved(result.revision) });
  }

  const managerOptions =
    worker.manager && !managers.some((p) => p.id === worker.manager?.id)
      ? [worker.manager, ...managers]
      : managers;

  return (
    <section
      aria-labelledby={`${ids}-title`}
      className="rounded-[calc(var(--radius)+4px)] border bg-background p-5 shadow-[var(--shadow-sm)]"
    >
      <h2 id={`${ids}-title`} className="mb-4 flex items-center gap-2 font-semibold">
        {t('profile.form.title')}
        {editable ? null : (
          <span className="text-xs font-normal text-muted-foreground">
            {t('profile.form.readOnly')}
          </span>
        )}
      </h2>
      <form onSubmit={submit} noValidate>
        <fieldset disabled={!editable} className="grid gap-4.5 min-[641px]:grid-cols-2">
          <legend className="sr-only">{t('profile.form.title')}</legend>
          <Field
            id={`${ids}-name`}
            label={t('profile.form.name')}
            hint={t('profile.form.name.hint')}
            error={nameError}
          >
            {(aria) => (
              <Input
                {...aria}
                maxLength={60}
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            )}
          </Field>
          <Field
            id={`${ids}-dept`}
            label={t('profile.form.department')}
            hint={onMoveDepartment ? undefined : t('profile.form.department.hint')}
          >
            {(aria) => (
              <div className="flex gap-2">
                <Input {...aria} readOnly value={worker.department.name} className="bg-canvas" />
                {onMoveDepartment && editable ? (
                  <Button type="button" variant="outline" onClick={onMoveDepartment}>
                    {t('profile.form.department.change')}
                  </Button>
                ) : null}
              </div>
            )}
          </Field>
          <div className="min-[641px]:col-span-2">
            <Field
              id={`${ids}-job`}
              label={t('profile.form.job')}
              hint={t('profile.form.job.hint')}
              error={errors.jobDescription}
            >
              {(aria) => (
                <Textarea
                  {...aria}
                  rows={5}
                  maxLength={JOB_DESCRIPTION_MAX}
                  value={draft.jobDescription}
                  onChange={(e) => set({ jobDescription: e.target.value })}
                />
              )}
            </Field>
          </div>
          <Field
            id={`${ids}-mgr`}
            label={t('profile.form.manager')}
            hint={t('profile.form.manager.hint')}
            error={errors.managerMemberId}
          >
            {(aria) => (
              <Select
                {...aria}
                value={draft.managerMemberId}
                onChange={(e) => set({ managerMemberId: e.target.value })}
              >
                <option value="">{t('profile.form.manager.none')}</option>
                {managerOptions.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            id={`${ids}-budget`}
            label={t('profile.form.budget')}
            hint={
              worker.budgetLocked
                ? t('profile.form.budget.locked')
                : isManagerRole
                  ? t('profile.form.budget.managerHint')
                  : t('profile.form.budget.hint')
            }
            error={errors.monthlyBudgetVnd}
          >
            {(aria) => (
              <Input
                {...aria}
                inputMode="numeric"
                readOnly={worker.budgetLocked}
                value={editable ? draft.budget : formatVnd(worker.monthlyBudgetVnd)}
                onChange={(e) => set({ budget: e.target.value })}
                className={worker.budgetLocked ? 'bg-canvas' : undefined}
              />
            )}
          </Field>
          <fieldset className="grid gap-1.5 min-[641px]:col-span-2">
            <legend className="mb-1.5 text-sm font-medium">{t('profile.form.voice')}</legend>
            <div className="flex flex-wrap gap-2">
              {VOICE_PRESETS.map((preset) => (
                <Choice
                  key={preset}
                  name={`${ids}-voice`}
                  checked={draft.voice === preset}
                  disabled={!editable}
                  onChange={() => set({ voice: preset })}
                >
                  {t(`profile.form.voice.${preset}`)}
                </Choice>
              ))}
              <Choice
                name={`${ids}-voice`}
                checked={draft.voice === CUSTOM}
                disabled={!editable}
                onChange={() => set({ voice: CUSTOM })}
              >
                {t('profile.form.voice.custom')}
              </Choice>
            </div>
            {draft.voice === CUSTOM ? (
              <Field
                id={`${ids}-voice-custom`}
                label={<span className="sr-only">{t('profile.form.voice.customLabel')}</span>}
                error={errors.voiceCustom}
              >
                {(aria) => (
                  <Input
                    {...aria}
                    maxLength={500}
                    value={draft.voiceCustom}
                    onChange={(e) => set({ voiceCustom: e.target.value })}
                  />
                )}
              </Field>
            ) : null}
          </fieldset>
        </fieldset>
        {general ? (
          <Callout tone="danger" role="alert" className="mt-4">
            {apiErrorMessage(save.error)}
          </Callout>
        ) : null}
        {editable ? (
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            {saved && !dirty ? (
              <span role="status" className="mr-auto text-sm text-success-ink">
                {t('profile.form.saved')}
              </span>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft(draftOf(worker));
                setClientErrors({});
                save.reset();
              }}
            >
              {t('profile.form.reset')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Spinner /> : null}
              {t('profile.form.save')}
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}

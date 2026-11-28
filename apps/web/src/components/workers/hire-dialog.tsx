import { WORKER_TEMPLATES, workerNameKey } from '@dw/core/workers';
import { useNavigate } from '@tanstack/react-router';
import { Plus, Sparkles } from 'lucide-react';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { t } from '@/i18n/t';
import type { MessageKey } from '@/i18n/vi';
import { ApiError } from '@/lib/api';
import { apiErrorMessage, toFieldErrors } from '@/lib/form-errors';
import { useWorkerMutation } from '@/lib/workers';
import { WorkerAvatar } from './worker-badges.tsx';

const BLANK = 'blank';

export type HireDepartment = { id: string; name: string };

/** Template id → a free name: the suggestion, then " 2", " 3"… (design D6). */
function freeName(suggested: string, taken: ReadonlySet<string>): string {
  if (!taken.has(workerNameKey(suggested))) return suggested;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${suggested} ${n}`;
    if (!taken.has(workerNameKey(candidate))) return candidate;
  }
  return suggested;
}

/** Hire from a template or a blank profile (org-chart.html hire dialog, FR-02-07). */
export function HireDialog({
  departments,
  initialDepartmentId,
  initialTemplate = WORKER_TEMPLATES[0]?.id ?? BLANK,
  takenNames,
  managerOnly,
  onClose,
}: {
  departments: readonly HireDepartment[];
  initialDepartmentId?: string;
  initialTemplate?: string;
  takenNames: ReadonlySet<string>;
  managerOnly: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const ids = useId();
  const [template, setTemplate] = useState(initialTemplate);
  const suggestion = (id: string) => {
    const found = WORKER_TEMPLATES.find((tpl) => tpl.id === id);
    return found ? freeName(found.suggestedName, takenNames) : '';
  };
  const [name, setName] = useState(() => suggestion(initialTemplate));
  const [nameEdited, setNameEdited] = useState(false);
  const [departmentId, setDepartmentId] = useState(initialDepartmentId ?? departments[0]?.id ?? '');
  const create = useWorkerMutation<
    { name: string; departmentId: string; templateId: string | null },
    { id: string }
  >('/api/workers');

  const errors = create.error instanceof ApiError ? toFieldErrors(create.error.details) : {};
  const nameError =
    errors.name ??
    (create.error instanceof ApiError && create.error.code === 'WORKER_NAME_TAKEN'
      ? t('error.WORKER_NAME_TAKEN')
      : undefined);
  const generalError =
    create.error && !nameError && !errors.departmentId ? apiErrorMessage(create.error) : null;

  function choose(id: string) {
    setTemplate(id);
    if (!nameEdited) setName(suggestion(id));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate(
      { name, departmentId, templateId: template === BLANK ? null : template },
      {
        onSuccess: ({ id }) => {
          onClose();
          void navigate({ to: '/workers/$id', params: { id } });
        },
      },
    );
  }

  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => (open ? null : onClose())}
      title={t('hire.title')}
      description={t('hire.lead')}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={`${ids}-form`} disabled={create.isPending || !departmentId}>
            {create.isPending ? <Spinner /> : null}
            {t('hire.submit')}
          </Button>
        </>
      }
    >
      <form id={`${ids}-form`} onSubmit={submit} className="grid gap-4.5" noValidate>
        <fieldset className="grid gap-2.5 min-[561px]:grid-cols-2">
          <legend className="sr-only">{t('hire.templates')}</legend>
          {WORKER_TEMPLATES.map((tpl, index) => (
            <TemplateOption
              key={tpl.id}
              name={`${ids}-tpl`}
              checked={template === tpl.id}
              onChange={() => choose(tpl.id)}
              avatar={
                <WorkerAvatar
                  name={t(`template.${tpl.id}.title` as MessageKey)}
                  color={index}
                  size="sm"
                />
              }
              title={t(`template.${tpl.id}.title` as MessageKey)}
              body={t(`template.${tpl.id}.body` as MessageKey)}
            />
          ))}
          <TemplateOption
            name={`${ids}-tpl`}
            dashed
            checked={template === BLANK}
            onChange={() => choose(BLANK)}
            avatar={
              <span className="worker-avatar" data-off="" data-size="sm" aria-hidden="true">
                <Plus className="size-4" />
              </span>
            }
            title={t('hire.blank.title')}
            body={t('hire.blank.body')}
          />
          <TemplateOption
            name={`${ids}-tpl`}
            dashed
            disabled
            className="min-[561px]:col-span-2"
            avatar={
              <span className="worker-avatar" data-tint="3" data-size="sm" aria-hidden="true">
                <Sparkles className="size-4" />
              </span>
            }
            title={
              <>
                {t('hire.ai.title')}{' '}
                <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[0.625rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
                  {t('hire.soon')}
                </span>
              </>
            }
            body={t('hire.ai.body')}
          />
        </fieldset>
        <Field
          id={`${ids}-name`}
          label={t('hire.name')}
          hint={t('hire.name.hint')}
          error={nameError}
        >
          {(aria) => (
            <Input
              {...aria}
              value={name}
              maxLength={60}
              onChange={(event) => {
                setName(event.target.value);
                setNameEdited(true);
              }}
            />
          )}
        </Field>
        <Field
          id={`${ids}-dept`}
          label={t('hire.department')}
          hint={managerOnly ? t('hire.department.managerHint') : undefined}
          error={errors.departmentId}
        >
          {(aria) => (
            <Select
              {...aria}
              value={departmentId}
              disabled={managerOnly && departments.length <= 1}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {generalError ? (
          <Callout tone="danger" role="alert">
            {generalError}
          </Callout>
        ) : null}
      </form>
    </Dialog>
  );
}

function TemplateOption({
  name,
  checked = false,
  onChange,
  disabled = false,
  dashed = false,
  className = '',
  avatar,
  title,
  body,
}: {
  name: string;
  checked?: boolean;
  onChange?: () => void;
  disabled?: boolean;
  dashed?: boolean;
  className?: string;
  avatar: ReactNode;
  title: ReactNode;
  body: string;
}) {
  return (
    <label
      className={`relative grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-lg border border-border-strong bg-background p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-150 hover:border-[oklch(76%_0.06_258)] has-checked:border-primary has-checked:bg-primary-soft has-checked:shadow-[0_0_0_1px_var(--primary)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring ${dashed ? 'border-dashed' : ''} ${disabled ? 'cursor-not-allowed opacity-55' : ''} ${className}`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="absolute opacity-0"
      />
      <span className="row-span-2">{avatar}</span>
      <b className="text-sm">{title}</b>
      <small className="text-xs leading-[1.45] text-muted-foreground">{body}</small>
    </label>
  );
}

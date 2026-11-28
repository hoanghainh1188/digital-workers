import { departmentInput } from '@dw/core/org-schemas';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { t } from '@/i18n/t';
import { ApiError } from '@/lib/api';
import { apiErrorMessage, type FieldErrors, fromZodIssues, toFieldErrors } from '@/lib/form-errors';
import { allMembersQuery, type Department, type MemberRow } from '@/lib/org';
import { useCreateDepartment, useUpdateDepartment } from './use-departments.ts';

/** What will happen to people when the head changes — shown before saving (0.2 #036, #061). */
export function headChangeNotes(
  department: Department | null,
  candidate: MemberRow | undefined,
  previousHead: { id: string; name: string } | null,
): string[] {
  const notes: string[] = [];
  if (candidate && candidate.id !== previousHead?.id) {
    if (candidate.role === 'member')
      notes.push(`${candidate.name} ${t('departments.dialog.promote')}`);
    else if (candidate.departmentId !== department?.id) {
      notes.push(`${candidate.name} ${t('departments.dialog.moveHead')}`);
    }
  }
  if (previousHead && candidate?.id !== previousHead.id) {
    notes.push(`${previousHead.name} ${t('departments.dialog.demote')}`);
  }
  return notes;
}

/** Thêm / sửa phòng ban (departments.html dialog). */
export function DepartmentDialog({
  department,
  onClose,
}: {
  department: Department | null;
  onClose: () => void;
}) {
  const people = useQuery(allMembersQuery);
  const create = useCreateDepartment();
  const update = useUpdateDepartment(department?.id ?? '');
  const [name, setName] = useState(department?.name ?? '');
  const [description, setDescription] = useState(department?.description ?? '');
  const [headId, setHeadId] = useState(department?.head?.id ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const busy = create.isPending || update.isPending;

  // Only active Managers / Members can lead a department (spec departments).
  const eligible = (people.data ?? []).filter(
    (person) =>
      person.status === 'active' && (person.role === 'manager' || person.role === 'member'),
  );
  const candidate = eligible.find((person) => person.id === headId);
  const notes = headChangeNotes(department, candidate, department?.head ?? null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const parsed = departmentInput.safeParse({
      name,
      description,
      headMemberId: headId === '' ? null : headId,
    });
    if (!parsed.success) {
      setErrors(toFieldErrors(fromZodIssues(parsed.error.issues)));
      return;
    }
    setErrors({});
    try {
      if (department) {
        await update.mutateAsync({
          name: parsed.data.name,
          description: parsed.data.description,
          headMemberId: parsed.data.headMemberId,
        });
      } else {
        await create.mutateAsync(parsed.data);
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.details.length > 0)
        setErrors(toFieldErrors(error.details));
      else setFailure(apiErrorMessage(error));
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? null : onClose())}
      title={department ? t('departments.dialog.editTitle') : t('departments.dialog.addTitle')}
      description={t('departments.dialog.lead')}
      footer={
        <>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button type="submit" form="department-form" disabled={busy} aria-busy={busy}>
            {busy ? <Spinner /> : null}
            {department ? t('departments.dialog.submitEdit') : t('departments.dialog.submitAdd')}
          </Button>
        </>
      }
    >
      <form id="department-form" className="grid gap-4.5" noValidate onSubmit={onSubmit}>
        {failure ? (
          <Callout tone="danger" role="alert">
            {failure}
          </Callout>
        ) : null}
        <Field id="dept-name" label={t('departments.dialog.name')} error={errors.name}>
          {(aria) => (
            <Input
              {...aria}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          )}
        </Field>
        <Field
          id="dept-head"
          label={
            <>
              {t('departments.dialog.head')}{' '}
              <span className="text-xs font-normal text-muted-foreground">
                {t('common.optional')}
              </span>
            </>
          }
          error={errors.headMemberId}
        >
          {(aria) => (
            <Select {...aria} value={headId} onChange={(event) => setHeadId(event.target.value)}>
              <option value="">{t('departments.dialog.noHead')}</option>
              {eligible.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} — {t(`role.${person.role}`)}
                  {person.departmentName ? ` · ${person.departmentName}` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {notes.length > 0 ? (
          <div
            role="status"
            className="flex gap-2 rounded-lg bg-canvas px-3 py-2.5 text-xs text-muted-foreground"
          >
            <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <div className="grid gap-1">
              {notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          </div>
        ) : null}
        <Field
          id="dept-desc"
          label={
            <>
              {t('departments.dialog.description')}{' '}
              <span className="text-xs font-normal text-muted-foreground">
                {t('common.optional')}
              </span>
            </>
          }
          error={errors.description}
        >
          {(aria) => (
            <Textarea
              {...aria}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

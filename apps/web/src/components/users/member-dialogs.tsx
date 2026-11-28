import { assignableRoles, resolveMembership } from '@dw/core/member-rules';
import type { Role } from '@dw/core/permissions';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/field';
import { t } from '@/i18n/t';
import { ApiError } from '@/lib/api';
import { apiErrorMessage, type FieldErrors, toFieldErrors } from '@/lib/form-errors';
import { departmentsQuery, type MemberRow } from '@/lib/org';
import { useMemberAction, usePatchMember } from './use-members.ts';

type Close = { onClose: () => void };

function CancelButton() {
  return (
    <DialogClose asChild>
      <Button type="button" variant="ghost">
        {t('common.cancel')}
      </Button>
    </DialogClose>
  );
}

function useSubmit(onClose: () => void, onLastOwner?: () => void) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>) {
    setFailure(null);
    setErrors({});
    try {
      await action();
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'LAST_OWNER' && onLastOwner) onLastOwner();
      else if (error instanceof ApiError && error.details.length > 0)
        setErrors(toFieldErrors(error.details));
      else setFailure(apiErrorMessage(error));
    }
  }
  return { errors, failure, run };
}

/** Đổi vai trò. Manager / Member need a department, picked here when missing (0.2 #036). */
export function RoleDialog({
  member,
  actorRole,
  onClose,
  onLastOwner,
}: Close & { member: MemberRow; actorRole: Role; onLastOwner: () => void }) {
  const departments = useQuery(departmentsQuery);
  const patch = usePatchMember();
  const [role, setRole] = useState<Role>(member.role);
  const [departmentId, setDepartmentId] = useState(member.departmentId ?? '');
  const { errors, failure, run } = useSubmit(onClose, onLastOwner);
  const needsDepartment = !resolveMembership(
    { role: member.role, departmentId: member.departmentId },
    { role },
  ).ok;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    run(() =>
      patch.mutateAsync({
        id: member.id,
        role,
        ...(needsDepartment || departmentId !== (member.departmentId ?? '')
          ? { departmentId: departmentId === '' ? null : departmentId }
          : {}),
      }),
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? null : onClose())}
      title={`${t('users.role.title')} — ${member.name}`}
      footer={
        <>
          <CancelButton />
          <Button type="submit" form="role-form" disabled={patch.isPending || role === member.role}>
            {patch.isPending ? <Spinner /> : null}
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="role-form" className="grid gap-4" noValidate onSubmit={onSubmit}>
        {failure ? (
          <Callout tone="danger" role="alert">
            {failure}
          </Callout>
        ) : null}
        <Field id="role-select" label={t('users.col.role')} error={errors.role}>
          {(aria) => (
            <Select
              {...aria}
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              {assignableRoles(actorRole).map((option) => (
                <option key={option} value={option}>
                  {t(`role.${option}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {needsDepartment ? (
          <Field
            id="role-dept"
            label={t('users.role.department')}
            hint={t('users.role.departmentHint')}
            error={errors.departmentId}
          >
            {(aria) => (
              <Select
                {...aria}
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">{t('invites.department.choose')}</option>
                {(departments.data?.departments ?? []).map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
      </form>
    </Dialog>
  );
}

/** Chuyển phòng ban. Moving a Manager makes them a Member of the new department (0.2 #062). */
export function MoveDialog({ member, onClose }: Close & { member: MemberRow }) {
  const departments = useQuery(departmentsQuery);
  const patch = usePatchMember();
  const [departmentId, setDepartmentId] = useState(member.departmentId ?? '');
  const { errors, failure, run } = useSubmit(onClose);
  const canBeNone = member.role === 'owner' || member.role === 'admin';
  const movesManager = member.role === 'manager' && departmentId !== (member.departmentId ?? '');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    run(() =>
      patch.mutateAsync({ id: member.id, departmentId: departmentId === '' ? null : departmentId }),
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? null : onClose())}
      title={`${t('users.move.title')} — ${member.name}`}
      footer={
        <>
          <CancelButton />
          <Button
            type="submit"
            form="move-form"
            disabled={patch.isPending || departmentId === (member.departmentId ?? '')}
          >
            {patch.isPending ? <Spinner /> : null}
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="move-form" className="grid gap-4" noValidate onSubmit={onSubmit}>
        {failure ? (
          <Callout tone="danger" role="alert">
            {failure}
          </Callout>
        ) : null}
        <Field id="move-dept" label={t('users.role.department')} error={errors.departmentId}>
          {(aria) => (
            <Select
              {...aria}
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              {canBeNone || departmentId === '' ? (
                <option value="">
                  {canBeNone ? t('users.move.none') : t('invites.department.choose')}
                </option>
              ) : null}
              {(departments.data?.departments ?? []).map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {movesManager ? <Callout tone="warning">{t('users.move.managerWarning')}</Callout> : null}
      </form>
    </Dialog>
  );
}

export function LockDialog({ member, onClose }: Close & { member: MemberRow }) {
  const lock = useMemberAction('lock');
  const { failure, run } = useSubmit(onClose);
  return (
    <Dialog
      open
      role="alertdialog"
      onOpenChange={(open) => (open ? null : onClose())}
      title={`${t('users.lock.title')} — ${member.name}`}
      description={t('users.lock.body')}
      footer={
        <>
          <CancelButton />
          <Button
            type="button"
            className="bg-destructive hover:bg-destructive-ink"
            disabled={lock.isPending}
            onClick={() => run(() => lock.mutateAsync(member.id))}
          >
            {lock.isPending ? <Spinner /> : null}
            {t('users.lock.submit')}
          </Button>
        </>
      }
    >
      {failure ? (
        <Callout tone="danger" role="alert">
          {failure}
        </Callout>
      ) : null}
    </Dialog>
  );
}

/** "Không đổi được vai trò của bạn" (users.html, 0.2 #039). */
export function LastOwnerDialog({ onClose }: Close) {
  return (
    <Dialog
      open
      role="alertdialog"
      onOpenChange={(open) => (open ? null : onClose())}
      title={t('users.lastOwner.title')}
      description={t('users.lastOwner.body')}
      footer={
        <DialogClose asChild>
          <Button type="button">{t('common.close')}</Button>
        </DialogClose>
      }
    >
      <Callout tone="info">{t('users.lastOwner.hint')}</Callout>
    </Dialog>
  );
}

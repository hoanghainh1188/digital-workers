import { assignableRoles, isOwnerOnlyRole } from '@dw/core/member-rules';
import { invalidEmails, splitEmailList } from '@dw/core/org-schemas';
import { ROLES, type Role } from '@dw/core/permissions';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { type ClipboardEvent, type KeyboardEvent, useState } from 'react';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/field';
import { t, tf } from '@/i18n/t';
import { ApiError } from '@/lib/api';
import { apiErrorMessage, type FieldErrors, toFieldErrors } from '@/lib/form-errors';
import { departmentsQuery } from '@/lib/org';
import { cn } from '@/lib/utils';
import { type InviteResult, useInvite } from './use-members.ts';

/** Mời người dùng (users.html invite dialog, spec invitations). */
export function InviteDialog({
  actorRole,
  onClose,
  onSent,
}: {
  actorRole: Role;
  onClose: () => void;
  onSent: (result: InviteResult) => void;
}) {
  const departments = useQuery(departmentsQuery);
  const invite = useInvite();
  const allowed = assignableRoles(actorRole);
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [departmentId, setDepartmentId] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  const all = draft.trim() ? [...emails, ...splitEmailList(draft)] : emails;
  const unique = splitEmailList(all.join('\n'));
  const invalid = invalidEmails(unique);
  const needsDepartment = !isOwnerOnlyRole(role);
  const deptList = departments.data?.departments ?? [];

  function commitDraft(text: string) {
    const added = splitEmailList(text);
    if (added.length === 0) return;
    setEmails((current) => splitEmailList([...current, ...added].join('\n')));
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      event.preventDefault();
      commitDraft(draft);
    } else if (event.key === 'Backspace' && draft === '' && emails.length > 0) {
      setEmails((current) => current.slice(0, -1));
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    commitDraft(`${draft}\n${event.clipboardData.getData('text')}`);
  }

  async function submit() {
    setFailure(null);
    const nextErrors: Record<string, string> = {};
    if (unique.length === 0) nextErrors.emails = t('form.required.emails');
    if (needsDepartment && departmentId === '')
      nextErrors.departmentId = t('form.department_required');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || invalid.length > 0) return;
    try {
      const result = await invite.mutateAsync({
        emails: unique,
        role,
        departmentId: needsDepartment ? departmentId : null,
      });
      onSent(result);
    } catch (error) {
      if (error instanceof ApiError && error.details.length > 0)
        setErrors(toFieldErrors(error.details));
      else setFailure(apiErrorMessage(error));
    }
  }

  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => (open ? null : onClose())}
      title={t('invites.title')}
      description={t('invites.lead')}
      footer={
        <>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={submit}
            disabled={invite.isPending || invalid.length > 0 || unique.length === 0}
            title={invalid.length > 0 ? t('invites.fixFirst') : undefined}
            aria-busy={invite.isPending}
          >
            {invite.isPending ? <Spinner /> : null}
            {invite.isPending
              ? t('invites.submitting')
              : tf('invites.submit', { n: unique.length })}
          </Button>
        </>
      }
    >
      {failure ? (
        <Callout tone="danger" role="alert">
          {failure}
        </Callout>
      ) : null}
      <div className="grid gap-1.5">
        <label htmlFor="invite-emails" className="text-sm font-medium">
          {t('invites.emails')}
        </label>
        <div
          className={cn(
            'flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-border-strong bg-background p-1.5 focus-within:border-primary focus-within:shadow-[0_0_0_3px_oklch(62%_0.19_258/0.18)]',
            (invalid.length > 0 || errors.emails) && 'border-destructive',
          )}
        >
          {emails.map((email) => {
            const bad = invalid.includes(email);
            return (
              <span
                key={email}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-md pr-1 pl-2.5 text-sm',
                  bad
                    ? 'bg-destructive-soft text-destructive-ink'
                    : 'bg-primary-soft text-primary-ink',
                )}
              >
                {email}
                <button
                  type="button"
                  aria-label={`${t('invites.emails.remove')} ${email}`}
                  className="grid size-5 place-items-center rounded hover:bg-white/60"
                  onClick={() => setEmails((current) => current.filter((item) => item !== email))}
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </span>
            );
          })}
          <input
            id="invite-emails"
            className="min-w-[10rem] flex-1 bg-transparent px-1.5 py-1 text-sm outline-none"
            placeholder={t('invites.emails.placeholder')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => commitDraft(draft)}
            aria-describedby="invite-emails-hint invite-emails-error"
            aria-invalid={invalid.length > 0 || Boolean(errors.emails)}
          />
        </div>
        <span id="invite-emails-error" className="grid gap-0.5 text-xs text-destructive-ink">
          {invalid.map((email) => (
            <span key={email}>
              "{email}" {t('invites.emails.invalid')}
            </span>
          ))}
          {errors.emails ? <span>{errors.emails}</span> : null}
        </span>
        <span id="invite-emails-hint" className="text-xs text-muted-foreground">
          {t('invites.emails.hint')}
        </span>
      </div>

      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">{t('invites.role')}</legend>
        <div className="grid grid-cols-1 gap-2 min-[481px]:grid-cols-2">
          {ROLES.map((option) => {
            const enabled = allowed.includes(option);
            return (
              <label
                key={option}
                title={enabled ? undefined : t('invites.role.ownerOnly')}
                className={cn(
                  'grid cursor-pointer grid-cols-[1rem_1fr] gap-x-2.5 rounded-lg border p-3 transition-[border-color,background-color] duration-150 has-[:checked]:border-primary has-[:checked]:bg-primary-soft',
                  enabled ? 'hover:border-border-strong' : 'cursor-not-allowed opacity-55',
                )}
              >
                <input
                  type="radio"
                  name="invite-role"
                  value={option}
                  checked={role === option}
                  disabled={!enabled}
                  onChange={() => setRole(option)}
                  className="mt-1 accent-primary"
                />
                <b className="text-sm font-semibold">{t(`role.${option}`)}</b>
                <small className="col-start-2 text-xs text-muted-foreground">
                  {enabled ? t(`role.${option}.desc`) : t('invites.role.ownerOnly')}
                </small>
              </label>
            );
          })}
        </div>
      </fieldset>

      {needsDepartment ? (
        deptList.length === 0 && departments.data ? (
          <Callout tone="warning">{t('invites.department.noDepartments')}</Callout>
        ) : (
          <Field id="invite-dept" label={t('invites.department')} error={errors.departmentId}>
            {(aria) => (
              <Select
                {...aria}
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">{t('invites.department.choose')}</option>
                {deptList.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )
      ) : null}
    </Dialog>
  );
}

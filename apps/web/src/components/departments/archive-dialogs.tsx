import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Spinner } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { t, tf } from '@/i18n/t';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/form-errors';
import type { Department } from '@/lib/org';
import { useArchiveDepartment } from './use-departments.ts';

type Blocked = { members: number; invitations: number };

function blockedCounts(error: unknown): Blocked | null {
  if (!(error instanceof ApiError) || error.code !== 'DEPARTMENT_NOT_EMPTY') return null;
  const info = (error.info ?? {}) as Partial<Blocked>;
  return { members: info.members ?? 0, invitations: info.invitations ?? 0 };
}

/**
 * Confirm, then archive (0.2 #037). A department that still has people or
 * pending invitations shows "Chưa lưu trữ được phòng …" with the counts (#064).
 */
export function ArchiveDepartmentDialogs({
  department,
  onClose,
}: {
  department: Department;
  onClose: () => void;
}) {
  const archive = useArchiveDepartment(department.id);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function confirm() {
    setFailure(null);
    try {
      await archive.mutateAsync();
      onClose();
    } catch (error) {
      const counts = blockedCounts(error);
      if (counts) setBlocked(counts);
      else setFailure(apiErrorMessage(error));
    }
  }

  const close = (open: boolean) => (open ? null : onClose());

  if (blocked) {
    return (
      <Dialog
        open
        role="alertdialog"
        onOpenChange={close}
        title={`${t('departments.blocked.title')} ${department.name}`}
        description={
          <>
            {blocked.members > 0 ? tf('departments.blocked.people', blocked) : null}{' '}
            {blocked.invitations > 0 ? tf('departments.blocked.invites', blocked) : null}
          </>
        }
        footer={
          <>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t('common.close')}
              </Button>
            </DialogClose>
            {blocked.members > 0 ? (
              <Button asChild>
                <Link to="/users" search={{ department: department.id }}>
                  {t('departments.blocked.toUsers')}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
    );
  }

  return (
    <Dialog
      open
      onOpenChange={close}
      title={`${t('departments.archiveConfirm.title')} ${department.name}`}
      description={t('departments.archiveConfirm.body')}
      footer={
        <>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={confirm}
            disabled={archive.isPending}
            aria-busy={archive.isPending}
          >
            {archive.isPending ? <Spinner /> : null}
            {t('departments.archiveConfirm.submit')}
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

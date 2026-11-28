import { RISK_LEVELS, type RiskLevel } from '@dw/core/skills';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/field';
import { t, tf } from '@/i18n/t';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/form-errors';
import { type SkillDetail, useSkillMutation } from '@/lib/skills';

export type Review =
  | { kind: 'approve'; number: number; hasScripts: boolean; proposed: RiskLevel }
  | { kind: 'reject'; number: number }
  | { kind: 'rollback'; number: number }
  | { kind: 'archive' };

/** Duyệt / Từ chối / Quay lại / Lưu trữ (Owner / Admin; the API re-checks every rule). */
export function ReviewDialog({
  skill,
  review,
  onClose,
  onDone,
}: {
  skill: SkillDetail;
  review: Review;
  onClose: () => void;
  onDone: () => void;
}) {
  const path =
    review.kind === 'approve' || review.kind === 'reject'
      ? `/api/skills/${skill.id}/versions/${review.number}/${review.kind}`
      : `/api/skills/${skill.id}/${review.kind}`;
  const mutation = useSkillMutation<unknown>(path);
  const [risk, setRisk] = useState<RiskLevel>(
    review.kind === 'approve' ? (review.hasScripts ? 'high' : review.proposed) : 'low',
  );
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);

  const inUse =
    mutation.error instanceof ApiError && mutation.error.code === 'SKILL_IN_USE'
      ? ((mutation.error.info as { count?: number } | null)?.count ?? skill.holderCount)
      : null;

  function submit() {
    if (review.kind === 'reject' && reason.trim() === '') {
      setReasonError(true);
      return;
    }
    const body =
      review.kind === 'approve'
        ? { risk }
        : review.kind === 'reject'
          ? { reason: reason.trim() }
          : review.kind === 'rollback'
            ? { versionNumber: review.number }
            : undefined;
    mutation.mutate(body, { onSuccess: onDone });
  }

  const title =
    review.kind === 'archive'
      ? t('skill.archiveDialog.title')
      : tf(`skill.${review.kind}Dialog.title`, { n: review.number });
  const action =
    review.kind === 'archive'
      ? t('skill.archive')
      : review.kind === 'rollback'
        ? tf('skill.rollback', { n: review.number })
        : t(`skill.${review.kind}`);

  return (
    <Dialog
      open
      role={inUse !== null ? 'alertdialog' : 'dialog'}
      onOpenChange={(open) => (open ? null : onClose())}
      title={title}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          {inUse === null ? (
            <Button
              type="button"
              variant={review.kind === 'reject' || review.kind === 'archive' ? 'danger' : 'default'}
              disabled={mutation.isPending}
              onClick={submit}
            >
              {action}
            </Button>
          ) : null}
        </>
      }
    >
      {review.kind === 'approve' ? (
        <>
          <p className="text-sm">{tf('skill.approveDialog.body', { n: review.number })}</p>
          <Field
            id="approve-risk"
            label={t('skill.approveDialog.risk')}
            hint={review.hasScripts ? t('skill.approveDialog.scriptsLocked') : undefined}
          >
            {(props) => (
              <Select
                {...props}
                value={risk}
                disabled={review.hasScripts}
                onChange={(event) => setRisk(event.target.value as RiskLevel)}
              >
                {RISK_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(`risk.${level}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </>
      ) : null}
      {review.kind === 'reject' ? (
        <Field
          id="reject-reason"
          label={t('skill.rejectDialog.reason')}
          hint={t('skill.rejectDialog.hint')}
          error={reasonError ? t('form.required') : undefined}
        >
          {(props) => (
            <Textarea
              {...props}
              value={reason}
              maxLength={500}
              onChange={(event) => {
                setReason(event.target.value);
                setReasonError(false);
              }}
            />
          )}
        </Field>
      ) : null}
      {review.kind === 'rollback' ? (
        <p className="text-sm">{tf('skill.rollbackDialog.body', { n: review.number })}</p>
      ) : null}
      {review.kind === 'archive' && inUse === null ? (
        <p className="text-sm">{t('skill.archiveDialog.body')}</p>
      ) : null}
      {inUse !== null ? (
        <Callout tone="warning" role="alert">
          <p>{tf('skill.archiveDialog.inUse', { count: inUse })}</p>
          <ul className="mt-2 grid gap-1">
            {skill.holders.map((holder) => (
              <li key={holder.workerId}>
                <Link to="/workers/$id" params={{ id: holder.workerId }}>
                  {holder.workerName}
                </Link>
              </li>
            ))}
          </ul>
        </Callout>
      ) : mutation.error ? (
        <Callout tone="danger" role="alert">
          {apiErrorMessage(mutation.error)}
        </Callout>
      ) : null}
    </Dialog>
  );
}

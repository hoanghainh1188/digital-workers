import type { Role } from '@dw/core/permissions';
import { type AssignmentDecision, canAssignSkills, decideAssignment } from '@dw/core/skills';
import type { WorkerStatus } from '@dw/core/workers';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/field';
import { WorkerStatusBadge } from '@/components/workers/worker-badges';
import { t, tf } from '@/i18n/t';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/form-errors';
import {
  type SkillDetail,
  sendRaw,
  skillsQuery,
  useRefreshSkills,
  type WorkerSkill,
  workerSkillsQuery,
} from '@/lib/skills';
import { workersQuery } from '@/lib/workers';
import { AssignmentBadge, RiskMeter, ScriptBadge } from './skill-badges.tsx';

/**
 * Giving skills to workers from both places (design D8): the skill page ("Giao thêm")
 * and the worker's Kỹ năng tab. Both call POST /api/workers/:id/skills; the notice is a
 * preview from `decideAssignment`, the API decides.
 */

type SkillFacts = { archived: boolean; approved: boolean; hasScripts: boolean };

function previewText(decision: AssignmentDecision): {
  tone: 'info' | 'warning' | 'danger';
  text: string;
} {
  if (decision === 'grant') return { tone: 'info', text: t('assign.willGrant') };
  if (decision === 'request') return { tone: 'warning', text: t('assign.willRequest') };
  if (decision.error === 'SKILL_NEEDS_REVIEW') {
    return { tone: 'danger', text: t('assign.needsReview') };
  }
  return { tone: 'danger', text: t(`error.${decision.error}`) };
}

function useAssignActions() {
  const refresh = useRefreshSkills();
  const opts = { onSuccess: refresh };
  return {
    assign: useMutation({
      mutationFn: (input: { workerId: string; skillId: string }) =>
        api<{ status: 'active' | 'pending' }>(`/api/workers/${input.workerId}/skills`, {
          method: 'POST',
          body: { skillId: input.skillId },
        }),
      ...opts,
    }),
    decide: useMutation({
      mutationFn: (input: { workerId: string; skillId: string; decision: 'approve' | 'reject' }) =>
        api(`/api/workers/${input.workerId}/skills/${input.skillId}/${input.decision}`, {
          method: 'POST',
        }),
      ...opts,
    }),
    remove: useMutation({
      mutationFn: (input: { workerId: string; skillId: string }) =>
        sendRaw(`/api/workers/${input.workerId}/skills/${input.skillId}`, 'DELETE'),
      ...opts,
    }),
  };
}

function AssignDialog({
  title,
  label,
  options,
  preview,
  onSubmit,
  onClose,
  pending,
  error,
}: {
  title: string;
  label: string;
  options: { id: string; label: string }[];
  preview: (id: string) => AssignmentDecision | null;
  onSubmit: (id: string) => void;
  onClose: () => void;
  pending: boolean;
  error: unknown;
}) {
  const [chosen, setChosen] = useState('');
  const decision = chosen ? preview(chosen) : null;
  const notice = decision ? previewText(decision) : null;
  const blocked = decision !== null && typeof decision === 'object';
  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? null : onClose())}
      title={title}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!chosen || pending || blocked}
            onClick={() => onSubmit(chosen)}
          >
            {t('assign.submit')}
          </Button>
        </>
      }
    >
      <Field id="assign-target" label={label}>
        {(props) => (
          <Select {...props} value={chosen} onChange={(event) => setChosen(event.target.value)}>
            <option value="">{t('assign.choose')}</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {notice ? (
        <Callout tone={notice.tone} role="status">
          {notice.text}
        </Callout>
      ) : null}
      {error ? (
        <Callout tone="danger" role="alert">
          {apiErrorMessage(error)}
        </Callout>
      ) : null}
    </Dialog>
  );
}

const isOwnerAdmin = (role: Role) => role === 'owner' || role === 'admin';

/** "Nhân viên số đang dùng" + "Giao thêm" on the skill page. */
export function HoldersPanel({ skill, role }: { skill: SkillDetail; role: Role }) {
  const workers = useQuery(workersQuery());
  const actions = useAssignActions();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const myDepartmentId = workers.data?.myDepartmentId ?? null;
  const held = new Set(skill.holders.map((holder) => holder.workerId));
  const candidates = (workers.data?.workers ?? []).filter(
    (worker) => worker.status !== 'offboarded' && !held.has(worker.id),
  );
  const actor = { role, departmentId: myDepartmentId };
  const preview: SkillFacts = {
    archived: skill.archived,
    approved: skill.currentNumber !== null,
    hasScripts: skill.hasScripts && skill.currentNumber !== null,
  };
  const decisionFor = (worker: (typeof candidates)[number]) =>
    decideAssignment(
      actor,
      { status: worker.status, departmentId: worker.department.id },
      { ...preview, alreadyAssigned: false },
    );
  // Only workers this person may give skills to at all (matrix row "Giao / gỡ skill").
  const assignable = candidates.filter((worker) => {
    const decision = decisionFor(worker);
    return typeof decision !== 'object' || decision.error !== 'FORBIDDEN';
  });
  const canAssignSome = !skill.archived && assignable.length > 0;
  const hidden = skill.holderCount - skill.holders.length;

  return (
    <section
      aria-labelledby="holders-h"
      className="rounded-[calc(var(--radius)+4px)] border bg-background p-5 shadow-[var(--shadow-sm)]"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="holders-h" className="text-base font-semibold">
          {t('holders.title')}
        </h2>
        {canAssignSome ? (
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            <Plus />
            {t('holders.assign')}
          </Button>
        ) : null}
      </div>
      {done ? (
        <p role="status" className="mb-2 text-sm text-success-ink">
          {done}
        </p>
      ) : null}
      {skill.holders.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('holders.empty')}</p>
      ) : (
        <ul className="grid gap-2">
          {skill.holders.map((holder) => (
            <li
              key={holder.workerId}
              className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <Link
                to="/workers/$id"
                params={{ id: holder.workerId }}
                className="min-w-0 truncate font-medium"
              >
                {holder.workerName}
              </Link>
              <WorkerStatusBadge status={holder.workerStatus as WorkerStatus} probation={null} />
              <AssignmentBadge status={holder.status} />
              {holder.status === 'active' && skill.currentNumber ? (
                <span className="text-xs text-muted-foreground">
                  {tf('holders.version', { n: skill.currentNumber })}
                </span>
              ) : null}
              <span className="ml-auto flex gap-1.5">
                {holder.status === 'pending' && isOwnerAdmin(role) ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8"
                      onClick={() =>
                        actions.decide.mutate({
                          workerId: holder.workerId,
                          skillId: skill.id,
                          decision: 'approve',
                        })
                      }
                    >
                      {t('assign.approve')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8"
                      onClick={() =>
                        actions.decide.mutate({
                          workerId: holder.workerId,
                          skillId: skill.id,
                          decision: 'reject',
                        })
                      }
                    >
                      {t('assign.reject')}
                    </Button>
                  </>
                ) : null}
                {canAssignSkills(actor, holder) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8"
                    aria-label={tf('assign.removeLabel', {
                      skill: skill.title,
                      worker: holder.workerName,
                    })}
                    onClick={() =>
                      actions.remove.mutate({ workerId: holder.workerId, skillId: skill.id })
                    }
                  >
                    {t('assign.remove')}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {tf('holders.hidden', { count: hidden })}
        </p>
      ) : null}
      {actions.decide.error || actions.remove.error ? (
        <Callout tone="danger" role="alert" className="mt-3">
          {apiErrorMessage(actions.decide.error ?? actions.remove.error)}
        </Callout>
      ) : null}
      {open ? (
        <AssignDialog
          title={t('assign.title')}
          label={t('assign.worker')}
          options={assignable.map((worker) => ({
            id: worker.id,
            label: `${worker.name} · ${worker.department.name}`,
          }))}
          preview={(id) => {
            const worker = candidates.find((item) => item.id === id);
            return worker ? decisionFor(worker) : null;
          }}
          pending={actions.assign.isPending}
          error={actions.assign.error}
          onClose={() => setOpen(false)}
          onSubmit={(workerId) =>
            actions.assign.mutate(
              { workerId, skillId: skill.id },
              {
                onSuccess: (result) => {
                  setOpen(false);
                  setDone(t(`assign.done.${result.status}`));
                },
              },
            )
          }
        />
      ) : null}
    </section>
  );
}

/** Kỹ năng tab of a worker profile. */
export function WorkerSkillsTab({
  worker,
  role,
}: {
  worker: { id: string; name: string; status: WorkerStatus; department: { id: string } };
  role: Role;
}) {
  const { data, error } = useQuery(workerSkillsQuery(worker.id));
  const library = useQuery({ ...skillsQuery(), enabled: Boolean(data?.canAssign) });
  const workers = useQuery({ ...workersQuery(), enabled: Boolean(data?.canAssign) });
  const actions = useAssignActions();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const actor = { role, departmentId: workers.data?.myDepartmentId ?? null };
  const held = new Set((data?.skills ?? []).map((skill) => skill.skillId));
  const options = (library.data?.skills ?? []).filter(
    (skill) => skill.currentNumber !== null && !held.has(skill.id),
  );

  if (error) {
    return (
      <Callout tone="danger" role="alert">
        {apiErrorMessage(error)}
      </Callout>
    );
  }
  return (
    <section
      aria-labelledby="worker-skills-h"
      className="rounded-[calc(var(--radius)+4px)] border bg-background p-5 shadow-[var(--shadow-sm)]"
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="worker-skills-h" className="text-base font-semibold">
            {t('workerSkills.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('workerSkills.lead')}</p>
        </div>
        {data?.canAssign ? (
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            <Plus />
            {t('holders.assign')}
          </Button>
        ) : null}
      </div>
      {done ? (
        <p role="status" className="mb-2 text-sm text-success-ink">
          {done}
        </p>
      ) : null}
      {!data ? <p className="text-sm text-muted-foreground">{t('app.loading')}</p> : null}
      {data && data.skills.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('workerSkills.empty')}</p>
      ) : null}
      {data && data.skills.length > 0 ? (
        <ul className="grid gap-2">
          {data.skills.map((skill: WorkerSkill) => (
            <li
              key={skill.skillId}
              className="grid gap-1 rounded-lg border px-3 py-2.5 text-sm"
              data-skill={skill.name}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link to="/skills/$id" params={{ id: skill.skillId }} className="font-medium">
                  {skill.title}
                </Link>
                <AssignmentBadge status={skill.status} />
                {skill.currentNumber ? (
                  <span className="text-xs text-muted-foreground">
                    {tf('holders.version', { n: skill.currentNumber })}
                  </span>
                ) : null}
                {skill.risk ? <RiskMeter risk={skill.risk} /> : null}
                {skill.hasScripts ? <ScriptBadge /> : null}
                {skill.pendingNumber ? (
                  <span className="text-xs text-warning-ink">
                    {tf('assign.newPending', { n: skill.pendingNumber })}
                  </span>
                ) : null}
                <span className="ml-auto flex gap-1.5">
                  {skill.status === 'pending' && data.canApprove ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8"
                        onClick={() =>
                          actions.decide.mutate({
                            workerId: worker.id,
                            skillId: skill.skillId,
                            decision: 'approve',
                          })
                        }
                      >
                        {t('assign.approve')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8"
                        onClick={() =>
                          actions.decide.mutate({
                            workerId: worker.id,
                            skillId: skill.skillId,
                            decision: 'reject',
                          })
                        }
                      >
                        {t('assign.reject')}
                      </Button>
                    </>
                  ) : null}
                  {data.canAssign ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8"
                      aria-label={tf('assign.removeLabel', {
                        skill: skill.title,
                        worker: worker.name,
                      })}
                      onClick={() =>
                        actions.remove.mutate({ workerId: worker.id, skillId: skill.skillId })
                      }
                    >
                      {t('assign.remove')}
                    </Button>
                  ) : null}
                </span>
              </div>
              {skill.assignedBy ? (
                <small className="text-xs text-muted-foreground">
                  {tf('assign.by', { name: skill.assignedBy.name })}
                </small>
              ) : null}
              {skill.status === 'suspended' ? (
                <small className="text-xs text-destructive-ink">
                  {t('workerSkills.suspended')}
                </small>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {actions.decide.error || actions.remove.error ? (
        <Callout tone="danger" role="alert" className="mt-3">
          {apiErrorMessage(actions.decide.error ?? actions.remove.error)}
        </Callout>
      ) : null}
      {open ? (
        <AssignDialog
          title={t('assign.title')}
          label={t('assign.skill')}
          options={options.map((skill) => ({ id: skill.id, label: skill.title }))}
          preview={(id) => {
            const skill = options.find((item) => item.id === id);
            return skill
              ? decideAssignment(
                  actor,
                  { status: worker.status, departmentId: worker.department.id },
                  {
                    archived: false,
                    approved: true,
                    hasScripts: skill.hasScripts,
                    alreadyAssigned: false,
                  },
                )
              : null;
          }}
          pending={actions.assign.isPending}
          error={actions.assign.error}
          onClose={() => setOpen(false)}
          onSubmit={(skillId) =>
            actions.assign.mutate(
              { workerId: worker.id, skillId },
              {
                onSuccess: (result) => {
                  setOpen(false);
                  setDone(t(`assign.done.${result.status}`));
                },
              },
            )
          }
        />
      ) : null}
    </section>
  );
}

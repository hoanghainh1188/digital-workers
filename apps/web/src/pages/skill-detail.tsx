import { can } from '@dw/core/permissions';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Download, FileText, Folder } from 'lucide-react';
import { useState } from 'react';
import type { SignedInMe } from '@/components/app/app-shell';
import { HoldersPanel } from '@/components/skills/assignments';
import { type Review, ReviewDialog } from '@/components/skills/review-dialogs';
import {
  RiskMeter,
  ScriptBadge,
  SkillStatusBadge,
  VersionStatusBadge,
} from '@/components/skills/skill-badges';
import { SkillMdPreview } from '@/components/skills/skill-md-preview';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { t, tf } from '@/i18n/t';
import { apiErrorMessage } from '@/lib/form-errors';
import {
  encodePath,
  formatBytes,
  type SkillDetail,
  skillQuery,
  type VersionView,
  versionQuery,
} from '@/lib/skills';
import { cn } from '@/lib/utils';
import { formatShortDate } from '@/lib/workers';

/** Chi tiết kỹ năng (skill-library.html view "detail", spec skill-library). */
export function SkillDetailPage({
  me,
  id,
  version,
}: {
  me: SignedInMe;
  id: string;
  version?: number;
}) {
  const { data: skill, error, isPending } = useQuery(skillQuery(id));
  const [review, setReview] = useState<Review | null>(null);
  const [done, setDone] = useState(false);
  const shown = version ?? skill?.focusNumber;
  const view = useQuery({ ...versionQuery(id, shown ?? 1), enabled: shown !== undefined });
  const approves = can(me.member.role, 'skill.approve') !== false;

  if (isPending) return <p className="text-muted-foreground">{t('app.loading')}</p>;
  if (error || !skill) {
    return (
      <Callout tone="danger" role="alert">
        {apiErrorMessage(error)}
      </Callout>
    );
  }
  const pending = skill.versions.find((v) => v.status === 'pending');
  const nextNumber = (skill.versions[0]?.number ?? 0) + 1;

  return (
    <>
      <nav
        aria-label={t('skill.crumbs')}
        className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        <Link to="/skills">{t('skills.title')}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-foreground">
          {skill.title}
        </span>
      </nav>
      {done ? (
        <p role="status" className="sr-only">
          {t('skill.done')}
        </p>
      ) : null}
      {skill.archived ? (
        <Callout tone="info" className="mb-4">
          {t('skill.notice.archived')}
        </Callout>
      ) : null}
      {pending ? (
        <Callout tone="warning" className="mb-4">
          {skill.currentNumber
            ? tf('skill.notice.pendingWorkers', {
                pending: pending.number,
                current: skill.currentNumber,
              })
            : tf('skill.notice.pendingNoCurrent', { pending: pending.number })}
        </Callout>
      ) : null}
      {skill.hasScripts ? (
        <Callout tone="danger" className="mb-4">
          {t('skill.notice.scripts')}
        </Callout>
      ) : null}

      <section
        aria-labelledby="skill-title"
        className="mb-5 grid gap-4 rounded-[calc(var(--radius)+4px)] border bg-background p-6 shadow-[var(--shadow-card)] min-[901px]:grid-cols-[minmax(0,1fr)_auto]"
      >
        <div className="min-w-0">
          <h1
            id="skill-title"
            className="flex flex-wrap items-center gap-2.5 text-2xl leading-tight font-bold tracking-[-0.02em]"
          >
            {skill.title}
            <SkillStatusBadge status={skill.status} />
          </h1>
          <p className="mt-1 max-w-[60ch] text-muted-foreground">{skill.description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            <code className="rounded bg-muted px-1.5 font-mono text-xs">{skill.name}</code>
            <span>
              {skill.currentNumber
                ? tf('skills.card.version', { n: skill.currentNumber })
                : t('skills.card.noVersion')}
            </span>
            <RiskMeter risk={skill.risk} />
            {skill.hasScripts ? <ScriptBadge /> : null}
          </div>
        </div>
        <div className="flex flex-wrap content-start gap-2 min-[901px]:justify-end">
          {skill.currentNumber ? (
            <Button asChild variant="outline">
              <a href={`/api/skills/${skill.id}/export`} download>
                <Download />
                {t('skill.export')}
              </a>
            </Button>
          ) : null}
          {skill.archived ? null : (
            <Button asChild variant="outline">
              <Link to="/skills/$id/edit" params={{ id: skill.id }}>
                {skill.draftNumber ? t('skill.edit') : tf('skill.editNew', { n: nextNumber })}
              </Link>
            </Button>
          )}
          {approves && pending && !skill.archived ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setReview({ kind: 'reject', number: pending.number })}
              >
                {t('skill.reject')}
              </Button>
              <Button
                type="button"
                onClick={() =>
                  setReview({
                    kind: 'approve',
                    number: pending.number,
                    hasScripts: pending.hasScripts,
                    proposed: pending.proposedRisk ?? pending.suggestedRisk,
                  })
                }
              >
                {tf('skill.approveDialog.title', { n: pending.number })}
              </Button>
            </>
          ) : null}
          {approves && !skill.archived ? (
            <Button
              type="button"
              variant="dangerOutline"
              onClick={() => setReview({ kind: 'archive' })}
            >
              {t('skill.archive')}
            </Button>
          ) : null}
        </div>
      </section>

      <div className="grid items-start gap-5 min-[1025px]:grid-cols-[minmax(0,1.7fr)_minmax(17rem,1fr)]">
        <div className="grid min-w-0 gap-5">
          {view.data ? (
            <VersionContent skill={skill} view={view.data} />
          ) : (
            <p className="text-muted-foreground">{t('app.loading')}</p>
          )}
          <HoldersPanel skill={skill} role={me.member.role} />
        </div>
        <History
          skill={skill}
          shown={shown}
          approves={approves}
          onRollback={(n) => setReview({ kind: 'rollback', number: n })}
        />
      </div>

      {review ? (
        <ReviewDialog
          skill={skill}
          review={review}
          onClose={() => setReview(null)}
          onDone={() => {
            setReview(null);
            setDone(true);
          }}
        />
      ) : null}
    </>
  );
}

function VersionContent({ skill, view }: { skill: SkillDetail; view: VersionView }) {
  const [path, setPath] = useState('SKILL.md');
  const file = view.files.find((item) => item.path === path) ?? view.files[0];
  return (
    <section
      aria-labelledby="files-h"
      className="overflow-hidden rounded-[calc(var(--radius)+4px)] border bg-background shadow-[var(--shadow-sm)]"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-5 py-3">
        <h2 id="files-h" className="text-base font-semibold">
          {tf('skill.content', { n: view.number })}
        </h2>
        <VersionStatusBadge status={view.status} current={view.isCurrent} />
        {view.comparedTo ? (
          <span className="text-sm text-muted-foreground">
            {view.changeNote
              ? tf('skill.compared', { n: view.comparedTo, note: view.changeNote })
              : tf('skill.comparedNoNote', { n: view.comparedTo })}
          </span>
        ) : null}
      </header>
      <div className="grid min-[769px]:grid-cols-[13rem_minmax(0,1fr)]">
        <ul
          aria-label={t('skill.files')}
          className="m-0 grid content-start gap-0.5 border-b bg-canvas p-2 font-mono text-[0.78rem] min-[769px]:border-r min-[769px]:border-b-0"
        >
          {view.files.map((item) => {
            const depth = item.path.split('/').length - 1;
            return (
              <li key={item.path}>
                <button
                  type="button"
                  aria-current={item.path === file?.path ? 'true' : undefined}
                  onClick={() => setPath(item.path)}
                  style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
                  className={cn(
                    'flex w-full items-center gap-1.5 truncate rounded-md py-1.5 pr-2 text-left text-muted-foreground',
                    item.path === file?.path &&
                      'bg-background text-foreground shadow-[var(--shadow-sm)]',
                  )}
                >
                  {depth > 0 ? (
                    <Folder aria-hidden="true" className="size-3.5 shrink-0" />
                  ) : (
                    <FileText aria-hidden="true" className="size-3.5 shrink-0" />
                  )}
                  <span className="truncate">{item.path}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="min-w-0">
          {file?.path === 'SKILL.md' ? (
            <SkillMdPreview text={view.skillMd} label="SKILL.md" />
          ) : file ? (
            <div className="grid gap-3 p-5 text-sm">
              <p className="font-mono break-all">{file.path}</p>
              <p className="text-muted-foreground">{formatBytes(file.size)}</p>
              <Button asChild variant="outline" className="w-fit">
                <a
                  href={`/api/skills/${skill.id}/versions/${view.number}/files/${encodePath(file.path)}`}
                  download
                >
                  <Download />
                  {tf('skill.download', { path: file.path })}
                </a>
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function History({
  skill,
  shown,
  approves,
  onRollback,
}: {
  skill: SkillDetail;
  shown: number | undefined;
  approves: boolean;
  onRollback: (n: number) => void;
}) {
  const navigate = useNavigate();
  return (
    <section
      aria-labelledby="history-h"
      className="rounded-[calc(var(--radius)+4px)] border bg-background p-5 shadow-[var(--shadow-sm)]"
    >
      <h2 id="history-h" className="mb-3 text-base font-semibold">
        {t('skill.history')}
      </h2>
      <ol className="grid gap-3">
        {skill.versions.map((v) => {
          const current = v.number === skill.currentNumber;
          return (
            <li
              key={v.number}
              className={cn(
                'grid grid-cols-[2.25rem_minmax(0,1fr)] gap-2 rounded-lg p-2 text-sm',
                v.number === shown && 'bg-canvas',
              )}
            >
              <button
                type="button"
                className="h-7 rounded-md bg-muted font-mono text-xs font-bold"
                aria-label={tf('skill.content', { n: v.number })}
                onClick={() =>
                  void navigate({
                    to: '/skills/$id',
                    params: { id: skill.id },
                    search: { v: v.number },
                  })
                }
              >
                v{v.number}
              </button>
              <div className="grid min-w-0 gap-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <VersionStatusBadge status={v.status} current={current} />
                  {v.risk ? <RiskMeter risk={v.risk} /> : null}
                </div>
                {v.changeNote ? <span>{v.changeNote}</span> : null}
                <small className="text-xs text-muted-foreground">
                  {tf('skill.history.by', {
                    date: formatShortDate(v.submittedAt ?? v.createdAt),
                    name: (v.submittedBy ?? v.createdBy)?.name ?? '',
                  })}
                </small>
                {v.status === 'approved' && v.decidedBy && v.decidedAt ? (
                  <small className="text-xs text-muted-foreground">
                    {tf('skill.history.decided', {
                      name: v.decidedBy.name,
                      date: formatShortDate(v.decidedAt),
                    })}
                  </small>
                ) : null}
                {v.status === 'rejected' ? (
                  <small className="text-xs break-words text-destructive-ink">
                    {tf('skill.history.rejected', {
                      name: v.decidedBy?.name ?? '',
                      reason: v.rejectReason ?? '',
                    })}
                  </small>
                ) : null}
                {approves && v.everApproved && !current && !skill.archived ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-1 h-8 w-fit"
                    onClick={() => onRollback(v.number)}
                  >
                    {tf('skill.rollback', { n: v.number })}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

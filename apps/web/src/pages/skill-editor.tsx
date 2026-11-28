import { RISK_LEVELS, type RiskLevel } from '@dw/core/skills';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Trash2, Upload } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { CheckList } from '@/components/skills/check-list';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { t, tf } from '@/i18n/t';
import { ApiError, api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/form-errors';
import {
  type Check,
  checksOf,
  type DraftSaved,
  encodePath,
  formatBytes,
  quickCheck,
  type SkillDetail,
  sendRaw,
  skillQuery,
  useRefreshSkills,
  type VersionView,
  versionQuery,
} from '@/lib/skills';

/** Trình sửa kỹ năng (design D6, spec "Sửa kỹ năng tạo version mới"). */
export function SkillEditorPage({ id }: { id: string }) {
  const { data: skill, error } = useQuery(skillQuery(id));
  const refresh = useRefreshSkills();
  const [generation, setGeneration] = useState(0);
  // The version the edit starts from is fixed while editing: saving creates a draft and
  // must not swap the editor's source under the user.
  const pinned = useRef<number | null>(null);
  if (pinned.current === null && skill) {
    pinned.current = skill.draftNumber ?? skill.versions[0]?.number ?? 1;
  }
  const base = pinned.current;
  const view = useQuery({ ...versionQuery(id, base ?? 1), enabled: base !== null });
  if (error) {
    return (
      <Callout tone="danger" role="alert">
        {apiErrorMessage(error)}
      </Callout>
    );
  }
  if (!skill || !view.data) return <p className="text-muted-foreground">{t('app.loading')}</p>;
  // The editor keeps its own revision after each save; only "reload" (after a 409) starts
  // it again from the server's draft.
  return (
    <Editor
      key={generation}
      skill={skill}
      base={view.data}
      onReload={async () => {
        await refresh();
        pinned.current = null;
        setGeneration((value) => value + 1);
      }}
    />
  );
}

type Problem = { message: string; checks: Check[] | null; conflict: boolean };

function toProblem(error: unknown): Problem {
  return {
    message: apiErrorMessage(error),
    checks: checksOf(error),
    conflict: error instanceof ApiError && error.code === 'DRAFT_CHANGED',
  };
}

function Editor({
  skill,
  base,
  onReload,
}: {
  skill: SkillDetail;
  base: VersionView;
  onReload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const refresh = useRefreshSkills();
  const isDraft = base.status === 'draft';
  const [text, setText] = useState(base.skillMd);
  const [savedText, setSavedText] = useState(base.skillMd);
  const [revision, setRevision] = useState<number | null>(isDraft ? base.revision : null);
  const [number, setNumber] = useState(
    isDraft ? base.number : (skill.versions[0]?.number ?? 0) + 1,
  );
  const [files, setFiles] = useState(base.files.filter((file) => file.path !== 'SKILL.md'));
  const [hasScripts, setHasScripts] = useState(base.hasScripts);
  const [suggested, setSuggested] = useState<RiskLevel>(base.suggestedRisk);
  const [risk, setRisk] = useState<RiskLevel | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [newPath, setNewPath] = useState('');
  const picker = useRef<HTMLInputElement>(null);

  const typing = quickCheck(text, skill.name);
  const dirty = text !== savedText;
  const chosenRisk: RiskLevel = hasScripts ? 'high' : (risk ?? suggested);

  function applied(saved: DraftSaved) {
    setRevision(saved.revision);
    setNumber(saved.number);
    setHasScripts(saved.hasScripts);
    setSuggested(saved.suggestedRisk);
  }

  async function run<T>(work: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const result = await work();
      await refresh();
      return result;
    } catch (error) {
      setProblem(toProblem(error));
      return null;
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      const saved = await api<DraftSaved>(`/api/skills/${skill.id}/draft`, {
        method: 'PUT',
        body: { skillMd: text, revision },
      });
      applied(saved);
      setSavedText(text);
      setNotice(tf('editor.saved', { n: saved.number }));
      return saved;
    });

  const query = (rev: number | null) => (rev === null ? '' : `?revision=${rev}`);

  async function upload(file: File) {
    const path = newPath.trim() || file.name;
    await run(async () => {
      const saved = await sendRaw<DraftSaved>(
        `/api/skills/${skill.id}/draft/files/${encodePath(path)}${query(revision)}`,
        'PUT',
        file,
      );
      applied(saved);
      setFiles((current) =>
        [
          ...current.filter((item) => item.path !== path),
          { path, size: file.size, mediaType: file.type },
        ].sort((a, b) => a.path.localeCompare(b.path)),
      );
      setNewPath('');
    });
  }

  async function remove(path: string) {
    await run(async () => {
      const saved = await sendRaw<DraftSaved>(
        `/api/skills/${skill.id}/draft/files/${encodePath(path)}${query(revision)}`,
        'DELETE',
      );
      applied(saved);
      setFiles((current) => current.filter((item) => item.path !== path));
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    let current = revision;
    if (dirty || current === null) {
      const saved = await save();
      if (!saved) return;
      current = saved.revision;
    }
    const sent = await run(() =>
      api(`/api/skills/${skill.id}/draft/submit`, {
        method: 'POST',
        body: { revision: current, changeNote: note, proposedRisk: chosenRisk },
      }),
    );
    if (sent !== null) await navigate({ to: '/skills/$id', params: { id: skill.id } });
  }

  return (
    <>
      <nav
        aria-label={t('skill.crumbs')}
        className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        <Link to="/skills">{t('skills.title')}</Link>
        <span aria-hidden="true">/</span>
        <Link to="/skills/$id" params={{ id: skill.id }}>
          {skill.title}
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-foreground">
          {t('editor.title')}
        </span>
      </nav>
      <header className="mb-5">
        <h1 className="text-[length:var(--text-title)] leading-tight font-bold tracking-[-0.02em]">
          {t('editor.title')}
        </h1>
        <p className="mt-1.5 max-w-[65ch] text-muted-foreground">
          {revision === null
            ? tf('editor.leadNew', { n: number, from: base.number })
            : tf('editor.lead', { n: number })}
        </p>
      </header>

      {notice ? (
        <Callout tone="info" role="status" className="mb-4">
          {notice}
        </Callout>
      ) : null}
      {problem ? (
        <Callout tone="danger" role="alert" className="mb-4">
          <p>{problem.message}</p>
          {problem.checks ? (
            <div className="mt-3 text-foreground">
              <CheckList checks={problem.checks.filter((item) => item.level !== 'ok')} />
            </div>
          ) : null}
          {problem.conflict ? (
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() => void onReload()}
            >
              {t('editor.reload')}
            </Button>
          ) : null}
        </Callout>
      ) : null}

      <div className="grid items-start gap-5 min-[1025px]:grid-cols-[minmax(0,1.7fr)_minmax(17rem,1fr)]">
        <section className="grid gap-3 rounded-[calc(var(--radius)+4px)] border bg-background p-5 shadow-[var(--shadow-sm)]">
          <Field
            id="skill-md"
            label={t('editor.skillMd')}
            hint={t('editor.skillMd.hint')}
            error={typing[0]}
          >
            {(props) => (
              <Textarea
                {...props}
                value={text}
                spellCheck={false}
                onChange={(event) => setText(event.target.value)}
                className="min-h-[28rem] font-mono text-[0.82rem] leading-relaxed"
              />
            )}
          </Field>
          {typing.length > 1 ? (
            <ul className="grid gap-1 text-xs text-destructive-ink">
              {typing.slice(1).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : typing.length === 0 ? (
            <p className="text-xs text-success-ink">{t('editor.check.ok')}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || typing.length > 0 || !dirty}
              onClick={() => void save()}
            >
              {t('editor.save')}
            </Button>
            <Button asChild variant="ghost">
              <Link to="/skills/$id" params={{ id: skill.id }}>
                {t('editor.back')}
              </Link>
            </Button>
          </div>
        </section>

        <aside className="grid gap-5">
          <section
            aria-labelledby="files-h"
            className="grid gap-3 rounded-[calc(var(--radius)+4px)] border bg-background p-5 shadow-[var(--shadow-sm)]"
          >
            <h2 id="files-h" className="text-base font-semibold">
              {t('editor.files')}
            </h2>
            {files.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('editor.files.empty')}</p>
            ) : null}
            <ul className="grid gap-1.5">
              {files.map((file) => (
                <li
                  key={file.path}
                  className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
                  <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={tf('editor.files.remove', { path: file.path })}
                    onClick={() => void remove(file.path)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
            <Field id="file-path" label={t('editor.files.path')} hint={t('editor.files.pathHint')}>
              {(props) => (
                <Input
                  {...props}
                  value={newPath}
                  onChange={(event) => setNewPath(event.target.value)}
                />
              )}
            </Field>
            <input
              ref={picker}
              type="file"
              className="sr-only"
              aria-label={t('editor.files.add')}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void upload(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => picker.current?.click()}
            >
              <Upload />
              {t('editor.files.upload')}
            </Button>
          </section>

          <form
            onSubmit={submit}
            aria-labelledby="submit-h"
            className="grid gap-3 rounded-[calc(var(--radius)+4px)] border bg-background p-5 shadow-[var(--shadow-sm)]"
          >
            <h2 id="submit-h" className="text-base font-semibold">
              {t('editor.submitTitle')}
            </h2>
            <Field
              id="change-note"
              label={t('editor.changeNote')}
              hint={t('editor.changeNote.hint')}
            >
              {(props) => (
                <Textarea
                  {...props}
                  value={note}
                  maxLength={500}
                  onChange={(event) => setNote(event.target.value)}
                />
              )}
            </Field>
            <Field
              id="proposed-risk"
              label={t('editor.risk')}
              hint={
                hasScripts
                  ? t('skill.approveDialog.scriptsLocked')
                  : tf('editor.risk.suggested', { level: t(`risk.${suggested}`) })
              }
            >
              {(props) => (
                <Select
                  {...props}
                  value={chosenRisk}
                  disabled={hasScripts}
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
            <Button type="submit" disabled={busy || typing.length > 0}>
              {t('editor.submit')}
            </Button>
          </form>
        </aside>
      </div>
    </>
  );
}

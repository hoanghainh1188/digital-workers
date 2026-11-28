import { RISK_LEVELS, type RiskLevel, SKILL_STATUSES, type SkillStatus } from '@dw/core/skills';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { FileUp, PenLine, Search } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import type { SignedInMe } from '@/components/app/app-shell';
import { PageHeader } from '@/components/app/page-header';
import { ImportDialog } from '@/components/skills/import-dialog';
import { RiskMeter, ScriptBadge, SkillStatusBadge } from '@/components/skills/skill-badges';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Input, Select } from '@/components/ui/field';
import { t, tf } from '@/i18n/t';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/form-errors';
import {
  type SkillCard,
  type SkillSearch,
  skillsQuery,
  starterSkillMd,
  type TemplateCard,
  templatesQuery,
  useRefreshSkills,
} from '@/lib/skills';
import { cn } from '@/lib/utils';

export type SkillsPageSearch = SkillSearch & { tab?: 'company' | 'templates' };

const tabClass = (selected: boolean) =>
  cn(
    '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap no-underline',
    selected
      ? 'border-primary text-foreground'
      : 'border-transparent text-muted-foreground hover:text-foreground',
  );

/** Creates a skill (from a template or the starter) and opens the editor. */
function useCreateAndEdit() {
  const navigate = useNavigate();
  const refresh = useRefreshSkills();
  return useMutation({
    mutationFn: (source: { template: string } | { blank: true }) =>
      'template' in source
        ? api<{ id: string }>(`/api/skill-templates/${source.template}/use`, { method: 'POST' })
        : api<{ id: string }>('/api/skills', {
            method: 'POST',
            body: { skillMd: starterSkillMd() },
          }),
    onSuccess: async (created) => {
      await refresh();
      await navigate({ to: '/skills/$id/edit', params: { id: created.id } });
    },
  });
}

/** Thư viện kỹ năng (docs/design/screens/skill-library.html, spec skill-library). */
export function SkillsPage({ me: _me, search }: { me: SignedInMe; search: SkillsPageSearch }) {
  const tab = search.tab ?? 'company';
  const [importing, setImporting] = useState(false);
  const create = useCreateAndEdit();

  return (
    <>
      <PageHeader
        eyebrow={t('skills.eyebrow')}
        title={t('skills.title')}
        lead={t('skills.lead')}
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setImporting(true)}>
              <FileUp />
              {t('skills.import')}
            </Button>
            <Button
              type="button"
              disabled={create.isPending}
              onClick={() => create.mutate({ blank: true })}
            >
              <PenLine />
              {t('skills.write')}
            </Button>
          </div>
        }
      />
      {create.error ? (
        <Callout tone="danger" role="alert" className="mb-4">
          {apiErrorMessage(create.error)}
        </Callout>
      ) : null}
      <nav aria-label={t('skills.tabs.label')} className="mb-4 flex gap-1 overflow-x-auto border-b">
        <Link
          to="/skills"
          search={{}}
          className={tabClass(tab === 'company')}
          aria-current={tab === 'company' ? 'page' : undefined}
        >
          {t('skills.tab.company')}
        </Link>
        <Link
          to="/skills"
          search={{ tab: 'templates' }}
          className={tabClass(tab === 'templates')}
          aria-current={tab === 'templates' ? 'page' : undefined}
        >
          {t('skills.tab.templates')}
        </Link>
        <span aria-disabled="true" className={cn(tabClass(false), 'cursor-not-allowed')}>
          {t('skills.tab.story')}
          <span className="rounded bg-muted px-1.5 py-0.5 text-[0.625rem] font-semibold">
            {t('skills.tab.storySoon')}
          </span>
        </span>
      </nav>
      {tab === 'templates' ? (
        <Templates onUse={(template) => create.mutate({ template })} pending={create.isPending} />
      ) : (
        <CompanySkills search={search} onWrite={() => create.mutate({ blank: true })} />
      )}
      {importing ? <ImportDialog onClose={() => setImporting(false)} /> : null}
    </>
  );
}

function Filters({ search }: { search: SkillsPageSearch }) {
  const navigate = useNavigate();
  const [q, setQ] = useState(search.q ?? '');
  const go = (next: SkillsPageSearch) =>
    navigate({
      to: '/skills',
      search: Object.fromEntries(
        Object.entries({ ...search, ...next }).filter(([, v]) => v !== undefined && v !== ''),
      ),
    });
  function submit(event: FormEvent) {
    event.preventDefault();
    void go({ q: q.trim() || undefined });
  }
  return (
    <div className="mb-4 grid gap-3 min-[769px]:grid-cols-[minmax(0,1fr)_auto_auto]">
      <search className="relative">
        <form onSubmit={submit}>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={t('skills.search')}
            placeholder={t('skills.search.placeholder')}
            value={q}
            onChange={(event) => setQ(event.target.value)}
            className="pl-9"
          />
        </form>
      </search>
      <Select
        aria-label={t('skills.filter.status')}
        value={search.status ?? ''}
        onChange={(event) =>
          void go({ status: (event.target.value || undefined) as SkillStatus | undefined })
        }
      >
        <option value="">{`${t('skills.filter.status')}: ${t('skills.filter.all')}`}</option>
        {SKILL_STATUSES.map((status) => (
          <option key={status} value={status}>
            {t(`skill.status.${status}`)}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t('skills.filter.risk')}
        value={search.risk ?? ''}
        onChange={(event) =>
          void go({ risk: (event.target.value || undefined) as RiskLevel | undefined })
        }
      >
        <option value="">{`${t('skills.filter.risk')}: ${t('skills.filter.all')}`}</option>
        {RISK_LEVELS.map((risk) => (
          <option key={risk} value={risk}>
            {t(`risk.${risk}`)}
          </option>
        ))}
      </Select>
    </div>
  );
}

function CompanySkills({ search, onWrite }: { search: SkillsPageSearch; onWrite: () => void }) {
  const { tab: _tab, ...filters } = search;
  const { data, error, isPending } = useQuery(skillsQuery(filters));
  const filtered = Boolean(search.q || search.status || search.risk);
  return (
    <>
      <Filters search={search} />
      {error ? (
        <Callout tone="danger" role="alert">
          {apiErrorMessage(error)}
        </Callout>
      ) : null}
      {isPending ? <p className="text-muted-foreground">{t('app.loading')}</p> : null}
      {data && data.skills.length === 0 ? (
        <div className="rounded-[calc(var(--radius)+4px)] border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">
          <p>{filtered ? t('skills.noMatch') : t('skills.empty')}</p>
          {filtered ? null : (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button asChild variant="outline">
                <Link to="/skills" search={{ tab: 'templates' }}>
                  {t('skills.tab.templates')}
                </Link>
              </Button>
              <Button type="button" onClick={onWrite}>
                {t('skills.write')}
              </Button>
            </div>
          )}
        </div>
      ) : null}
      {data && data.skills.length > 0 ? (
        <ul className="grid gap-2.5">
          {data.skills.map((skill) => (
            <SkillRow key={skill.id} skill={skill} />
          ))}
        </ul>
      ) : null}
    </>
  );
}

function SkillRow({ skill }: { skill: SkillCard }) {
  return (
    <li className="relative grid gap-2 rounded-xl border bg-background p-4 transition-[border-color,box-shadow] duration-150 hover:border-[oklch(82%_0.06_258)] hover:shadow-[var(--shadow-card)] min-[769px]:grid-cols-[minmax(0,1fr)_auto] min-[769px]:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/skills/$id"
            params={{ id: skill.id }}
            className="font-semibold text-foreground no-underline after:absolute after:inset-0 after:content-['']"
          >
            {skill.title}
          </Link>
          <code className="rounded bg-muted px-1.5 font-mono text-[0.72rem] text-muted-foreground">
            {skill.name}
          </code>
          {skill.hasScripts ? <ScriptBadge /> : null}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{skill.description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground min-[769px]:justify-end">
        <SkillStatusBadge status={skill.status} />
        <span>
          {skill.currentNumber
            ? tf('skills.card.version', { n: skill.currentNumber })
            : t('skills.card.noVersion')}
        </span>
        {skill.pendingNumber ? (
          <span className="font-semibold text-warning-ink">
            {tf('skills.card.pending', { n: skill.pendingNumber })}
          </span>
        ) : null}
        <RiskMeter risk={skill.risk} />
        <span>{tf('skills.card.workers', { count: skill.workerCount })}</span>
      </div>
    </li>
  );
}

function Templates({ onUse, pending }: { onUse: (name: string) => void; pending: boolean }) {
  const { data, error } = useQuery(templatesQuery);
  if (error) {
    return (
      <Callout tone="danger" role="alert">
        {apiErrorMessage(error)}
      </Callout>
    );
  }
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(15rem,100%),1fr))] gap-3">
      {(data?.templates ?? []).map((template: TemplateCard) => (
        <li
          key={template.name}
          className="grid content-start gap-2 rounded-xl border bg-background p-4"
        >
          <b className="text-sm">{template.title}</b>
          <p className="text-xs text-muted-foreground">{template.description}</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <RiskMeter risk={template.suggestedRisk} />
            <Button
              type="button"
              variant="outline"
              className="h-8"
              disabled={pending}
              aria-label={`${t('skills.template.use')}: ${template.title}`}
              onClick={() => onUse(template.name)}
            >
              {t('skills.template.use')}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

import { useNavigate } from '@tanstack/react-router';
import { type ChangeEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog } from '@/components/ui/dialog';
import { t, tf } from '@/i18n/t';
import { apiErrorMessage } from '@/lib/form-errors';
import {
  type Check,
  checksOf,
  formatBytes,
  type ImportPreview,
  MAX_ZIP_BYTES,
  sendRaw,
  useRefreshSkills,
} from '@/lib/skills';
import { CheckList } from './check-list.tsx';

type State =
  | { step: 'idle' }
  | { step: 'checking'; file: File }
  | { step: 'checked'; file: File; checks: Check[]; ok: boolean; fileCount: number | null }
  | { step: 'failed'; file: File | null; message: string };

/** "Nhập kỹ năng từ .zip" (skill-library.html views import / import-error, design D5). */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const refresh = useRefreshSkills();
  const [state, setState] = useState<State>({ step: 'idle' });
  const [saving, setSaving] = useState(false);

  async function inspect(file: File) {
    if (file.size > MAX_ZIP_BYTES) {
      setState({
        step: 'failed',
        file,
        message: tf('import.tooLarge', { size: formatBytes(file.size) }),
      });
      return;
    }
    setState({ step: 'checking', file });
    try {
      const preview = await sendRaw<ImportPreview>(
        '/api/skills/import?dryRun=1',
        'POST',
        file,
        'application/zip',
      );
      setState({
        step: 'checked',
        file,
        checks: preview.checks,
        ok: preview.ok,
        fileCount: preview.summary.fileCount,
      });
    } catch (error) {
      const checks = checksOf(error);
      setState(
        checks
          ? { step: 'checked', file, checks, ok: false, fileCount: null }
          : { step: 'failed', file, message: apiErrorMessage(error) },
      );
    }
  }

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void inspect(file);
  }

  async function submit() {
    if (state.step !== 'checked' || !state.ok) return;
    setSaving(true);
    try {
      const created = await sendRaw<{ id: string }>(
        '/api/skills/import',
        'POST',
        state.file,
        'application/zip',
      );
      await refresh();
      onClose();
      await navigate({ to: '/skills/$id', params: { id: created.id } });
    } catch (error) {
      const checks = checksOf(error);
      setState(
        checks
          ? { ...state, checks, ok: false }
          : { step: 'failed', file: state.file, message: apiErrorMessage(error) },
      );
    } finally {
      setSaving(false);
    }
  }

  const file = state.step === 'idle' ? null : state.file;
  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => (open ? null : onClose())}
      title={t('import.title')}
      description={t('import.lead')}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button
            type="button"
            disabled={state.step !== 'checked' || !state.ok || saving}
            onClick={submit}
          >
            {t('import.submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border-strong bg-canvas p-4">
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-[10px] bg-primary-soft text-[0.7rem] font-bold text-primary-ink"
        >
          ZIP
        </span>
        <div className="min-w-0 flex-1">
          {file ? (
            <>
              <b className="block truncate text-sm">{file.name}</b>
              <small className="text-xs text-muted-foreground">
                {state.step === 'checked' && state.fileCount !== null
                  ? tf('import.size', { count: state.fileCount, size: formatBytes(file.size) })
                  : formatBytes(file.size)}
              </small>
            </>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          aria-label={t('import.choose')}
          onChange={choose}
        />
        <Button
          type="button"
          variant={file ? 'ghost' : 'outline'}
          onClick={() => input.current?.click()}
        >
          {file ? t('import.chooseOther') : t('import.choose')}
        </Button>
      </div>
      {state.step === 'checking' ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('import.checking')}
        </p>
      ) : null}
      {state.step === 'checked' ? <CheckList checks={state.checks} /> : null}
      {state.step === 'failed' ? (
        <Callout tone="danger" role="alert">
          {state.message}
        </Callout>
      ) : null}
    </Dialog>
  );
}

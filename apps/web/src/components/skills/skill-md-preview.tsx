import { cn } from '@/lib/utils';

/**
 * SKILL.md shown as text (design D6): one React element per line, coloured by kind.
 * No markdown renderer and no innerHTML — HTML inside a skill is only characters.
 */
export function SkillMdPreview({ text, label }: { text: string; label: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  // Character offset of each line: a stable, unique key.
  let offset = 0;
  const rows = lines.map((line, index) => {
    const row = { line, at: offset, inFront: end > 0 && index <= end };
    offset += line.length + 1;
    return row;
  });
  return (
    <figure aria-label={label} className="m-0">
      <pre className="m-0 max-h-[26rem] overflow-auto bg-background px-4.5 py-4 font-mono text-[0.8rem] leading-relaxed whitespace-pre">
        {rows.map((row) => (
          <span
            key={row.at}
            className={cn(
              'block min-h-[1lh]',
              row.inFront && 'text-role-admin-ink',
              !row.inFront && /^#{1,6}\s/.test(row.line) && 'font-bold text-primary-ink',
            )}
          >
            {row.line}
          </span>
        ))}
      </pre>
    </figure>
  );
}

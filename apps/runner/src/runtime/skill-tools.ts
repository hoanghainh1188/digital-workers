import { TOOL_MESSAGES, truncatedFileNote, wrapData } from '@dw/core';
import { type CompanyTx, type EffectiveSkill, skillBlobs, skillVersionFiles } from '@dw/db';
import { and, asc, eq } from '@dw/db/drizzle';
import { declareTool, type ToolSet } from '@dw/llm';
import { z } from 'zod';

/** Largest piece of a skill file given to the model at once (0.2 #138). */
export const MAX_SKILL_FILE_BYTES = 32 * 1024;
const SKILL_MD = 'SKILL.md';

export type ToolOutput = { readonly ok: boolean; readonly text: string };

const loadInput = z.strictObject({ name: z.string().min(1).max(64) });
const readInput = z.strictObject({
  name: z.string().min(1).max(64),
  path: z.string().min(1).max(200),
});

/**
 * Tools of change 5 (design D8.2), built in code: the model cannot add one. They are
 * declared without `execute`, so the gateway only returns the calls; the runtime runs
 * them here, inside the Task's company.
 */
export function skillToolSet(): ToolSet {
  return {
    load_skill: declareTool(
      'Đọc toàn bộ hướng dẫn (SKILL.md) của một kỹ năng trong danh sách kỹ năng của bạn, kèm danh sách file đính kèm.',
      {
        type: 'object',
        properties: { name: { type: 'string', description: 'Tên kỹ năng, ví dụ lap-bao-gia' } },
        required: ['name'],
        additionalProperties: false,
      },
    ),
    read_skill_file: declareTool(
      'Đọc một file văn bản đính kèm của kỹ năng (tối đa 32 KB mỗi lần).',
      {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Tên kỹ năng' },
          path: { type: 'string', description: 'Đường dẫn file, ví dụ bang-gia.csv' },
        },
        required: ['name', 'path'],
        additionalProperties: false,
      },
    ),
  };
}

export const SKILL_TOOL_NAMES = ['load_skill', 'read_skill_file'] as const;

/**
 * Runs one tool call against the worker's skills in effect (spec worker-skills "Version
 * worker được dùng"). A name outside that list answers "không có kỹ năng này": nothing
 * about unassigned, pending or other companies' skills leaks.
 */
export async function runSkillTool(
  tx: CompanyTx,
  skills: readonly EffectiveSkill[],
  toolName: string,
  input: unknown,
): Promise<ToolOutput> {
  if (toolName === 'load_skill') {
    const parsed = loadInput.safeParse(input);
    if (!parsed.success) return fail(TOOL_MESSAGES.badInput);
    const skill = skills.find((item) => item.name === parsed.data.name);
    if (!skill) return fail(TOOL_MESSAGES.noSuchSkill);
    const files = await tx
      .select({ path: skillVersionFiles.path, size: skillVersionFiles.size })
      .from(skillVersionFiles)
      .where(eq(skillVersionFiles.versionId, skill.versionId))
      .orderBy(asc(skillVersionFiles.path));
    const body = await fileText(tx, skill.versionId, SKILL_MD);
    if (body === null) return fail(TOOL_MESSAGES.noSuchSkill);
    const attachments = files.filter((file) => file.path !== SKILL_MD);
    const list =
      attachments.length === 0
        ? 'Không có file đính kèm.'
        : attachments.map((file) => `- ${file.path} (${file.size} byte)`).join('\n');
    // SKILL.md was approved by an Owner / Admin: instructions, not outside data (D8.2).
    return { ok: true, text: `${body.text}\n\n## File đính kèm\n${list}` };
  }
  if (toolName === 'read_skill_file') {
    const parsed = readInput.safeParse(input);
    if (!parsed.success) return fail(TOOL_MESSAGES.badInput);
    const skill = skills.find((item) => item.name === parsed.data.name);
    if (!skill) return fail(TOOL_MESSAGES.noSuchSkill);
    const { path } = parsed.data;
    if (path.startsWith('scripts/')) return fail(TOOL_MESSAGES.unreadableFile);
    const file = await fileText(tx, skill.versionId, path);
    if (file === null) return fail(TOOL_MESSAGES.noSuchFile);
    if (!isText(file.mediaType)) return fail(TOOL_MESSAGES.unreadableFile);
    const { text, remainingBytes } = truncateUtf8(file.bytes, MAX_SKILL_FILE_BYTES);
    const wrapped = wrapData(`skill:${skill.name}/${sourceLabel(path)}`, text);
    const note =
      remainingBytes > 0 ? `\n${truncatedFileNote(Math.ceil(remainingBytes / 1024))}` : '';
    return { ok: true, text: `${wrapped}${note}` };
  }
  return fail(TOOL_MESSAGES.noSuchTool);
}

async function fileText(tx: CompanyTx, versionId: string, path: string) {
  const [row] = await tx
    .select({ mediaType: skillVersionFiles.mediaType, content: skillBlobs.content })
    .from(skillVersionFiles)
    .innerJoin(
      skillBlobs,
      and(
        eq(skillBlobs.companyId, skillVersionFiles.companyId),
        eq(skillBlobs.sha256, skillVersionFiles.sha256),
      ),
    )
    .where(and(eq(skillVersionFiles.versionId, versionId), eq(skillVersionFiles.path, path)));
  if (!row) return null;
  const bytes = Buffer.from(row.content);
  return { mediaType: row.mediaType, bytes, text: bytes.toString('utf8') };
}

function isText(mediaType: string): boolean {
  const base = mediaType.split(';')[0]?.trim() ?? '';
  return (
    base.startsWith('text/') ||
    ['application/json', 'application/yaml', 'application/xml'].includes(base)
  );
}

/** The first `max` bytes, cut back to a whole UTF-8 character (never mid-letter). */
export function truncateUtf8(bytes: Buffer, max: number): { text: string; remainingBytes: number } {
  if (bytes.length <= max) return { text: bytes.toString('utf8'), remainingBytes: 0 };
  let end = max;
  // Continuation bytes are 10xxxxxx: step back to the start of the character.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return { text: bytes.subarray(0, end).toString('utf8'), remainingBytes: bytes.length - end };
}

/** wrapData accepts [a-z0-9:/._-] only: other characters of a path become '-'. */
function sourceLabel(path: string): string {
  // `skill:<name>/` is at most 71 characters; the whole label must stay ≤ 200.
  return path
    .toLowerCase()
    .replace(/[^a-z0-9/._-]/g, '-')
    .slice(0, 120);
}

function fail(text: string): ToolOutput {
  return { ok: false, text };
}

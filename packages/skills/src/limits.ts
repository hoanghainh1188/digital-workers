/** Package limits (0.2 #059, #089; design D11). */
export const MIB = 1024 * 1024;
export const MAX_ZIP_BYTES = 25 * MIB;
export const MAX_UNPACKED_BYTES = 50 * MIB;
export const MAX_FILES = 200;
export const MAX_PATH = 200;
/** Path segments, file name included (`a/b/c/d/e.md` is the deepest allowed). */
export const MAX_DEPTH = 5;
export const MAX_SKILL_MD_BYTES = 200 * 1024;
/** agentskills.io advises keeping SKILL.md under 500 lines: a warning only (design Open Questions). */
export const LONG_SKILL_MD_LINES = 500;
export const SKILL_MD = 'SKILL.md';

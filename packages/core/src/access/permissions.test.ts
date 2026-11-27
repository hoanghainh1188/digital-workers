import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACTIONS, type Action, can, ROLES, type Role, type Scope } from './permissions.ts';

/**
 * Reads the permission table from docs/requirements.md §1 and checks every cell
 * against `can()` (spec access-control: "Khớp ma trận tài liệu").
 */
const doc = readFileSync(
  fileURLToPath(new URL('../../../../docs/requirements.md', import.meta.url)),
  'utf8',
);
const section = doc.slice(
  doc.indexOf('### Ma trận quyền (MVP)'),
  doc.indexOf('## 2. Thực thể chính'),
);
const rows = section
  .split('\n')
  .filter(
    (line) => line.startsWith('| ') && !line.startsWith('| Hành động') && !line.includes(':-:'),
  )
  .map((line) =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );

/** Which actions a document row stands for, and how to read one cell for each action. */
type CellReader = (cell: string) => Scope;
const plain: CellReader = (cell) => {
  if (cell === '—') return false;
  if (cell.includes('phòng mình')) return 'own-department';
  if (cell.includes('nếu được gán')) return 'assigned';
  if (cell.startsWith('✓')) return 'all';
  throw new Error(`unknown cell "${cell}"`);
};
const writeOnly: CellReader = (cell) => (cell.includes('(xem)') ? false : plain(cell));

const ROW_ACTIONS: Record<string, ReadonlyArray<readonly [Action, CellReader]>> = {
  'Đổi thông tin công ty (tên, số điện thoại)': [['company.update', plain]],
  'Quản lý phòng ban, người dùng': [['org.manage', plain]],
  'Tạo worker (bản nháp)': [['worker.create', plain]],
  'Chuyển worker sang thử việc': [['worker.startProbation', plain]],
  'Duyệt worker lên chính thức': [['worker.approve', plain]],
  'Tạm nghỉ / nghỉ việc worker': [['worker.suspend', plain]],
  'Tạo / sửa skill (bản nháp)': [['skill.edit', plain]],
  'Duyệt skill': [['skill.approve', plain]],
  'Giao việc cho worker': [['task.assign', plain]],
  'Kết nối kênh chat, connector': [['channel.connect', plain]],
  'Nạp credit, xem sao kê': [
    ['credit.topup', writeOnly],
    ['credit.view', plain],
  ],
  'Xem bảng lương': [['payroll.view', plain]],
};
// Decided per worker by its approval rules, not by role.
const NOT_ROLE_BASED = new Set(['Duyệt việc của worker']);

const cases = rows
  .filter(([label]) => !NOT_ROLE_BASED.has(label ?? ''))
  .flatMap(([label = '', ...cells]) => {
    const actions = ROW_ACTIONS[label];
    if (!actions) throw new Error(`matrix row "${label}" has no mapping in this test`);
    return actions.flatMap(([action, read]) =>
      ROLES.map((role, index) => [label, action, role, read(cells[index] ?? '')] as const),
    );
  });

describe('permission matrix matches docs/requirements.md §1', () => {
  it('the document table was found', () => {
    expect(rows.length).toBeGreaterThanOrEqual(12);
  });

  it.each(cases)('%s → %s for %s is %s', (_label, action, role: Role, expected) => {
    expect(can(role, action)).toBe(expected);
  });

  it('every action in code comes from a document row', () => {
    const documented = new Set(cases.map(([, action]) => action));
    expect([...ACTIONS].sort()).toEqual([...documented].sort());
  });
});

import { describe, expect, it } from 'vitest';
import {
  acceptInvitationInput,
  departmentInput,
  departmentPatchInput,
  invalidEmails,
  invitationInput,
  memberPatchInput,
  resetPasswordInput,
  splitEmailList,
} from './schemas.ts';

const DEPT = '6f1c2f0e-3a8b-4c1d-9e2f-0a1b2c3d4e5f';

function issues(
  schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } },
  input: unknown,
) {
  const result = schema.safeParse(input) as {
    success: boolean;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  };
  return result.success
    ? []
    : (result.error?.issues ?? []).map((issue) => [issue.path.join('.'), issue.message]);
}

describe('splitEmailList', () => {
  it('splits on commas, semicolons, spaces and new lines and drops duplicates', () => {
    expect(
      splitEmailList(
        ' ngoc.bui@gomanphu.vn,tam.vo@gomanphu.vn\nthu@gomanphu ; NGOC.BUI@gomanphu.vn  ',
      ),
    ).toEqual(['ngoc.bui@gomanphu.vn', 'tam.vo@gomanphu.vn', 'thu@gomanphu']);
  });

  it('returns nothing for blank input', () => {
    expect(splitEmailList(' ,\n ')).toEqual([]);
  });

  it('invalidEmails reports each bad address as typed', () => {
    expect(invalidEmails(['a@b.vn', 'thu@gomanphu', 'x'])).toEqual(['thu@gomanphu', 'x']);
  });
});

describe('departmentInput / departmentPatchInput', () => {
  it('trims, makes a blank description null and defaults the head to null', () => {
    expect(departmentInput.parse({ name: ' Kho vận ', description: ' ' })).toEqual({
      name: 'Kho vận',
      description: null,
      headMemberId: null,
    });
  });

  it('requires a name', () => {
    expect(issues(departmentInput, { name: '  ' })).toEqual([['name', 'required']]);
  });

  it('patch needs at least one field and keeps headMemberId: null (remove head)', () => {
    expect(issues(departmentPatchInput, {})).toEqual([['', 'required']]);
    expect(departmentPatchInput.parse({ headMemberId: null })).toEqual({ headMemberId: null });
  });

  it('rejects unknown fields such as companyId', () => {
    expect(issues(departmentInput, { name: 'A', companyId: DEPT })[0]?.[1]).toBeTruthy();
  });
});

describe('invitationInput', () => {
  const base = { role: 'member', departmentId: DEPT };

  it('normalises and de-duplicates emails', () => {
    expect(
      invitationInput.parse({ ...base, emails: ['A@x.vn', 'a@x.vn ', 'b@x.vn'] }).emails,
    ).toEqual(['a@x.vn', 'b@x.vn']);
  });

  it('names each invalid email by index', () => {
    expect(issues(invitationInput, { ...base, emails: ['ok@x.vn', 'thu@gomanphu'] })).toEqual([
      ['emails.1', 'email_invalid'],
    ]);
  });

  it('allows at most 50 emails', () => {
    const emails = Array.from({ length: 51 }, (_, i) => `u${i}@x.vn`);
    expect(issues(invitationInput, { ...base, emails })).toEqual([['emails', 'too_many']]);
  });

  it('Manager and Member need a department; Owner and Admin do not (0.2 #036)', () => {
    expect(issues(invitationInput, { emails: ['a@x.vn'], role: 'member' })).toEqual([
      ['departmentId', 'department_required'],
    ]);
    expect(issues(invitationInput, { emails: ['a@x.vn'], role: 'admin' })).toEqual([]);
  });

  it('a Manager invite names one person', () => {
    expect(
      issues(invitationInput, {
        emails: ['a@x.vn', 'b@x.vn'],
        role: 'manager',
        departmentId: DEPT,
      }),
    ).toEqual([['emails', 'manager_single']]);
  });
});

describe('memberPatchInput', () => {
  it('needs role or departmentId', () => {
    expect(issues(memberPatchInput, {})).toEqual([['', 'required']]);
    expect(memberPatchInput.parse({ departmentId: null })).toEqual({ departmentId: null });
  });

  it('rejects an unknown role', () => {
    expect(issues(memberPatchInput, { role: 'boss' })[0]?.[0]).toBe('role');
  });
});

describe('acceptInvitationInput', () => {
  it('accepts a token alone (signed-in mode) or token + name + password', () => {
    expect(issues(acceptInvitationInput, { token: 't' })).toEqual([]);
    expect(
      issues(acceptInvitationInput, { token: 't', name: 'Lan', password: 'gom an phu bat trang' }),
    ).toEqual([]);
  });

  it('a name without a password asks for the password, and the other way round', () => {
    expect(issues(acceptInvitationInput, { token: 't', name: 'Lan' })).toEqual([
      ['password', 'required'],
    ]);
    expect(issues(acceptInvitationInput, { token: 't', password: 'gom an phu bat trang' })).toEqual(
      [['name', 'required']],
    );
  });

  it('applies the password rules (#032)', () => {
    expect(
      issues(acceptInvitationInput, { token: 't', name: 'Lan', password: '1234567890' }),
    ).toEqual([['password', 'password_common']]);
  });
});

describe('resetPasswordInput', () => {
  it('applies the password rules to the new password', () => {
    expect(issues(resetPasswordInput, { token: 't', newPassword: 'short' })).toEqual([
      ['newPassword', 'password_too_short'],
    ]);
  });
});

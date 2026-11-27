import { describe, expect, it } from 'vitest';
import { isCommonPassword } from './password.ts';
import { companyInput, signupInput } from './schemas.ts';

const valid = {
  companyName: 'Gốm An Phú',
  name: 'Nguyễn An',
  email: 'An@Example.com ',
  password: 'gom an phu bat trang',
};

function issues(input: unknown) {
  const result = signupInput.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
}

describe('signupInput', () => {
  it('accepts a long passphrase without special characters and normalises email', () => {
    const result = signupInput.parse(valid);
    expect(result.email).toBe('an@example.com');
    expect(result.phone).toBeUndefined();
  });

  it('rejects a 9-character password as too short', () => {
    expect(issues({ ...valid, password: 'abcdefghi' })).toEqual([
      ['password', 'password_too_short'],
    ]);
  });

  it('rejects "1234567890" as too common', () => {
    expect(issues({ ...valid, password: '1234567890' })).toEqual([['password', 'password_common']]);
  });

  it('rejects an empty company name and names the field', () => {
    expect(issues({ ...valid, companyName: '   ' })).toEqual([['companyName', 'required']]);
  });

  it('accepts an optional phone and treats blank as none', () => {
    expect(signupInput.parse({ ...valid, phone: '0912 345 678' }).phone).toBe('0912 345 678');
    expect(signupInput.parse({ ...valid, phone: '' }).phone).toBeNull();
    expect(issues({ ...valid, phone: 'call me' })).toEqual([['phone', 'phone_invalid']]);
  });

  it('rejects unknown fields such as a companyId', () => {
    expect(signupInput.safeParse({ ...valid, companyId: 'x' }).success).toBe(false);
  });
});

describe('companyInput', () => {
  it('requires a name', () => {
    expect(companyInput.safeParse({ name: '' }).success).toBe(false);
    expect(companyInput.parse({ name: ' Gốm ' }).name).toBe('Gốm');
  });
});

describe('isCommonPassword', () => {
  it.each(['1234567890', 'matkhau123', 'MatKhau123', 'aaaaaaaaaaaa', 'abcdefghijk', '9876543210'])(
    'blocks %s',
    (password) => expect(isCommonPassword(password)).toBe(true),
  );

  it.each(['gom an phu bat trang', 'xK9#mPq2vL', 'bat trang 2026'])('allows %s', (password) =>
    expect(isCommonPassword(password)).toBe(false),
  );
});

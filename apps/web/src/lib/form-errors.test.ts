import { signupInput } from '@dw/core/schemas';
import { describe, expect, it } from 'vitest';
import { fieldErrorMessage, fromZodIssues, toFieldErrors } from './form-errors.ts';

const valid = {
  companyName: 'Gốm An Phú',
  name: 'Nguyễn An',
  email: 'an@example.com',
  password: 'gom an phu bat trang',
};

function errorsFor(input: object) {
  const result = signupInput.safeParse({ ...valid, ...input });
  return result.success ? {} : toFieldErrors(fromZodIssues(result.error.issues));
}

describe('Zod error → Vietnamese field message', () => {
  it('short password', () => {
    expect(errorsFor({ password: 'abcdefgh1' })).toEqual({
      password: 'Mật khẩu cần ít nhất 10 ký tự.',
    });
  });

  it('common password', () => {
    expect(errorsFor({ password: '1234567890' }).password).toBe(
      'Mật khẩu này quá dễ đoán. Hãy chọn cụm từ khác.',
    );
  });

  it('empty company name uses the field-specific text', () => {
    expect(errorsFor({ companyName: '' })).toEqual({ companyName: 'Nhập tên công ty.' });
  });

  it('invalid email and phone', () => {
    expect(errorsFor({ email: 'not-an-email', phone: 'abc' })).toEqual({
      email: 'Email chưa đúng định dạng.',
      phone: 'Số điện thoại chưa đúng.',
    });
  });

  it('keeps only the first message per field and handles API details', () => {
    expect(
      toFieldErrors([
        { path: 'password', message: 'password_too_short' },
        { path: 'password', message: 'password_common' },
      ]),
    ).toEqual({ password: 'Mật khẩu cần ít nhất 10 ký tự.' });
  });

  it('unknown codes fall back to a generic message', () => {
    expect(fieldErrorMessage('x', 'weird_code')).toBe('Giá trị chưa hợp lệ.');
  });
});

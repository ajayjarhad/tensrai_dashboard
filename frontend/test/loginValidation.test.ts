import { expect, test } from 'bun:test';
import { LoginCredentialsSchema } from '@tensrai/shared';
import { type LoginField, loginFieldError } from '@/features/auth/loginValidation';

const edited = { username: true, password: true };
const fields: LoginField[] = ['username', 'password'];

test('an untouched field shows no error, as the form did before it was edited', () => {
  expect(
    loginFieldError(
      'username',
      { username: '', password: '' },
      { username: false, password: false }
    )
  ).toBeUndefined();
});

test('every edited field gets the same verdict and message as LoginCredentialsSchema', () => {
  for (const values of [
    { username: '', password: '' },
    { username: 'op', password: '' },
    { username: '', password: 'secret' },
    { username: ' ', password: ' ' },
    { username: 'op', password: 'secret' },
  ]) {
    const parsed = LoginCredentialsSchema.safeParse(values);
    const schemaMessage = (field: LoginField) =>
      parsed.success
        ? undefined
        : parsed.error.issues.find(issue => issue.path[0] === field)?.message;
    for (const field of fields) {
      expect(loginFieldError(field, values, edited)).toBe(schemaMessage(field));
    }
  }
});

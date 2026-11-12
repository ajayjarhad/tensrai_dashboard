export type LoginField = 'username' | 'password';

const REQUIRED_MESSAGE: Record<LoginField, string> = {
  username: 'Username is required',
  password: 'Password is required',
};

// Same rule and messages as LoginCredentialsSchema, shown once a field has been edited, as the
// form's onChange validation did.
export const loginFieldError = (
  field: LoginField,
  values: Record<LoginField, string>,
  edited: Record<LoginField, boolean>
) => (edited[field] && values[field].length === 0 ? REQUIRED_MESSAGE[field] : undefined);

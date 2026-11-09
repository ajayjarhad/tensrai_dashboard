import { LogIn } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { FormError } from '@/components/forms/form-error';
import { LoadingButton } from '@/components/forms/loading-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/stores/auth';
import { type LoginField, loginFieldError } from '../loginValidation';

// Plain state rather than react-hook-form and zod: two required fields don't justify shipping
// both libraries to the first page every operator loads.
export function LoginForm() {
  const { login, isLoading, error } = useAuth();
  const [values, setValues] = useState({ username: '', password: '' });
  const [edited, setEdited] = useState({ username: false, password: false });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { username, password } = values;
  const canSubmit = Boolean(username.trim().length && password.trim().length);
  const errors = {
    username: loginFieldError('username', values, edited),
    password: loginFieldError('password', values, edited),
  };

  const fieldProps = (name: LoginField) => ({
    name,
    value: values[name],
    onChange: (event: { target: { value: string } }) => {
      const value = event.target.value;
      setValues(current => ({ ...current, [name]: value }));
      setEdited(current => ({ ...current, [name]: true }));
    },
  });

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading || isSubmitting || !canSubmit) return;
    setIsSubmitting(true);
    try {
      await login(values);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold text-foreground">Welcome back</h1>
          <p className="text-sm text-muted-foreground">Sign in to manage your robots</p>
        </div>

        <form onSubmit={onSubmit} className="mt-8 space-y-6">
          <FormError errors={error} />

          <div className="space-y-4">
            <div>
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                placeholder="Username"
                disabled={isLoading}
                {...fieldProps('username')}
              />
              {errors.username && (
                <p className="text-sm text-destructive mt-1">{errors.username}</p>
              )}
            </div>

            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                disabled={isLoading}
                {...fieldProps('password')}
              />
              {errors.password && (
                <p className="text-sm text-destructive mt-1">{errors.password}</p>
              )}
            </div>
          </div>

          <LoadingButton
            loading={isLoading || isSubmitting}
            loadingText="Signing in..."
            disabled={!canSubmit || isLoading || isSubmitting}
            className="w-full"
          >
            <LogIn className="h-4 w-4" />
            Sign in
          </LoadingButton>
        </form>

        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-background text-muted-foreground">New User?</span>
            </div>
          </div>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            Please contact an administrator to create an account.
          </div>
        </div>
      </div>
    </div>
  );
}

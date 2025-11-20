import { useNavigate } from '@tanstack/react-router';
import { PERMISSIONS } from '@tensrai/shared';
import { useState } from 'react';
import { z } from 'zod';
import { BaseForm, FormError, FormField, LoadingButton } from '@/components/forms';
import { apiClient } from '@/lib/api';
import { copyToClipboard, downloadCredentials } from '../../../lib/credentials-download';
import { generateTemporaryPassword } from '../../../lib/password-generator';
import { useAuth } from '../../../stores/auth';

const userFormSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username cannot exceed 50 characters'),
  email: z.string().email('Please enter a valid email address'),
  role: z.enum(['USER', 'ADMIN']),
  displayName: z.string().max(100, 'Display name cannot exceed 100 characters').optional(),
});

interface UserFormData extends z.infer<typeof userFormSchema> {}

interface CreatedUser {
  username: string;
  email: string;
  displayName: string;
  password: string;
}

export function TemporaryUserCreation() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUser, setCreatedUser] = useState<CreatedUser | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [copied, setCopied] = useState(false);

  // Check if user has permission
  if (!hasPermission(PERMISSIONS.USER_MANAGEMENT)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-4">Access Denied</h1>
          <p className="text-muted-foreground">You don't have permission to create users.</p>
        </div>
      </div>
    );
  }

  const generatePassword = () => {
    const password = generateTemporaryPassword();
    setGeneratedPassword(password);
    setCopied(false);
  };

  const copyPassword = async () => {
    if (generatedPassword) {
      const success = await copyToClipboard(generatedPassword);
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      }
    }
  };

  const downloadUserCredentials = () => {
    if (createdUser) {
      downloadCredentials({
        username: createdUser.username,
        password: createdUser.password,
        email: createdUser.email,
        displayName: createdUser.displayName,
      });
    }
  };

  const onSubmit = async (data: UserFormData) => {
    if (!generatedPassword) {
      setError('Please generate a password first');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const response = await apiClient.post<any>('users', {
        ...data,
        tempPassword: generatedPassword,
      });

      if (response.success) {
        const newUser: CreatedUser = {
          username: response.data.user.username,
          email: response.data.user.email,
          displayName: response.data.user.displayName || '',
          password: response.data.tempPassword,
        };
        setCreatedUser(newUser);
      } else {
        setError(response.error || 'Failed to create user');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setIsCreating(false);
    }
  };

  const resetForm = () => {
    setCreatedUser(null);
    setGeneratedPassword('');
    setError(null);
    setCopied(false);
  };

  const goBack = () => {
    navigate({ to: '/admin/users' });
  };

  if (createdUser) {
    return (
      <div className="min-h-screen bg-background py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <button
              type="button"
              onClick={goBack}
              className="text-muted-foreground hover:text-foreground mb-4 flex items-center"
            >
              ← Back to User Management
            </button>
            <h1 className="text-3xl font-bold text-foreground">User Created Successfully!</h1>
          </div>

          <div className="bg-card shadow rounded-lg p-6 border border-border">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground mb-2">User Information</h2>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium text-muted-foreground">Username:</span>
                    <span className="ml-2 text-foreground">{createdUser.username}</span>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">Email:</span>
                    <span className="ml-2 text-foreground">{createdUser.email}</span>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">Display Name:</span>
                    <span className="ml-2 text-foreground">{createdUser.displayName}</span>
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <h3 className="text-lg font-semibold text-foreground mb-2">Temporary Password</h3>
                <div className="bg-secondary rounded-md p-3">
                  <div className="flex items-center justify-between">
                    <code className="text-lg font-mono text-foreground">
                      {createdUser.password}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(createdUser.password)}
                      className="ml-4 px-3 py-1 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm"
                    >
                      Copy
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-sm text-destructive">⚠️ This password expires in 72 hours</p>
              </div>

              <div className="border-t border-border pt-4">
                <h3 className="text-lg font-semibold text-foreground mb-2">Next Steps</h3>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Share these credentials securely with the user</li>
                  <li>• User must login and set their permanent password</li>
                  <li>• Password will expire in 72 hours if not used</li>
                </ul>
              </div>
            </div>

            <div className="mt-6 flex justify-between">
              <div className="space-x-3">
                <button
                  type="button"
                  onClick={downloadUserCredentials}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                >
                  Download Credentials
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90"
                >
                  Create Another User
                </button>
              </div>
              <button
                type="button"
                onClick={goBack}
                className="px-4 py-2 text-muted-foreground hover:text-foreground"
              >
                Back to Users
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <button
            type="button"
            onClick={goBack}
            className="text-muted-foreground hover:text-foreground mb-4 flex items-center"
          >
            ← Back to User Management
          </button>
          <h1 className="text-3xl font-bold text-foreground">Create Temporary User</h1>
          <p className="mt-2 text-muted-foreground">
            Create a new user with a temporary password that expires in 72 hours.
          </p>
        </div>

        <div className="bg-card shadow rounded-lg p-6 border border-border">
          <BaseForm
            schema={userFormSchema}
            defaultValues={{
              username: '',
              email: '',
              role: 'USER',
              displayName: '',
            }}
            onSubmit={onSubmit}
            className="space-y-6"
          >
            {({ formState }) => (
              <>
                <FormError errors={error} />

                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <FormField
                    name="username"
                    label="Username"
                    inputProps={{
                      type: 'text',
                      placeholder: 'Enter username',
                      disabled: isCreating,
                    }}
                  />

                  <FormField
                    name="email"
                    label="Email"
                    inputProps={{
                      type: 'email',
                      placeholder: 'Enter email address',
                      disabled: isCreating,
                    }}
                  />

                  <FormField
                    name="displayName"
                    label="Display Name"
                    inputProps={{
                      type: 'text',
                      placeholder: 'Enter display name',
                      disabled: isCreating,
                    }}
                  />

                  <FormField name="role" label="Role">
                    {({ value, onChange, disabled }) => (
                      <select
                        value={value}
                        onChange={e => onChange(e.target.value)}
                        disabled={disabled || isCreating}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="USER">User</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    )}
                  </FormField>
                </div>

                <div className="border-t border-border pt-6">
                  <h3 className="text-lg font-medium text-foreground mb-4">Password Generation</h3>

                  <div className="space-y-4">
                    <div className="flex items-center space-x-4">
                      <button
                        type="button"
                        onClick={generatePassword}
                        disabled={isCreating}
                        className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/90 disabled:opacity-50"
                      >
                        Generate Password
                      </button>

                      {generatedPassword && (
                        <div className="flex items-center space-x-2 flex-1">
                          <span className="text-sm text-muted-foreground">Generated:</span>
                          <code className="bg-secondary px-3 py-1 rounded text-foreground">
                            {generatedPassword}
                          </code>
                          <button
                            type="button"
                            onClick={copyPassword}
                            className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm hover:bg-primary/90"
                          >
                            {copied ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                      )}
                    </div>

                    {!generatedPassword && (
                      <p className="text-sm text-muted-foreground">
                        Click "Generate Password" to create an 8-character temporary password
                      </p>
                    )}

                    {generatedPassword && (
                      <div className="bg-secondary/50 p-3 rounded-md">
                        <p className="text-sm text-foreground">
                          <span className="font-medium">Password:</span> {generatedPassword}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          This password will expire in 72 hours and the user will be required to
                          change it on first login.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end space-x-4 pt-6 border-t border-border">
                  <button
                    type="button"
                    onClick={goBack}
                    disabled={isCreating}
                    className="px-4 py-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <LoadingButton
                    loading={isCreating || formState.isSubmitting}
                    loadingText="Creating User..."
                    disabled={!formState.isValid || !generatedPassword}
                    className="px-6 py-2"
                  >
                    Create User
                  </LoadingButton>
                </div>
              </>
            )}
          </BaseForm>
        </div>
      </div>
    </div>
  );
}

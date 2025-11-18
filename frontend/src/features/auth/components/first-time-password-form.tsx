import { useNavigate } from '@tanstack/react-router';
import { FirstTimePasswordSetupSchema } from '@tensrai/shared';
import { BaseForm, FormError, FormField, LoadingButton } from '@/components/forms';
import { useAuth } from '@/stores/auth';

export function FirstTimePasswordForm() {
  const navigate = useNavigate();
  const { firstTimeSetup: updatePassword, isLoading, error } = useAuth();

  const getPasswordStrength = (password: string) => {
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.match(/[a-z]/)) strength++;
    if (password.match(/[A-Z]/)) strength++;
    if (password.match(/[0-9]/)) strength++;
    if (password.match(/[^a-zA-Z0-9]/)) strength++;
    return strength;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-foreground">
            Set Your Password
          </h2>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Please set a new password for your account
          </p>
        </div>

        <BaseForm
          schema={FirstTimePasswordSetupSchema}
          defaultValues={{
            tempPassword: '',
            newPassword: '',
            confirmPassword: '',
            displayName: '',
          }}
          onSubmit={async data => {
            const submitData = {
              tempPassword: data.tempPassword,
              newPassword: data.newPassword,
              confirmPassword: data.confirmPassword,
              displayName: data.displayName || '',
            };
            await updatePassword(submitData);
            navigate({ to: '/' });
          }}
          className="mt-8 space-y-6"
        >
          {({ watch, formState }) => {
            const newPassword = watch('newPassword');
            const confirmPassword = watch('confirmPassword');
            const passwordStrength = getPasswordStrength(newPassword || '');
            const passwordStrengthColors = [
              'bg-destructive',
              'bg-accent',
              'bg-secondary',
              'bg-muted-foreground',
              'text-primary',
            ];
            const passwordStrengthText = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];

            return (
              <>
                <FormError errors={error} />

                <div className="space-y-4">
                  <FormField
                    name="tempPassword"
                    label="Temporary Password"
                    inputProps={{
                      type: 'password',
                      placeholder: 'Enter your temporary password',
                      disabled: isLoading,
                    }}
                  />

                  <FormField
                    name="displayName"
                    label="Display Name (Optional)"
                    inputProps={{
                      type: 'text',
                      placeholder: 'Your display name',
                      disabled: isLoading,
                    }}
                  />

                  <FormField
                    name="newPassword"
                    label="New Password"
                    inputProps={{
                      type: 'password',
                      placeholder: 'Enter new password',
                      disabled: isLoading,
                    }}
                  />

                  {newPassword && (
                    <div className="mt-2">
                      <div className="flex items-center space-x-2">
                        <div className="flex-1 bg-border rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all duration-300 ${passwordStrengthColors[passwordStrength - 1] || 'bg-muted'}`}
                            style={{ width: `${(passwordStrength / 5) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {passwordStrengthText[passwordStrength - 1] || 'Very Weak'}
                        </span>
                      </div>
                    </div>
                  )}

                  <FormField
                    name="confirmPassword"
                    label="Confirm New Password"
                    inputProps={{
                      type: 'password',
                      placeholder: 'Confirm new password',
                      disabled: isLoading,
                    }}
                  />

                  {newPassword && confirmPassword && (
                    <div className="mt-1 text-sm">
                      {newPassword === confirmPassword ? (
                        <span className="text-foreground">Passwords match</span>
                      ) : (
                        <span className="text-destructive">Passwords do not match</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="bg-card p-4 rounded-md border border-border">
                  <h3 className="text-sm font-medium text-foreground">Password Requirements:</h3>
                  <ul className="mt-2 text-sm text-muted-foreground space-y-1">
                    <li>At least 8 characters long</li>
                    <li>Include uppercase letters (A-Z)</li>
                    <li>Include lowercase letters (a-z)</li>
                    <li>Include numbers (0-9)</li>
                    <li>Include special characters (!@#$%^&*)</li>
                  </ul>
                </div>

                <LoadingButton
                  loading={isLoading || formState.isSubmitting}
                  loadingText="Setting Password..."
                  disabled={!formState.isValid || newPassword !== confirmPassword}
                  className="w-full"
                >
                  Set Password
                </LoadingButton>
              </>
            );
          }}
        </BaseForm>
      </div>
    </div>
  );
}

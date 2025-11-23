import { KeyRound } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { FirstTimePasswordSetupSchema } from '@tensrai/shared';
import { BaseForm, FormError, FormField, LoadingButton } from '@/components/forms';
import { useAuth } from '@/stores/auth';

export function FirstTimePasswordForm() {
  const navigate = useNavigate();
  const { firstTimeSetup: updatePassword, isLoading, error } = useAuth();

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
          mode="onChange"
          className="mt-8 space-y-6"
        >
          {({ watch, formState }) => {
            const tempPassword = watch('tempPassword') ?? '';
            const newPassword = watch('newPassword') ?? '';
            const confirmPassword = watch('confirmPassword') ?? '';
            const canSubmit =
              !isLoading &&
              // !formState.isSubmitting &&
              tempPassword.length >= 1 &&
              newPassword.length >= 4 &&
              confirmPassword.length >= 1 &&
              newPassword === confirmPassword;

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

                <LoadingButton
                  loading={isLoading || formState.isSubmitting}
                  loadingText="Setting Password..."
                  disabled={!canSubmit}
                  className="w-full"
                >
                  <KeyRound className="h-4 w-4" />
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

import { useAuth } from '@/stores/auth';
import { useNavigate } from '@tanstack/react-router';
import type { ResetPasswordInput } from '@tensrai/shared';
import type React from 'react';
import { useState } from 'react';

export function ResetPasswordForm() {
  const navigate = useNavigate();
  const { resetPassword, isLoading, error } = useAuth();

  const [formData, setFormData] = useState<ResetPasswordInput>({
    tempPassword: '',
    newPassword: '',
    confirmPassword: '',
    displayName: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.newPassword !== formData.confirmPassword) {
      alert('Passwords do not match');
      return;
    }

    if (formData.newPassword.length < 8) {
      alert('Password must be at least 8 characters long');
      return;
    }

    setIsSubmitting(true);

    try {
      await resetPassword(formData);
      navigate({ to: '/' });
    } catch (_err) {
    } finally {
      setIsSubmitting(false);
    }
  };

  const getPasswordStrength = (password: string) => {
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.match(/[a-z]/)) strength++;
    if (password.match(/[A-Z]/)) strength++;
    if (password.match(/[0-9]/)) strength++;
    if (password.match(/[^a-zA-Z0-9]/)) strength++;
    return strength;
  };

  const passwordStrength = getPasswordStrength(formData.newPassword);
  const passwordStrengthColors = [
    'bg-destructive',
    'bg-accent',
    'bg-secondary',
    'bg-muted-foreground',
    'text-primary',
  ];
  const passwordStrengthText = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-foreground">
            Reset Your Password
          </h2>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Please set a new password for your account
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-md bg-destructive/10 p-4 border border-destructive/20">
              <div className="text-sm text-destructive">{error}</div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="tempPassword" className="block text-sm font-medium text-foreground">
                Temporary Password
              </label>
              <input
                id="tempPassword"
                name="tempPassword"
                type="password"
                value={formData.tempPassword}
                onChange={handleChange}
                required
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-input placeholder-muted-foreground text-foreground rounded-md focus:outline-none focus-ring focus:z-10 sm:text-sm"
                placeholder="Enter your temporary password"
                disabled={isLoading || isSubmitting}
              />
            </div>

            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-foreground">
                Display Name (Optional)
              </label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                value={formData.displayName}
                onChange={handleChange}
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-input placeholder-muted-foreground text-foreground rounded-md focus:outline-none focus-ring focus:z-10 sm:text-sm"
                placeholder="Your display name"
                disabled={isLoading || isSubmitting}
              />
            </div>

            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-foreground">
                New Password
              </label>
              <input
                id="newPassword"
                name="newPassword"
                type={showPassword ? 'text' : 'password'}
                value={formData.newPassword}
                onChange={handleChange}
                required
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-input placeholder-muted-foreground text-foreground rounded-md focus:outline-none focus-ring focus:z-10 sm:text-sm"
                placeholder="Enter new password"
                disabled={isLoading || isSubmitting}
              />
              {formData.newPassword && (
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
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-foreground"
              >
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                value={formData.confirmPassword}
                onChange={handleChange}
                required
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-input placeholder-muted-foreground text-foreground rounded-md focus:outline-none focus-ring focus:z-10 sm:text-sm"
                placeholder="Confirm new password"
                disabled={isLoading || isSubmitting}
              />
              {formData.newPassword && formData.confirmPassword && (
                <div className="mt-1 text-sm">
                  {formData.newPassword === formData.confirmPassword ? (
                    <span className="text-foreground">Passwords match</span>
                  ) : (
                    <span className="text-destructive">Passwords do not match</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center">
              <input
                id="showPassword"
                type="checkbox"
                checked={showPassword}
                onChange={e => setShowPassword(e.target.checked)}
                className="h-4 w-4 text-primary focus-ring border-input rounded-md"
              />
              <label htmlFor="showPassword" className="ml-2 block text-sm text-foreground">
                Show passwords
              </label>
            </div>
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

          <div>
            <button
              type="submit"
              disabled={
                isLoading ||
                isSubmitting ||
                !formData.tempPassword ||
                !formData.newPassword ||
                !formData.confirmPassword ||
                formData.newPassword !== formData.confirmPassword
              }
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-primary-foreground bg-primary hover:bg-primary/90 focus-ring focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading || isSubmitting ? (
                <div className="flex items-center">
                  <svg
                    className="animate-spin -ml-1 mr-3 h-5 w-5 text-primary-foreground"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Resetting Password...
                </div>
              ) : (
                'Reset Password'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

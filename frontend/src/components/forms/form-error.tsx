import type { ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface FormErrorProps {
  errors: string | string[] | null | undefined;
  className?: string;
  icon?: ReactNode;
}

export function FormError({ errors, className = '', icon }: FormErrorProps) {
  if (!errors) return null;

  const errorArray = Array.isArray(errors) ? errors : [errors];
  const filteredErrors = errorArray.filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );
  const keyCounts = new Map<string, number>();

  const getErrorKey = (message: string) => {
    const current = keyCounts.get(message) ?? 0;
    keyCounts.set(message, current + 1);
    return `${message}-${current}`;
  };

  if (filteredErrors.length === 0) return null;

  return (
    <Alert variant="destructive" className={className}>
      {icon}
      <AlertDescription className="space-y-1">
        {filteredErrors.map(error => (
          <p key={getErrorKey(error)}>{error}</p>
        ))}
      </AlertDescription>
    </Alert>
  );
}

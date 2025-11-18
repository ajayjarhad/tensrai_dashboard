import { zodResolver } from '@hookform/resolvers/zod';
import type { ReactNode } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormErrorBoundary } from './form-error-boundary';

interface BaseFormProps<TData> {
  schema: z.ZodSchema<TData>;
  defaultValues?: TData;
  onSubmit: (data: TData) => Promise<void> | void;
  children: (methods: any) => ReactNode;
  mode?: 'onSubmit' | 'onBlur' | 'onChange' | 'onTouched';
  className?: string;
  disabled?: boolean;
}

export function BaseForm<TData>({
  schema,
  defaultValues,
  onSubmit,
  children,
  mode = 'onSubmit',
  className = '',
  disabled = false,
}: BaseFormProps<TData>) {
  const methods = useForm({
    resolver: zodResolver(schema as any),
    defaultValues: defaultValues as any,
    mode,
    disabled,
  });

  const handleSubmit = methods.handleSubmit(async (data: any) => {
    try {
      await onSubmit(data);
    } catch (error) {
      console.error('Form submission error:', error);
    }
  });

  return (
    <FormErrorBoundary>
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit} className={className} noValidate>
          {children(methods)}
        </form>
      </FormProvider>
    </FormErrorBoundary>
  );
}

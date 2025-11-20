import { zodResolver } from '@hookform/resolvers/zod';
import type { ReactNode } from 'react';
import { FormProvider, type UseFormReturn, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormErrorBoundary } from './form-error-boundary';

interface BaseFormProps<TData extends z.ZodType> {
  schema: TData;
  defaultValues?: z.infer<TData>;
  onSubmit: (data: z.infer<TData>) => Promise<void> | void;
  children: (methods: UseFormReturn<any>) => ReactNode;
  mode?: 'onSubmit' | 'onBlur' | 'onChange' | 'onTouched';
  className?: string;
  disabled?: boolean;
}

export function BaseForm<TData extends z.ZodType>({
  schema,
  defaultValues,
  onSubmit,
  children,
  mode = 'onSubmit',
  className = '',
  disabled = false,
}: BaseFormProps<TData>) {
  const methods = useForm<any>({
    resolver: zodResolver(schema as any),
    defaultValues,
    mode,
    disabled,
  });

  const handleSubmit = methods.handleSubmit(async (data: z.infer<TData>) => {
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
          {children(methods as any)}
        </form>
      </FormProvider>
    </FormErrorBoundary>
  );
}

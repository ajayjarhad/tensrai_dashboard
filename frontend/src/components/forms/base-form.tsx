import { zodResolver } from '@hookform/resolvers/zod';
import type { ReactNode } from 'react';
import {
  type DefaultValues,
  type FieldValues,
  FormProvider,
  type UseFormReturn,
  useForm,
} from 'react-hook-form';
import type { z } from 'zod';
import { FormErrorBoundary } from './form-error-boundary';

interface BaseFormProps<TInput extends FieldValues, TOutput extends FieldValues> {
  schema: z.ZodType<TOutput, TInput>;
  defaultValues?: DefaultValues<TInput>;
  onSubmit: (data: TOutput) => Promise<void> | void;
  children: (methods: UseFormReturn<TInput, unknown, TOutput>) => ReactNode;
  mode?: 'onSubmit' | 'onBlur' | 'onChange' | 'onTouched';
  className?: string;
  disabled?: boolean;
}

export function BaseForm<TInput extends FieldValues, TOutput extends FieldValues>({
  schema,
  defaultValues,
  onSubmit,
  children,
  mode = 'onSubmit',
  className = '',
  disabled = false,
}: BaseFormProps<TInput, TOutput>) {
  const methods = useForm<TInput, unknown, TOutput>({
    resolver: zodResolver(schema),
    ...(defaultValues ? { defaultValues } : {}),
    mode,
    disabled,
  });

  const handleSubmit = methods.handleSubmit(async data => {
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

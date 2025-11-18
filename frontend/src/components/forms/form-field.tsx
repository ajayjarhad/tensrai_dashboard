import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import {
  Controller,
  type ControllerProps,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface FormFieldProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> extends Omit<ControllerProps<TFieldValues, TName>, 'render'> {
  label?: string;
  description?: string;
  containerClassName?: string;
  inputProps?: ComponentPropsWithoutRef<typeof Input>;
  children?: (field: {
    value: string;
    onChange: (value: string) => void;
    onBlur: () => void;
    disabled?: boolean;
    error?: string | undefined;
  }) => ReactNode;
}

const renderLabel = (label: string | undefined, fieldName: string, hasError: boolean) => {
  if (!label) return null;
  return (
    <Label htmlFor={fieldName} className={hasError ? 'text-destructive' : ''}>
      {label}
    </Label>
  );
};

const renderDescription = (description?: string) => {
  if (!description) return null;
  return <p className="text-sm text-muted-foreground">{description}</p>;
};

const renderErrorMessage = (error?: string) => {
  if (!error) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {error}
    </p>
  );
};

const renderControl = <TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>(
  customRenderer: FormFieldProps<TFieldValues, TName>['children'],
  field: ControllerRenderProps<TFieldValues, TName>,
  inputProps: ComponentPropsWithoutRef<typeof Input> | undefined,
  error?: string
) => {
  if (customRenderer) {
    return customRenderer({
      value: field.value,
      onChange: field.onChange,
      onBlur: field.onBlur,
      disabled: field.disabled || false,
      error,
    });
  }

  const resolvedDisabled = field.disabled || inputProps?.disabled;
  const resolvedClassName = error
    ? 'border-destructive focus-visible:ring-destructive'
    : inputProps?.className;

  return (
    <Input
      {...field}
      {...inputProps}
      id={field.name}
      aria-invalid={Boolean(error)}
      disabled={resolvedDisabled}
      className={resolvedClassName}
    />
  );
};

export function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  label,
  description,
  containerClassName = '',
  inputProps,
  children,
  ...controllerProps
}: FormFieldProps<TFieldValues, TName>) {
  return (
    <Controller
      {...controllerProps}
      render={({ field, fieldState }) => {
        const error = fieldState.error?.message;
        return (
          <div className={`space-y-2 ${containerClassName}`}>
            {renderLabel(label, field.name, Boolean(error))}
            {renderControl(children, field, inputProps, error)}
            {renderDescription(description)}
            {renderErrorMessage(error)}
          </div>
        );
      }}
    />
  );
}

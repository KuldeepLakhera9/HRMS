'use client';

import React, { forwardRef } from 'react';

export interface FormFieldProps {
  label?: string;
  required?: boolean;
  error?: string | undefined;
  description?: string | undefined;
  children: React.ReactNode;
  className?: string;
}

export function FormField({
  label,
  required,
  error,
  description,
  children,
  className = '',
}: FormFieldProps) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label className="block text-xs font-semibold text-foreground/90">
          {label} {required && <span className="text-destructive">*</span>}
        </label>
      )}
      {children}
      {description && !error && (
        <p className="text-[11px] text-muted-foreground">{description}</p>
      )}
      {error && <p className="text-[11px] text-destructive font-medium">{error}</p>}
    </div>
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', error, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`w-full px-3 py-2 text-xs rounded-lg border bg-background text-foreground transition focus:outline-none focus:ring-2 focus:ring-primary/20 ${
          error
            ? 'border-destructive focus:border-destructive focus:ring-destructive/20'
            : 'border-border focus:border-primary'
        } ${className}`}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
  options?: Array<{ label: string; value: string }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', error, options, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={`w-full px-3 py-2 text-xs rounded-lg border bg-background text-foreground transition focus:outline-none focus:ring-2 focus:ring-primary/20 ${
          error
            ? 'border-destructive focus:border-destructive focus:ring-destructive/20'
            : 'border-border focus:border-primary'
        } ${className}`}
        {...props}
      >
        {options
          ? options.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))
          : children}
      </select>
    );
  },
);
Select.displayName = 'Select';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', error, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={`w-full px-3 py-2 text-xs rounded-lg border bg-background text-foreground transition focus:outline-none focus:ring-2 focus:ring-primary/20 ${
          error
            ? 'border-destructive focus:border-destructive focus:ring-destructive/20'
            : 'border-border focus:border-primary'
        } ${className}`}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

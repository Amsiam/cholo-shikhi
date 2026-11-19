// A labelled shadcn/ui input whose error is linked to the field and announced (R-A11Y).
import type { InputHTMLAttributes } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function FormField(props: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  testId: string;
  inputProps: InputHTMLAttributes<HTMLInputElement>;
}) {
  const describedBy = [props.hint ? `${props.id}-hint` : '', props.error ? `${props.id}-error` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        data-testid={props.testId}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="h-12 bg-background"
        {...props.inputProps}
      />
      {props.hint ? (
        <p id={`${props.id}-hint`} className="text-sm text-muted-foreground">
          {props.hint}
        </p>
      ) : null}
      {props.error ? (
        <p
          id={`${props.id}-error`}
          role="alert"
          className="text-sm text-destructive"
          data-testid={`${props.testId}-error`}
        >
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

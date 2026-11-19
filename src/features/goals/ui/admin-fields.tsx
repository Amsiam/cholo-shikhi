// Small A4 building blocks over shadcn/ui: a labelled text field whose error is linked and announced
// (NFR7.201), a labelled radio choice, a confirmation dialog, and the shared form-error mapping.
import { type ReactNode, useId } from 'react';
import type { z } from 'zod';
import { fromZodError } from '#src/lib/errors.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export type FieldErrorMap = Record<string, string>;
export type SaveOutcome = {
  code: string;
  i18nKey: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
} | null;

/** First i18n key per field from the shared Zod schema and the domain rules (never raw text). */
export function firstErrors(
  schema: z.ZodType,
  value: unknown,
  domain?: Readonly<Record<string, readonly string[]>>,
): FieldErrorMap {
  const parsed = schema.safeParse(value);
  const zodErrors = parsed.success ? {} : (fromZodError(parsed.error).fieldErrors ?? {});
  const merged: FieldErrorMap = {};
  for (const source of [domain ?? {}, zodErrors]) {
    for (const [field, keys] of Object.entries(source)) {
      if (!merged[field] && keys[0]) merged[field] = keys[0];
    }
  }
  return merged;
}

export function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  testId: string;
  inputMode?: 'numeric' | 'text';
  lang?: 'bn' | 'en';
}) {
  const { tDynamic } = useI18n();
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{props.label}</Label>
      <Input
        id={id}
        lang={props.lang}
        inputMode={props.inputMode}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error ? `${id}-error` : undefined}
        className="h-12"
        data-testid={props.testId}
      />
      {props.error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-sm text-destructive"
          data-testid={`${props.testId}-error`}
        >
          {tDynamic(props.error)}
        </p>
      ) : null}
    </div>
  );
}

export function ChoiceField(props: {
  legend: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  error?: string | undefined;
  testId: string;
}) {
  const { tDynamic } = useI18n();
  const id = useId();
  return (
    <fieldset className="grid gap-2" aria-describedby={props.error ? `${id}-error` : undefined}>
      <legend className="text-sm font-medium">{props.legend}</legend>
      <RadioGroup value={props.value} onValueChange={props.onChange} data-testid={props.testId}>
        {props.options.map((option, index) => (
          <div key={option.value} className="flex min-h-10 items-center gap-3">
            <RadioGroupItem id={`${id}-${index}`} value={option.value} />
            <Label htmlFor={`${id}-${index}`}>{option.label}</Label>
          </div>
        ))}
      </RadioGroup>
      {props.error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {tDynamic(props.error)}
        </p>
      ) : null}
    </fieldset>
  );
}

export function ConfirmDialog(props: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  testId: string;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} data-testid={props.testId}>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" data-testid={`${props.testId}-cancel`}>
              {t('goals.admin.cancel')}
            </Button>
          </DialogClose>
          <Button onClick={props.onConfirm} data-testid={`${props.testId}-confirm`}>
            {props.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

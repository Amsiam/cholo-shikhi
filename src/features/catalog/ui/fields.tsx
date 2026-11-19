// I1 building blocks over shadcn/ui: a labelled text field and a labelled radio choice whose errors
// are linked and announced (NFR7.201), and the shared form-error mapping (shared Zod schema first,
// then the domain's field keys). Error text is always an i18n key, never raw text.
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

/** First i18n key per field from the domain rules and the shared Zod schema. */
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

export function FieldError(props: { id: string; error?: string | undefined; testId: string }) {
  const { tDynamic } = useI18n();
  if (!props.error) return null;
  return (
    <p id={props.id} role="alert" className="text-sm text-destructive" data-testid={props.testId}>
      {tDynamic(props.error)}
    </p>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  testId: string;
  inputMode?: 'decimal' | 'text';
  lang?: 'bn' | 'en';
  hint?: string;
}) {
  const id = useId();
  const describedBy = [props.error ? `${id}-error` : '', props.hint ? `${id}-hint` : '']
    .filter(Boolean)
    .join(' ');
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
        aria-describedby={describedBy || undefined}
        className="h-12"
        data-testid={props.testId}
      />
      {props.hint ? (
        <p
          id={`${id}-hint`}
          className="text-sm text-muted-foreground"
          data-testid={`${props.testId}-hint`}
        >
          {props.hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} error={props.error} testId={`${props.testId}-error`} />
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
      <FieldError id={`${id}-error`} error={props.error} testId={`${props.testId}-error`} />
    </fieldset>
  );
}

/** A title in the active language (BR3.1: both are required, so no fallback is needed). */
export function localTitle(item: { titleBn: string; titleEn: string }, locale: 'bn' | 'en') {
  return locale === 'bn' ? item.titleBn : item.titleEn;
}

/** A confirmation step for actions that are hard to undo (publish, unpublish, retire, remove). */
export function ConfirmDialog(props: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  testId: string;
  isConfirmDisabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={props.isOpen} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} data-testid={props.testId}>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription asChild>
            <div>{props.description}</div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" data-testid={`${props.testId}-cancel`}>
              {t('catalog.instructor.cancel')}
            </Button>
          </DialogClose>
          <Button
            onClick={props.onConfirm}
            disabled={props.isConfirmDisabled}
            data-testid={`${props.testId}-confirm`}
          >
            {props.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

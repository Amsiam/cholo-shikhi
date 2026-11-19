// Shared pieces of the product editors (A12 exam packages, A9 plans, I1 Practice Packs): an ID-list
// field, the status label, the publish / unpublish / retire actions with a confirmation, and the
// price round trip for editing. Every string is an i18n key (NFR7.201 error announcement included).
import { useId, useState } from 'react';
import type { MessageKey } from '#src/lib/i18n/index.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, FieldError, type SaveOutcome } from './fields.tsx';

export type ProductStatus = 'draft' | 'published' | 'unpublished' | 'retired';
export type ProductAction = 'publish' | 'unpublish' | 'retire';

const STATUS_KEY: Record<ProductStatus, MessageKey> = {
  draft: 'catalog.instructor.status.draft',
  published: 'catalog.instructor.status.published',
  unpublished: 'catalog.instructor.status.unpublished',
  retired: 'catalog.instructor.status.retired',
};

/**
 * The taka text of a stored poisha amount, for an edit field: string arithmetic only, never floating
 * point on money (project.md). 149950 → "1499.50", 5 → "0.05".
 */
export function poishaToTakaInput(poisha: number | null): string {
  if (poisha === null || !Number.isSafeInteger(poisha) || poisha < 0) return '';
  const digits = String(poisha).padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** One ID per line (commas and spaces also separate); blanks are dropped, order is kept. */
export function parseIdList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/** Which lifecycle actions a status offers (functional-spec §3.5–§3.7). */
export function actionsFor(status: ProductStatus, hasUnpublishedChanges: boolean): ProductAction[] {
  if (status === 'draft') return ['publish'];
  if (status === 'published')
    return hasUnpublishedChanges ? ['publish', 'unpublish', 'retire'] : ['unpublish', 'retire'];
  if (status === 'unpublished') return ['publish', 'retire'];
  return [];
}

export function StatusBadge(props: { status: ProductStatus; hasUnpublishedChanges?: boolean }) {
  const { t } = useI18n();
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant="outline">{t(STATUS_KEY[props.status])}</Badge>
      {props.hasUnpublishedChanges ? (
        <Badge variant="secondary">{t('catalog.product.unpublishedChanges')}</Badge>
      ) : null}
    </span>
  );
}

/** A textarea of IDs (the slot fallback until Assessment's picker ships with U4). */
export function IdListField(props: {
  label: string;
  hint: string;
  value: string[];
  onChange: (ids: string[]) => void;
  error?: string | undefined;
  testId: string;
}) {
  const id = useId();
  const [text, setText] = useState(props.value.join('\n'));
  const describedBy = [`${id}-hint`, props.error ? `${id}-error` : ''].filter(Boolean).join(' ');
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {props.label}
      </label>
      <textarea
        id={id}
        className="min-h-24 rounded-md border p-2 font-mono text-sm"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          props.onChange(parseIdList(event.target.value));
        }}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy}
        data-testid={props.testId}
      />
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {props.hint}
      </p>
      <FieldError id={`${id}-error`} error={props.error} testId={`${props.testId}-error`} />
    </div>
  );
}

const ACTION_LABEL: Record<ProductAction, MessageKey> = {
  publish: 'catalog.product.action.publish',
  unpublish: 'catalog.product.action.unpublish',
  retire: 'catalog.product.action.retire',
};
const CONFIRM_BODY: Record<ProductAction, MessageKey> = {
  publish: 'catalog.product.confirm.publish',
  unpublish: 'catalog.product.confirm.unpublish',
  retire: 'catalog.product.confirm.retire',
};

/** Lifecycle buttons; each asks for confirmation, then reports the outcome (NFR7.201). */
export function ProductActions(props: {
  status: ProductStatus;
  hasUnpublishedChanges: boolean;
  onAction: (action: ProductAction) => Promise<SaveOutcome>;
  testId: string;
}) {
  const { t, tDynamic } = useI18n();
  const [pending, setPending] = useState<ProductAction | null>(null);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const actions = actionsFor(props.status, props.hasUnpublishedChanges);
  if (actions.length === 0) return null;
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action}
            type="button"
            size="sm"
            variant={action === 'publish' ? 'default' : 'outline'}
            onClick={() => setPending(action)}
            data-testid={`${props.testId}-${action}`}
          >
            {t(ACTION_LABEL[action])}
          </Button>
        ))}
      </div>
      {message ? (
        <p
          role={message.isError ? 'alert' : 'status'}
          className={message.isError ? 'text-sm text-destructive' : 'text-sm'}
          data-testid={`${props.testId}-message`}
        >
          {message.text}
        </p>
      ) : null}
      <ConfirmDialog
        isOpen={pending !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPending(null);
        }}
        title={pending ? t(ACTION_LABEL[pending]) : ''}
        description={pending ? t(CONFIRM_BODY[pending]) : ''}
        confirmLabel={pending ? t(ACTION_LABEL[pending]) : ''}
        testId={`${props.testId}-confirm`}
        onConfirm={async () => {
          const action = pending;
          setPending(null);
          if (!action) return;
          const outcome = await props.onAction(action);
          setMessage(
            outcome
              ? { text: tDynamic(outcome.i18nKey), isError: true }
              : { text: t('catalog.product.done'), isError: false },
          );
        }}
      />
    </div>
  );
}

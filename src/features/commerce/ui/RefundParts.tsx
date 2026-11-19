// The Student's side of refunds, on the purchase history: the request's state, or a button that
// opens a short form with the reason. The window and what happens next are said up front.
import { useForm } from '@tanstack/react-form';
import { Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import type { RefundState } from '../server/refund.server.ts';

type Outcome = { ok: true } | { ok: false; error: { i18nKey: string } };

export function RefundCell(props: {
  paymentId: string;
  courseTitle: string;
  refund: RefundState | null;
  onRequest: (paymentId: string, reason: string) => Promise<Outcome>;
}) {
  const { t, tDynamic, formatMoney, formatDate } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { reason: '' },
    onSubmit: async ({ value }) => {
      if (value.reason.trim().length < 10) {
        setError('errors.refund.reasonShort');
        return;
      }
      const r = await props.onRequest(props.paymentId, value.reason.trim());
      if (!r.ok) {
        setError(r.error.i18nKey);
        return;
      }
      setIsOpen(false);
    },
  });
  const request = props.refund?.request;
  if (request?.status === 'pending')
    return (
      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-primary">
        {t('refund.state.pending')}
      </span>
    );
  if (request?.status === 'approved')
    return (
      <span className="flex flex-col gap-0.5">
        <span className="w-fit rounded-full bg-pass/15 px-2.5 py-0.5 text-xs font-semibold text-pass">
          {t('refund.state.approved')}
        </span>
        {request.refundPoisha ? (
          <span className="text-xs tabular-nums">
            {formatMoney(request.refundPoisha as MoneyPoisha)}
          </span>
        ) : null}
      </span>
    );
  const declined =
    request?.status === 'rejected' ? (
      <span className="flex flex-col gap-0.5 text-xs">
        <span className="w-fit rounded-full bg-omr-soft px-2.5 py-0.5 font-semibold text-omr">
          {t('refund.state.rejected')}
        </span>
        {request.decisionNote ? (
          <span className="max-w-56 text-ink-muted">{request.decisionNote}</span>
        ) : null}
      </span>
    ) : null;
  if (!props.refund || props.refund.block !== null) return declined;

  return (
    <span className="flex flex-col items-start gap-1">
      {declined}
      <Button variant="ghost" size="sm" onClick={() => setIsOpen(true)} data-testid="refund-open">
        <Undo2 aria-hidden="true" className="size-4" />
        {t('refund.ask')}
      </Button>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('refund.dialog.title')}</DialogTitle>
              <DialogDescription>
                {t('refund.dialog.body', { course: props.courseTitle })}
                {props.refund.windowEndsAt
                  ? ` ${t('refund.dialog.until', { date: formatDate(props.refund.windowEndsAt) })}`
                  : ''}
              </DialogDescription>
            </DialogHeader>
            <form.Field name="reason">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor="refund-reason">{t('refund.dialog.reason')}</Label>
                  <textarea
                    id="refund-reason"
                    className="min-h-28 w-full rounded-sm border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
                    maxLength={1000}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    data-testid="refund-reason"
                  />
                </div>
              )}
            </form.Field>
            <p className="text-sm text-ink/80">{t('refund.dialog.next')}</p>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {tDynamic(error)}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                {t('bank.topics.cancel')}
              </Button>
              <Button type="submit" data-testid="refund-submit">
                {t('refund.dialog.send')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </span>
  );
}

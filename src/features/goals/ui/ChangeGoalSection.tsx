// S12 Me → Goal (UC2, US1.10): the current Goal, a choice of another active Goal and the change
// dialog. The dialog moves focus inside and, on cancel, back to the change control (AC1.10.2,
// NFR7.202); the call carries acknowledgedStreakReset only after the Student confirms (BR2.6).
import { useRef, useState } from 'react';
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
import { GoalChoiceList, type GoalGroup, localName, type Named } from './goal-choice.tsx';

export type ChangeOutcome = { i18nKey: string } | null;

export function ChangeGoalSection(props: {
  current: (Named & { goalId: string }) | null;
  groups: GoalGroup[];
  onChange: (goalId: string) => Promise<ChangeOutcome>;
}) {
  const { t, tDynamic, locale } = useI18n();
  const [goalId, setGoalId] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneName, setDoneName] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const chosen = props.groups.flatMap((g) => g.goals).find((g) => g.goalId === goalId);

  async function confirm() {
    setError(null);
    const outcome = await props.onChange(goalId);
    setIsOpen(false);
    if (outcome) {
      setError(outcome.i18nKey);
      return;
    }
    setDoneName(chosen ? localName(chosen, locale) : null);
    setGoalId('');
  }

  return (
    <div className="grid gap-6" data-testid="goal-change">
      <p data-testid="goal-change-current">
        {props.current
          ? t('goals.me.current', { name: localName(props.current, locale) })
          : t('goals.me.none')}
      </p>
      {doneName ? (
        <p role="status" data-testid="goal-change-done">
          {t('goals.change.done', { name: doneName })}
        </p>
      ) : null}
      <div className="grid gap-3">
        <h2 className="font-medium">{t('goals.me.newGoalLabel')}</h2>
        <GoalChoiceList
          groups={props.groups}
          value={goalId}
          onValueChange={setGoalId}
          testId="goal-change-list"
          {...(props.current ? { excludeGoalId: props.current.goalId } : {})}
        />
      </div>
      <p className="text-sm text-muted-foreground">{t('goals.me.otherGoalsNote')}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="goal-change-error">
          {tDynamic(error)}
        </p>
      ) : null}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <Button
          size="lg"
          className="w-full sm:w-fit sm:justify-self-start"
          ref={triggerRef}
          disabled={goalId === ''}
          onClick={() => setIsOpen(true)}
          data-testid="goal-change-open"
        >
          {t('goals.me.change')}
        </Button>
        <DialogContent
          showCloseButton={false}
          data-testid="goal-change-dialog"
          onCloseAutoFocus={(event) => {
            // Focus returns to the Goal control that opened the dialog (AC1.10.2).
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('goals.change.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('goals.change.warning')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" data-testid="goal-change-cancel">
                {t('goals.change.cancel')}
              </Button>
            </DialogClose>
            <Button onClick={() => void confirm()} data-testid="goal-change-confirm">
              {t('goals.change.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

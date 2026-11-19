// S1 Goal picker (UC1, US1.9): active Goals grouped by segment (BR2.2), the empty and load-failure
// states (BR2.3), and a confirm step. Errors are announced (role="alert").
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { GoalChoiceList, type GoalGroup } from './goal-choice.tsx';

export type PickerState = { kind: 'loaded'; groups: GoalGroup[] } | { kind: 'failed' };
export type ChooseOutcome = { i18nKey: string } | null;

export function GoalPicker(props: {
  state: PickerState;
  onRetry: () => void;
  onChoose: (goalId: string) => Promise<ChooseOutcome>;
}) {
  const { t, tDynamic } = useI18n();
  const [goalId, setGoalId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (props.state.kind === 'failed') {
    return (
      <Alert variant="destructive" data-testid="goal-picker-load-failed" role="alert">
        <AlertDescription className="flex flex-wrap items-center gap-3">
          {t('goals.picker.loadFailed')}
          <Button variant="outline" onClick={props.onRetry} data-testid="goal-picker-retry">
            {t('goals.picker.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (props.state.groups.length === 0) {
    return (
      <p role="status" data-testid="goal-picker-empty">
        {t('goals.picker.empty')}
      </p>
    );
  }

  async function confirm() {
    setError(null);
    setIsSaving(true);
    const outcome = await props.onChoose(goalId);
    setIsSaving(false);
    if (outcome) setError(outcome.i18nKey);
  }

  return (
    <form
      className="grid gap-6"
      data-testid="goal-picker"
      onSubmit={(event) => {
        event.preventDefault();
        void confirm();
      }}
    >
      <GoalChoiceList
        groups={props.state.groups}
        value={goalId}
        onValueChange={setGoalId}
        testId="goal-picker-list"
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive" data-testid="goal-picker-error">
          {tDynamic(error)}
        </p>
      ) : null}
      <Button
        size="lg"
        type="submit"
        disabled={goalId === '' || isSaving}
        data-testid="goal-picker-confirm"
      >
        {t('goals.picker.confirm')}
      </Button>
    </form>
  );
}

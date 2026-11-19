// US2.23 (A10): change a segment's free-trial day and lesson caps. Each save is a new, audited
// version of a segment-scoped setting; trials already running keep the caps they started with.
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Outcome = { ok: true } | { ok: false; error: { i18nKey?: string } };

export function TrialCapsEditor(props: {
  segmentId: string;
  days: number;
  lessons: number;
  onSave: (input: {
    segmentId: string;
    days: number;
    lessons: number;
    reason: string;
  }) => Promise<Outcome>;
}) {
  const { t, tDynamic } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [days, setDays] = useState(String(props.days));
  const [lessons, setLessons] = useState(String(props.lessons));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const summary = t('trial.caps.summary', { days: props.days, lessons: props.lessons });
  if (!isEditing)
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        {summary}
        <Button
          size="sm"
          variant="ghost"
          className="h-8"
          onClick={() => setIsEditing(true)}
          data-testid="trial-caps-edit"
        >
          {t('trial.caps.edit')}
        </Button>
      </span>
    );
  const save = async () => {
    const d = Number(days);
    const l = Number(lessons);
    // AC2.23.2: a cap of 0 (or not a whole number) is refused here and by the setting's range.
    if (!Number.isInteger(d) || !Number.isInteger(l) || d < 1 || l < 1) {
      setError('trial.caps.invalid');
      return;
    }
    const r = await props.onSave({ segmentId: props.segmentId, days: d, lessons: l, reason });
    if (r.ok) setIsEditing(false);
    else setError(r.error.i18nKey ?? 'trial.caps.invalid');
  };
  const id = props.segmentId;
  return (
    <div className="grid gap-2" data-testid="trial-caps-form">
      <div className="flex flex-wrap gap-2">
        <div className="grid gap-1">
          <Label htmlFor={`caps-days-${id}`}>{t('trial.caps.days')}</Label>
          <Input
            id={`caps-days-${id}`}
            inputMode="numeric"
            className="w-24"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`caps-lessons-${id}`}>{t('trial.caps.lessons')}</Label>
          <Input
            id={`caps-lessons-${id}`}
            inputMode="numeric"
            className="w-24"
            value={lessons}
            onChange={(e) => setLessons(e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`caps-reason-${id}`}>{t('trial.caps.reason')}</Label>
        <Input
          id={`caps-reason-${id}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()} data-testid="trial-caps-save">
          {t('trial.caps.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
          {t('trial.caps.cancel')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
    </div>
  );
}

// Admin: streak-token and streak-shield amounts (Q8=B). Each change becomes a new settings version,
// is audit-logged by the settings registry, and applies from the next credit or award on; tokens and
// shields already given are unchanged (AC5.16.3).
import { useForm } from '@tanstack/react-form';
import { Coins, HeartHandshake, Shield, Swords } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BUDDY_ROUNDING, type BuddyRounding } from '../domain/buddy.ts';

type Outcome =
  | { ok: true }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

export type RewardSettings = {
  dailyTokens: number;
  battleEntryTokens: number;
  shieldTopN: number;
  buddyRounding: BuddyRounding;
};
export const REWARD_SETTING_KEYS: Record<keyof RewardSettings, string> = {
  dailyTokens: 'retention.tokens.daily',
  battleEntryTokens: 'retention.tokens.battleEntry',
  shieldTopN: 'retention.shields.topN',
  buddyRounding: 'retention.buddy.rounding',
};

const FIELDS: Array<{
  name: Exclude<keyof RewardSettings, 'buddyRounding'>;
  min: number;
  icon: typeof Coins;
  label: 'rewards.admin.daily' | 'rewards.admin.entry' | 'rewards.admin.topN';
  hint: 'rewards.admin.dailyHint' | 'rewards.admin.entryHint' | 'rewards.admin.topNHint';
}> = [
  {
    name: 'dailyTokens',
    min: 0,
    icon: Coins,
    label: 'rewards.admin.daily',
    hint: 'rewards.admin.dailyHint',
  },
  {
    name: 'battleEntryTokens',
    min: 0,
    icon: Swords,
    label: 'rewards.admin.entry',
    hint: 'rewards.admin.entryHint',
  },
  {
    name: 'shieldTopN',
    min: 1,
    icon: Shield,
    label: 'rewards.admin.topN',
    hint: 'rewards.admin.topNHint',
  },
];

export function RewardSettingsForm(props: {
  values: RewardSettings;
  onSave: (changed: Partial<RewardSettings>) => Promise<Outcome>;
}) {
  const { t, tDynamic } = useI18n();
  const [message, setMessage] = useState<{ ok: boolean; key: string } | null>(null);
  const form = useForm({
    defaultValues: props.values,
    onSubmit: async ({ value }) => {
      const changed = Object.fromEntries(
        (Object.keys(REWARD_SETTING_KEYS) as Array<keyof RewardSettings>)
          .filter((name) => value[name] !== props.values[name])
          .map((name) => [name, value[name]]),
      ) as Partial<RewardSettings>;
      if (Object.keys(changed).length === 0) {
        setMessage({ ok: true, key: 'rewards.admin.nothing' });
        return;
      }
      const r = await props.onSave(changed);
      setMessage(
        r.ok ? { ok: true, key: 'rewards.admin.saved' } : { ok: false, key: r.error.i18nKey },
      );
    },
  });
  return (
    <div className="flex flex-col gap-6" data-testid="reward-settings">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {t('rewards.admin.title')}
        </h1>
        <p className="text-ink/75">{t('rewards.admin.subtitle')}</p>
      </header>
      <form
        noValidate
        className="flex flex-col gap-5 border border-primary/15 bg-background p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        {FIELDS.map((f) => (
          <form.Field key={f.name} name={f.name}>
            {(field) => (
              <div className="grid gap-1.5">
                <Label htmlFor={`reward-${f.name}`} className="flex items-center gap-2">
                  <f.icon aria-hidden="true" className="size-4 text-primary" />
                  {t(f.label)}
                </Label>
                <Input
                  id={`reward-${f.name}`}
                  type="number"
                  inputMode="numeric"
                  min={f.min}
                  max={100}
                  className="w-32"
                  aria-describedby={`reward-${f.name}-hint`}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(Number(e.target.value))}
                />
                <p id={`reward-${f.name}-hint`} className="text-sm text-ink-muted">
                  {t(f.hint)}
                </p>
              </div>
            )}
          </form.Field>
        ))}
        <form.Field name="buddyRounding">
          {(field) => (
            <fieldset className="flex flex-col gap-2">
              <legend className="flex items-center gap-2 text-sm font-medium">
                <HeartHandshake aria-hidden="true" className="size-4 text-primary" />
                {t('rewards.admin.rounding')}
              </legend>
              {BUDDY_ROUNDING.map((rule) => (
                <label
                  key={rule}
                  className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name="buddy-rounding"
                    className="size-4 accent-primary"
                    checked={field.state.value === rule}
                    onChange={() => field.handleChange(rule)}
                  />
                  {t(`rewards.admin.rounding.${rule}`)}
                </label>
              ))}
            </fieldset>
          )}
        </form.Field>
        {message ? (
          <p
            role={message.ok ? 'status' : 'alert'}
            className={`text-sm ${message.ok ? '' : 'text-destructive'}`}
          >
            {tDynamic(message.key)}
          </p>
        ) : null}
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" className="w-fit" disabled={isSubmitting}>
              {t('rewards.admin.save')}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </div>
  );
}

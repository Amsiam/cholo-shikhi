import { createFileRoute, useRouter } from '@tanstack/react-router';
import { AccessDenied } from '#src/features/app-shell/ui/ErrorScreen.tsx';
import { getRewardSettings } from '#src/features/learning/server/learning.functions.ts';
import {
  REWARD_SETTING_KEYS,
  type RewardSettings,
  RewardSettingsForm,
} from '#src/features/learning/ui/RewardSettingsForm.tsx';
import { saveSetting } from '#src/features/platform/server/settings.functions.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';

type Outcome =
  | { ok: true }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

// Admin: streak-token and streak-shield amounts.
export const Route = createFileRoute('/admin_/rewards')({
  loader: async () => {
    const r = await getRewardSettings({ data: {} });
    return r.ok
      ? { denied: false as const, values: r.value as RewardSettings }
      : { denied: true as const };
  },
  component: RewardsPage,
});

function RewardsPage() {
  const { t } = useI18n();
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.denied) return <AccessDenied reason={t('admin.denied')} />;
  const save = async (changed: Partial<RewardSettings>): Promise<Outcome> => {
    for (const [name, value] of Object.entries(changed)) {
      const r = (await saveSetting({
        data: {
          settingKey: REWARD_SETTING_KEYS[name as keyof RewardSettings],
          value: value as number | string,
          reason: 'Streak reward amounts set from the rewards page',
        },
      })) as Outcome;
      if (!r.ok) return r;
    }
    await router.invalidate();
    return { ok: true };
  };
  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <RewardSettingsForm values={data.values} onSave={save} />
      </div>
    </div>
  );
}

// A10 Settings, written for people: every registered setting in a topic group, with a plain label,
// one line on what it does, the value in force now (with its unit), the range an Admin may choose
// and whether it is the default, changed, or not set yet. A setting with its own editing screen
// links there. A key this map does not know yet still shows, under "Other", by its raw key.
import { Link } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import type { SettingCurrent } from '#src/features/platform/server/settings.functions.ts';
import type { MessageKey } from '#src/lib/i18n/index.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { formatMoney, type MoneyPoisha } from '#src/lib/money.ts';

export type SettingRow = {
  settingKey: string;
  valueType: string;
  min: number | null;
  max: number | null;
  blocksWhenUnset: boolean;
  current: SettingCurrent;
};

type Shown =
  | 'onOff'
  | 'times'
  | 'visits'
  | 'tokens'
  | 'lessons'
  | 'winners'
  | 'seconds'
  | 'minutes'
  | 'days'
  | 'years'
  | 'taka'
  | 'percent'
  | 'rounding';
type GroupKey =
  | 'prices'
  | 'refunds'
  | 'security'
  | 'notifications'
  | 'rewards'
  | 'referrals'
  | 'records'
  | 'app'
  | 'other';
type EditAt = '/admin/refunds' | '/admin/rewards' | '/admin/referrals' | 'trials';

type Meta = { group: GroupKey; label: MessageKey; help: MessageKey; shown: Shown; editAt?: EditAt };

const META: Record<string, Meta> = {
  'catalog.coursePrice.minPoisha': {
    group: 'prices',
    label: 'settings.coursePriceMin',
    help: 'settings.coursePriceMin.help',
    shown: 'taka',
  },
  'catalog.coursePrice.maxPoisha': {
    group: 'prices',
    label: 'settings.coursePriceMax',
    help: 'settings.coursePriceMax.help',
    shown: 'taka',
  },
  'catalog.examPackagePrice.maxPoisha': {
    group: 'prices',
    label: 'settings.examPackagePriceMax',
    help: 'settings.examPackagePriceMax.help',
    shown: 'taka',
  },
  'catalog.planMonthlyPrice.maxPoisha': {
    group: 'prices',
    label: 'settings.planPriceMax',
    help: 'settings.planPriceMax.help',
    shown: 'taka',
  },
  'commerce.checkout.pendingExpiryMinutes': {
    group: 'prices',
    label: 'settings.checkoutExpiry',
    help: 'settings.checkoutExpiry.help',
    shown: 'minutes',
    editAt: '/admin/refunds',
  },
  'commerce.refund.windowDays': {
    group: 'refunds',
    label: 'settings.refundWindow',
    help: 'settings.refundWindow.help',
    shown: 'days',
    editAt: '/admin/refunds',
  },
  'commerce.trial.days': {
    group: 'refunds',
    label: 'settings.trialDays',
    help: 'settings.trialDays.help',
    shown: 'days',
    editAt: 'trials',
  },
  'commerce.trial.lessons': {
    group: 'refunds',
    label: 'settings.trialLessons',
    help: 'settings.trialLessons.help',
    shown: 'lessons',
    editAt: 'trials',
  },
  'auth.signIn.maxFailures': {
    group: 'security',
    label: 'settings.signInFailures',
    help: 'settings.signInFailures.help',
    shown: 'times',
  },
  'auth.signIn.windowMinutes': {
    group: 'security',
    label: 'settings.signInWindow',
    help: 'settings.signInWindow.help',
    shown: 'minutes',
  },
  'notifications.smsEnabled': {
    group: 'notifications',
    label: 'settings.sms',
    help: 'settings.sms.help',
    shown: 'onOff',
  },
  'notifications.pushEnabled': {
    group: 'notifications',
    label: 'settings.push',
    help: 'settings.push.help',
    shown: 'onOff',
  },
  'notifications.maxAttempts': {
    group: 'notifications',
    label: 'settings.notifyAttempts',
    help: 'settings.notifyAttempts.help',
    shown: 'times',
  },
  'retention.tokens.daily': {
    group: 'rewards',
    label: 'rewards.admin.daily',
    help: 'rewards.admin.dailyHint',
    shown: 'tokens',
    editAt: '/admin/rewards',
  },
  'retention.tokens.battleEntry': {
    group: 'rewards',
    label: 'settings.battleEntry',
    help: 'rewards.admin.entryHint',
    shown: 'tokens',
    editAt: '/admin/rewards',
  },
  'retention.shields.topN': {
    group: 'rewards',
    label: 'rewards.admin.topN',
    help: 'rewards.admin.topNHint',
    shown: 'winners',
    editAt: '/admin/rewards',
  },
  'retention.buddy.rounding': {
    group: 'rewards',
    label: 'settings.buddyRounding',
    help: 'rewards.admin.rounding',
    shown: 'rounding',
    editAt: '/admin/rewards',
  },
  'learning.video.badgeSeconds': {
    group: 'rewards',
    label: 'settings.videoBadge',
    help: 'settings.videoBadge.help',
    shown: 'seconds',
  },
  'referrals.shareBps': {
    group: 'referrals',
    label: 'settings.referralShare',
    help: 'settings.referralShare.help',
    shown: 'percent',
    editAt: '/admin/referrals',
  },
  'referrals.payoutThresholdPoisha': {
    group: 'referrals',
    label: 'settings.referralThreshold',
    help: 'settings.referralThreshold.help',
    shown: 'taka',
    editAt: '/admin/referrals',
  },
  'audit.retentionYears': {
    group: 'records',
    label: 'settings.auditYears',
    help: 'settings.auditYears.help',
    shown: 'years',
  },
  'payouts.statementRetentionYears': {
    group: 'records',
    label: 'settings.statementYears',
    help: 'settings.statementYears.help',
    shown: 'years',
  },
  'jobs.maxAttempts': {
    group: 'app',
    label: 'settings.jobAttempts',
    help: 'settings.jobAttempts.help',
    shown: 'times',
  },
  'appshell.installPrompt.minVisits': {
    group: 'app',
    label: 'settings.installVisits',
    help: 'settings.installVisits.help',
    shown: 'visits',
  },
  'appshell.installPrompt.dismissDays': {
    group: 'app',
    label: 'settings.installDismiss',
    help: 'settings.installDismiss.help',
    shown: 'days',
  },
};

const GROUPS: ReadonlyArray<{ key: GroupKey; label: MessageKey }> = [
  { key: 'prices', label: 'settings.group.prices' },
  { key: 'refunds', label: 'settings.group.refunds' },
  { key: 'security', label: 'settings.group.security' },
  { key: 'notifications', label: 'settings.group.notifications' },
  { key: 'rewards', label: 'settings.group.rewards' },
  { key: 'referrals', label: 'settings.group.referrals' },
  { key: 'records', label: 'settings.group.records' },
  { key: 'app', label: 'settings.group.app' },
  { key: 'other', label: 'settings.group.other' },
];

const UNIT: Record<
  Exclude<Shown, 'onOff' | 'taka' | 'percent' | 'rounding'>,
  [MessageKey, MessageKey]
> = {
  times: ['settings.unit.times.one', 'settings.unit.times'],
  visits: ['settings.unit.visits.one', 'settings.unit.visits'],
  tokens: ['settings.unit.tokens.one', 'settings.unit.tokens'],
  lessons: ['settings.unit.lessons.one', 'settings.unit.lessons'],
  winners: ['settings.unit.winners.one', 'settings.unit.winners'],
  seconds: ['settings.unit.seconds.one', 'settings.unit.seconds'],
  minutes: ['settings.unit.minutes.one', 'settings.unit.minutes'],
  days: ['settings.unit.days.one', 'settings.unit.days'],
  years: ['settings.unit.years.one', 'settings.unit.years'],
};

/** Prices this large mean "no real upper limit" (the registry's widest poisha bound). */
const NO_PRICE_CEILING = 9_999_999_999;

function useFormat() {
  const { t, tDynamic, locale, formatInteger } = useI18n();
  const decimal = new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-US', {
    maximumFractionDigits: 2,
  });
  return (shown: Shown, value: boolean | number | string): string => {
    if (shown === 'onOff') return value === true ? t('settings.on') : t('settings.off');
    if (shown === 'rounding') return tDynamic(`rewards.admin.rounding.${String(value)}`);
    if (typeof value !== 'number') return String(value);
    if (shown === 'taka') return formatMoney(value as MoneyPoisha, locale);
    if (shown === 'percent') return t('settings.unit.percent', { n: decimal.format(value / 100) });
    const [one, many] = UNIT[shown];
    return t(value === 1 ? one : many, { n: formatInteger(value) });
  };
}

export function SettingsOverview(props: { rows: readonly SettingRow[] }) {
  const { t } = useI18n();
  const rowsIn = (key: GroupKey) =>
    props.rows.filter((r) => (META[r.settingKey]?.group ?? 'other') === key);
  const blocking = props.rows.filter((r) => r.blocksWhenUnset && r.current.kind === 'notSet');
  return (
    <div className="grid gap-6" data-testid="admin-settings-table">
      {blocking.length > 0 ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-sm border border-omr/40 bg-omr-soft px-4 py-3 text-sm font-medium text-omr"
          data-testid="settings-blocking"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('settings.blocking', { n: blocking.length })}
        </p>
      ) : null}
      {GROUPS.map((group) => {
        const rows = rowsIn(group.key);
        if (rows.length === 0) return null;
        return (
          <section key={group.key} className="grid gap-2" aria-labelledby={`settings-${group.key}`}>
            <h3 id={`settings-${group.key}`} className="text-sm font-semibold text-ink">
              {t(group.label)}
            </h3>
            <ul className="divide-y divide-border rounded-sm border border-border bg-background">
              {rows.map((row) => (
                <SettingItem key={row.settingKey} row={row} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function CurrentValue({ current, shown }: { current: SettingCurrent; shown: Shown }) {
  const { t } = useI18n();
  const format = useFormat();
  if (current.kind === 'value') {
    return (
      <p className="text-base font-semibold text-ink tabular-nums" data-testid="setting-value">
        {format(shown, current.value)}
      </p>
    );
  }
  if (current.kind === 'perSegment') {
    return (
      <p className="text-sm font-medium text-ink">
        {t('settings.perSegment')}
        {current.defaultValue !== null ? (
          <span className="block text-ink-muted">
            {t('settings.defaultIs', { value: format(shown, current.defaultValue) })}
          </span>
        ) : null}
      </p>
    );
  }
  return (
    <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-omr-soft px-2.5 py-0.5 text-sm font-semibold text-omr">
      <CircleAlert aria-hidden="true" className="size-3.5" />
      {t('settings.notSet')}
    </p>
  );
}

function SettingItem({ row }: { row: SettingRow }) {
  const { t } = useI18n();
  const format = useFormat();
  const meta = META[row.settingKey];
  const shown: Shown =
    meta?.shown ??
    (row.valueType === 'boolean' ? 'onOff' : row.valueType === 'poisha' ? 'taka' : 'times');
  const range =
    shown === 'onOff'
      ? t('settings.range.onOff')
      : shown === 'rounding'
        ? t('settings.range.choice')
        : row.min !== null && row.max !== null
          ? shown === 'taka' && row.max >= NO_PRICE_CEILING
            ? t('settings.range.atLeast', { min: format(shown, row.min) })
            : t('settings.range.between', {
                min: format(shown, row.min),
                max: format(shown, row.max),
              })
          : null;
  const current = row.current;
  return (
    <li
      className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)] sm:gap-6"
      data-testid={`setting-${row.settingKey}`}
    >
      <div className="grid gap-1">
        <p className="font-medium text-ink">
          {meta ? t(meta.label) : <code className="text-sm">{row.settingKey}</code>}
        </p>
        {meta ? <p className="max-w-[65ch] text-sm text-ink-muted">{t(meta.help)}</p> : null}
        {meta?.editAt ? (
          meta.editAt === 'trials' ? (
            <a
              href="#admin-trials-title"
              className="w-fit text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('settings.editAbove')}
            </a>
          ) : (
            <Link
              to={meta.editAt}
              className="w-fit text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('settings.edit')}
            </Link>
          )
        ) : null}
      </div>
      <div className="grid content-start gap-1 sm:justify-items-end sm:text-right">
        <CurrentValue current={current} shown={shown} />
        {current.kind === 'value' ? (
          <p className="text-xs font-medium text-ink-muted">
            {current.isDefault ? t('settings.status.default') : t('settings.status.changed')}
          </p>
        ) : null}
        {range ? <p className="text-xs text-ink-muted">{range}</p> : null}
      </div>
    </li>
  );
}

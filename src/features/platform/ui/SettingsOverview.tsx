// A10 Settings, written for people: every registered setting in a topic group, with a plain label,
// one line on what it does, the value in force now (with its unit), the range an Admin may choose
// and whether it is the default, changed, or not set yet. Each one is changed in place (with a
// reason, kept in the audit log) through saveSetting, which checks the range again and versions
// the value; per-segment settings point to their own editor. A key this map does not know yet
// still shows, under "Other", by its raw key.
import { CircleAlert, Pencil } from 'lucide-react';
import { useState } from 'react';
import { normaliseDigits } from '#src/features/platform/domain/settings.ts';
import type { SettingCurrent } from '#src/features/platform/server/settings.functions.ts';
import type { MessageKey } from '#src/lib/i18n/index.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { formatMoney, type MoneyPoisha } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export type SettingRow = {
  settingKey: string;
  valueType: string;
  min: number | null;
  max: number | null;
  blocksWhenUnset: boolean;
  current: SettingCurrent;
};

export type Shown =
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
type EditAt = 'trials';

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
  },
  'commerce.refund.windowDays': {
    group: 'refunds',
    label: 'settings.refundWindow',
    help: 'settings.refundWindow.help',
    shown: 'days',
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
  },
  'retention.tokens.battleEntry': {
    group: 'rewards',
    label: 'settings.battleEntry',
    help: 'rewards.admin.entryHint',
    shown: 'tokens',
  },
  'retention.shields.topN': {
    group: 'rewards',
    label: 'rewards.admin.topN',
    help: 'rewards.admin.topNHint',
    shown: 'winners',
  },
  'retention.buddy.rounding': {
    group: 'rewards',
    label: 'settings.buddyRounding',
    help: 'rewards.admin.rounding',
    shown: 'rounding',
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
  },
  'referrals.payoutThresholdPoisha': {
    group: 'referrals',
    label: 'settings.referralThreshold',
    help: 'settings.referralThreshold.help',
    shown: 'taka',
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

export function SettingsOverview(props: { rows: readonly SettingRow[]; onSave: SaveSetting }) {
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
                <SettingItem key={row.settingKey} row={row} onSave={props.onSave} />
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

export type SaveSettingOutcome =
  | { ok: true }
  | {
      ok: false;
      error: { code: string; i18nKey?: string; fieldErrors?: Record<string, readonly string[]> };
    };
export type SaveSetting = (input: {
  settingKey: string;
  value: boolean | number | string;
  reason: string;
}) => Promise<SaveSettingOutcome>;

const ROUNDING = ['half_up', 'down', 'up'] as const;

/** Taka and percent are typed with up to two decimals and stored as hundredths (poisha, bps). */
function parseHundredths(text: string): number | null {
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/**
 * The typed text as the stored value (Bangla digits accepted), or null when it is not a valid
 * entry for this kind of setting. Exported for the unit tests.
 */
export function toStoredValue(shown: Shown, text: string): boolean | number | string | null {
  const clean = normaliseDigits(text.trim()).replaceAll(',', '');
  if (shown === 'onOff') return clean === 'true' ? true : clean === 'false' ? false : null;
  if (shown === 'rounding') return (ROUNDING as readonly string[]).includes(clean) ? clean : null;
  if (shown === 'taka' || shown === 'percent') return parseHundredths(clean);
  return /^\d{1,12}$/.test(clean) ? Number(clean) : null;
}

/** The stored value as the text a form starts from. */
export function toFormText(shown: Shown, value: boolean | number | string | null): string {
  if (value === null) return shown === 'onOff' ? 'false' : shown === 'rounding' ? 'half_up' : '';
  if (typeof value === 'number' && (shown === 'taka' || shown === 'percent')) {
    const fraction = value % 100;
    return fraction === 0
      ? String(Math.trunc(value / 100))
      : `${Math.trunc(value / 100)}.${String(fraction).padStart(2, '0')}`;
  }
  return String(value);
}

/** The value field for one kind of setting: two choices, a choice list, or a number. */
function ValueInput(props: {
  id: string;
  shown: Shown;
  text: string;
  onText: (text: string) => void;
  describedBy: string | undefined;
}) {
  const { t, tDynamic } = useI18n();
  const { id, shown, text } = props;
  if (shown === 'onOff') {
    return (
      <RadioGroup
        id={id}
        value={text}
        onValueChange={props.onText}
        className="flex flex-wrap gap-4"
      >
        {(['true', 'false'] as const).map((v) => (
          <Label key={v} className="flex min-h-11 items-center gap-2 font-normal">
            <RadioGroupItem value={v} />
            {v === 'true' ? t('settings.on') : t('settings.off')}
          </Label>
        ))}
      </RadioGroup>
    );
  }
  if (shown === 'rounding') {
    return (
      <NativeSelect id={id} value={text} onChange={(e) => props.onText(e.target.value)}>
        {ROUNDING.map((v) => (
          <option key={v} value={v}>
            {tDynamic(`rewards.admin.rounding.${v}`)}
          </option>
        ))}
      </NativeSelect>
    );
  }
  return (
    <div className="flex max-w-xs items-center gap-2">
      {shown === 'taka' ? (
        <span aria-hidden="true" className="font-semibold text-ink-muted">
          {t('settings.form.taka')}
        </span>
      ) : null}
      <Input
        id={id}
        inputMode={shown === 'taka' || shown === 'percent' ? 'decimal' : 'numeric'}
        autoComplete="off"
        value={text}
        onChange={(e) => props.onText(e.target.value)}
        aria-describedby={props.describedBy}
        className="tabular-nums"
      />
      {shown === 'percent' ? (
        <span aria-hidden="true" className="font-semibold text-ink-muted">
          {t('settings.form.percent')}
        </span>
      ) : null}
    </div>
  );
}

function SettingEditor(props: {
  row: SettingRow;
  shown: Shown;
  range: string | null;
  onSave: SaveSetting;
  onDone: () => void;
}) {
  const { t, tDynamic } = useI18n();
  const { row, shown } = props;
  const start = row.current.kind === 'value' ? row.current.value : null;
  const [text, setText] = useState(() => toFormText(shown, start));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const id = `setting-edit-${row.settingKey.replaceAll('.', '-')}`;
  const save = async () => {
    setError(null);
    const value = toStoredValue(shown, text);
    if (value === null) return setError('settings.form.invalid');
    if (
      typeof value === 'number' &&
      ((row.min !== null && value < row.min) || (row.max !== null && value > row.max))
    )
      return setError('settings.form.outOfRange');
    if (reason.trim().length < 3) return setError('settings.form.reasonRequired');
    setIsSaving(true);
    const r = await props.onSave({ settingKey: row.settingKey, value, reason: reason.trim() });
    setIsSaving(false);
    if (r.ok) return props.onDone();
    const fields = r.error.fieldErrors;
    setError(
      fields?.value?.[0] ?? fields?.reason?.[0] ?? r.error.i18nKey ?? 'settings.form.failed',
    );
  };
  return (
    <form
      noValidate
      className="grid gap-4 border-t border-dashed border-border pt-4 sm:col-span-2"
      aria-label={t('settings.form.label')}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      data-testid="setting-editor"
    >
      <div className="grid gap-1.5">
        <Label htmlFor={id}>{t('settings.form.value')}</Label>
        <ValueInput
          id={id}
          shown={shown}
          text={text}
          onText={setText}
          describedBy={props.range ? `${id}-range` : undefined}
        />
        {props.range ? (
          <p id={`${id}-range`} className="text-xs text-ink-muted">
            {props.range}
          </p>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-reason`}>{t('settings.form.reason')}</Label>
        <Input
          id={`${id}-reason`}
          autoComplete="off"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-describedby={`${id}-reason-hint`}
        />
        <p id={`${id}-reason-hint`} className="text-xs text-ink-muted">
          {t('settings.form.reasonHint')}
        </p>
      </div>
      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-destructive">
          <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
          {tDynamic(error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSaving} data-testid="setting-save">
          {t('settings.form.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={props.onDone}>
          {t('settings.form.cancel')}
        </Button>
      </div>
    </form>
  );
}

function SettingItem({ row, onSave }: { row: SettingRow; onSave: SaveSetting }) {
  const { t } = useI18n();
  const format = useFormat();
  const [isEditing, setIsEditing] = useState(false);
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
  // Only scalar settings this screen understands are edited here; per-segment ones have their
  // own editor (the free-trial caps above).
  const isEditable =
    current.kind !== 'perSegment' &&
    ['boolean', 'integer', 'poisha', 'basis_points', 'string'].includes(row.valueType) &&
    (row.valueType !== 'string' || shown === 'rounding');
  return (
    <li
      className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)] sm:gap-x-6"
      data-testid={`setting-${row.settingKey}`}
    >
      <div className="grid content-start gap-1">
        <p className="font-medium text-ink">
          {meta ? t(meta.label) : <code className="text-sm">{row.settingKey}</code>}
        </p>
        {meta ? <p className="max-w-[65ch] text-sm text-ink-muted">{t(meta.help)}</p> : null}
        {current.kind === 'perSegment' && meta?.editAt === 'trials' ? (
          <a
            href="#admin-trials-title"
            className="tap-target w-fit text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('settings.editAbove')}
          </a>
        ) : null}
        {isEditable && !isEditing ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1 w-fit"
            onClick={() => setIsEditing(true)}
            data-testid="setting-change"
          >
            <Pencil aria-hidden="true" />
            {current.kind === 'notSet' ? t('settings.form.set') : t('settings.edit')}
          </Button>
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
      {isEditing ? (
        <SettingEditor
          row={row}
          shown={shown}
          range={range}
          onSave={onSave}
          onDone={() => setIsEditing(false)}
        />
      ) : null}
    </li>
  );
}

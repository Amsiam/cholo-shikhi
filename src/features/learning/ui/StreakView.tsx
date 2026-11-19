// S8 Me → Streak (US5.3, US5.16): the Goal-streak, streak-shields with the days they forgave, and
// the streak-token balance with its history. Every state is shown as text and an icon, never colour
// alone. With nothing earned yet, the page explains how to earn tokens and shields.
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  Coins,
  Flame,
  HeartHandshake,
  Shield,
  ShieldCheck,
  Swords,
  Trophy,
} from 'lucide-react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { MyRewards } from '../server/streak.server.ts';

const card = 'flex flex-col gap-2 border border-primary/15 bg-background p-5';

function Stat(props: { icon: React.ReactNode; value: string; label: string; testId: string }) {
  return (
    <div className={card} data-testid={props.testId}>
      <span className="flex items-center gap-2 text-sm font-semibold text-ink/80">
        {props.icon}
        {props.label}
      </span>
      <span className="text-4xl leading-none font-extrabold tabular-nums">{props.value}</span>
    </div>
  );
}

export function StreakView(props: { data: MyRewards }) {
  const { t, locale, formatInteger, formatDate, formatDateTime } = useI18n();
  const { streak, shields, history } = props.data;
  const weekday = new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
    weekday: 'short',
    timeZone: 'UTC',
  });
  const dayLabel = (day: string) => formatDate(`${day}T06:00:00Z`);
  const isEmpty = streak.current === 0 && shields.length === 0 && history.length === 0;
  const signed = (n: number) => (n > 0 ? `+${formatInteger(n)}` : `−${formatInteger(-n)}`);
  const entryNote =
    props.data.battleEntryTokens === 0
      ? t('streak.earn.battleFree')
      : t('streak.earn.battle', { n: formatInteger(props.data.battleEntryTokens) });

  return (
    <div className="flex flex-col gap-8" data-testid="streak-page">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <Flame aria-hidden="true" className="size-8 text-primary" />
          {t('streak.title')}
        </h1>
        <p className="text-ink/75">{t('streak.subtitle')}</p>
      </header>

      {streak.goalId === null ? (
        <p className="border border-primary/15 bg-background p-4">
          {t('streak.noGoal')}{' '}
          <Link to="/me/goal" className="tap-target font-semibold text-primary hover:underline">
            {t('practice.chooseGoal')}
          </Link>
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          testId="streak-stat-current"
          icon={<Flame aria-hidden="true" className="size-4 text-primary" />}
          label={t('streak.stat.current')}
          value={formatInteger(streak.current)}
        />
        <Stat
          testId="streak-stat-shields"
          icon={<Shield aria-hidden="true" className="size-4 text-primary" />}
          label={t('streak.stat.shields')}
          value={formatInteger(streak.shieldsAvailable)}
        />
        <Stat
          testId="streak-stat-tokens"
          icon={<Coins aria-hidden="true" className="size-4 text-primary" />}
          label={t('streak.stat.tokens')}
          value={formatInteger(streak.tokens)}
        />
      </div>

      <section className={card} aria-labelledby="streak-week">
        <h2 id="streak-week" className="text-lg font-bold">
          {t('streak.week')}
        </h2>
        <ol className="grid grid-cols-7 gap-2">
          {streak.week.map((d) => {
            const state = d.isActive ? 'active' : d.isShielded ? 'shielded' : 'missed';
            const DayIcon = state === 'active' ? Flame : state === 'shielded' ? Shield : null;
            const dayIcon = DayIcon ? <DayIcon aria-hidden="true" className="size-4" /> : null;
            return (
              <li key={d.day} className="flex flex-col items-center gap-1 text-center">
                <span
                  className={`grid size-9 place-items-center rounded-full border-2 ${
                    state === 'active'
                      ? 'border-primary bg-primary text-primary-foreground'
                      : state === 'shielded'
                        ? 'border-primary text-primary'
                        : 'border-primary/25 text-ink-muted'
                  }`}
                >
                  {dayIcon}
                </span>
                <span className="text-xs font-semibold">
                  {weekday.format(new Date(`${d.day}T12:00:00Z`))}
                </span>
                <span className="text-[0.7rem] leading-tight text-ink-muted">
                  {t(`streak.day.${state}`)}
                </span>
              </li>
            );
          })}
        </ol>
        {streak.best > 0 ? (
          <p className="flex items-center gap-2 text-sm text-ink/80">
            <Trophy aria-hidden="true" className="size-4 text-primary" />
            {t('dashboard.streak.best', { n: formatInteger(streak.best) })}
          </p>
        ) : null}
      </section>

      <section className={card} aria-labelledby="streak-earn" data-testid="streak-earn">
        <h2 id="streak-earn" className="text-lg font-bold">
          {isEmpty ? t('streak.empty.title') : t('streak.earn.title')}
        </h2>
        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex items-start gap-2">
            <Coins aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            {t('streak.earn.daily', { n: formatInteger(props.data.dailyTokens) })}
          </li>
          <li className="flex items-start gap-2">
            <Shield aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            {t('streak.earn.shield', { n: formatInteger(props.data.shieldTopN) })}
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            {t('streak.earn.forgive')}
          </li>
          <li className="flex items-start gap-2">
            <HeartHandshake aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            {t('streak.earn.buddy')}
          </li>
          <li className="flex items-start gap-2">
            <Swords aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            {entryNote}
          </li>
        </ul>
        <Link
          to="/me/buddy"
          className="inline-flex min-h-11 w-fit items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline"
        >
          {t('streak.toBuddy')}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
        <Link
          to="/battles"
          className="inline-flex min-h-11 w-fit items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline"
        >
          {t('streak.toBattles')}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card} aria-labelledby="streak-shields" data-testid="streak-shields">
          <h2 id="streak-shields" className="text-lg font-bold">
            {t('streak.shields.title')}
          </h2>
          {shields.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('streak.shields.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-primary/10">
              {shields.map((s) => (
                <li
                  key={s.earnedAt}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    {s.usedForDay ? (
                      <ShieldCheck aria-hidden="true" className="size-4 text-ink-muted" />
                    ) : (
                      <Shield aria-hidden="true" className="size-4 text-primary" />
                    )}
                    {t('streak.shields.earned', { date: formatDate(s.earnedAt) })}
                  </span>
                  <span className={s.usedForDay ? 'text-ink-muted' : 'font-semibold'}>
                    {s.usedForDay
                      ? t('streak.shields.used', { date: dayLabel(s.usedForDay) })
                      : t('streak.shields.available')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card} aria-labelledby="streak-history" data-testid="streak-history">
          <h2 id="streak-history" className="text-lg font-bold">
            {t('streak.history.title')}
          </h2>
          {history.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('streak.history.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-primary/10">
              {history.map((h) => (
                <li
                  key={`${h.reason}-${h.ref}`}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{t(`streak.reason.${h.reason}`)}</span>
                    <span className="text-xs text-ink-muted">{formatDateTime(h.at)}</span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="block font-bold">{signed(h.delta)}</span>
                    <span className="text-xs text-ink-muted">
                      {t('streak.history.balance', { n: formatInteger(h.balance) })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

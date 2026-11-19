// The battle home: quick match, a room for friends (make one or join with a code), staff-hosted
// battles of the Student's tier, the battle in progress, and recent results.
import { useForm } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  CalendarClock,
  Coins,
  KeyRound,
  Swords,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import type { PracticeCatalog } from '#src/features/learning/server/practice.server.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import type { BattleHome, BattleSummary } from '../server/battle.server.ts';

type Outcome<T> = { ok: true; value: T } | { ok: false; error: { i18nKey: string } };
type Source = 'bank' | 'vault';
const pick = (bn: string | null, en: string | null, locale: string) =>
  (locale === 'bn' ? bn : en) || bn || en || '';

function TopicPicker(props: {
  id: string;
  catalog: PracticeCatalog;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <NativeSelect
      id={props.id}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    >
      <option value="">{t('battle.anyTopic')}</option>
      {props.catalog.subjects.map((s) => (
        <optgroup key={s.subjectId} label={pick(s.nameBn, s.nameEn, locale)}>
          {s.topics
            .filter((tp) => tp.questionCount > 0)
            .flatMap((tp) => [
              <option key={tp.topicId} value={tp.topicId}>
                {pick(tp.nameBn, tp.nameEn, locale)}
              </option>,
              ...tp.subtopics
                .filter((x) => x.questionCount > 0)
                .map((x) => (
                  <option key={x.topicId} value={x.topicId}>
                    {`${pick(tp.nameBn, tp.nameEn, locale)} › ${pick(x.nameBn, x.nameEn, locale)}`}
                  </option>
                )),
            ])}
        </optgroup>
      ))}
    </NativeSelect>
  );
}

function SourceToggle(props: { name: string; value: Source; onChange: (v: Source) => void }) {
  const { t } = useI18n();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{t('battle.source')}</legend>
      <div className="flex flex-wrap gap-2">
        {(['bank', 'vault'] as const).map((v) => (
          <label
            key={v}
            className={`flex min-h-11 cursor-pointer items-center rounded-sm border px-3 text-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 ${
              props.value === v
                ? 'border-primary bg-primary/10 font-semibold text-primary'
                : 'border-primary/25'
            }`}
          >
            <input
              type="radio"
              className="sr-only"
              name={props.name}
              checked={props.value === v}
              onChange={() => props.onChange(v)}
            />
            {t(`battle.source.${v}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SummaryLine(props: { b: BattleSummary }) {
  const { t, locale, formatInteger, formatDateTime } = useI18n();
  const b = props.b;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-muted">
      <span>{pick(b.topicBn, b.topicEn, locale) || t('battle.anyTopic')}</span>
      <span>{t('exams.questions', { n: formatInteger(b.questionCount) })}</span>
      <span>{t('exams.minutes', { n: formatInteger(Math.round(b.durationSeconds / 60)) })}</span>
      {b.mode === 'hosted' && b.startsAt ? <span>{formatDateTime(b.startsAt)}</span> : null}
    </span>
  );
}

const card = 'flex flex-col gap-4 border border-primary/15 bg-background p-5';

export function BattleHomeView(props: {
  home: BattleHome;
  catalog: PracticeCatalog;
  onQuick: (input: { topicId?: string; source: Source }) => Promise<Outcome<{ battleId: string }>>;
  onCreateRoom: (input: {
    topicId?: string;
    source: Source;
    questionCount: number;
  }) => Promise<Outcome<{ battleId: string }>>;
  onJoinCode: (code: string) => Promise<Outcome<{ battleId: string }>>;
  onJoinHosted: (battleId: string) => Promise<Outcome<{ battleId: string }>>;
}) {
  const { t, tDynamic, locale, formatInteger } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const h = props.home;
  const run = async (key: string, fn: () => Promise<Outcome<unknown>>) => {
    setBusy(key);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) setError(r.error.i18nKey);
  };

  const quick = useForm({
    defaultValues: { topicId: '', source: 'bank' as Source },
    onSubmit: ({ value }) =>
      run('quick', () =>
        props.onQuick({
          ...(value.topicId ? { topicId: value.topicId } : {}),
          source: value.source,
        }),
      ),
  });
  const room = useForm({
    defaultValues: { topicId: '', source: 'bank' as Source, questionCount: 10 },
    onSubmit: ({ value }) =>
      run('room', () =>
        props.onCreateRoom({
          ...(value.topicId ? { topicId: value.topicId } : {}),
          source: value.source,
          questionCount: value.questionCount,
        }),
      ),
  });
  const join = useForm({
    defaultValues: { code: '' },
    onSubmit: ({ value }) => run('join', () => props.onJoinCode(value.code)),
  });

  const isShort = h.tokens < h.entryTokens;
  const entryText =
    h.entryTokens === 0
      ? t('battle.tokens.free')
      : isShort
        ? t('battle.tokens.short', { n: formatInteger(h.entryTokens) })
        : t('battle.tokens.entry', { n: formatInteger(h.entryTokens) });
  return (
    <div className="flex flex-col gap-8" data-testid="battle-home">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <Swords aria-hidden="true" className="size-8 text-primary" />
          {t('battle.title')}
        </h1>
        <p className="text-ink/75">{t('battle.subtitle')}</p>
      </header>

      {!h.hasGoal ? (
        <p className="border border-primary/15 bg-background p-4">
          {t('errors.battle.noGoal')}{' '}
          <Link to="/me/goal" className="tap-target font-semibold text-primary hover:underline">
            {t('practice.chooseGoal')}
          </Link>
        </p>
      ) : null}

      {h.current ? (
        <section className="flex flex-wrap items-center justify-between gap-3 border-2 border-primary bg-primary/5 p-5">
          <span className="flex flex-col gap-1">
            <span className="font-bold">
              {t(
                h.current.status === 'running'
                  ? 'battle.current.running'
                  : 'battle.current.waiting',
              )}
            </span>
            <SummaryLine b={h.current} />
          </span>
          <Button asChild>
            <Link
              to="/battles/$battleId"
              params={{ battleId: h.current.battleId }}
              data-testid="battle-resume"
            >
              {t('battle.current.open')}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </Button>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <form
          noValidate
          className={card}
          onSubmit={(e) => {
            e.preventDefault();
            void quick.handleSubmit();
          }}
          data-testid="battle-quick"
        >
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Zap aria-hidden="true" className="size-5 text-primary" />
            {t('battle.quick.title')}
          </h2>
          <p className="text-sm text-ink/80">{t('battle.quick.body')}</p>
          <p
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
            data-testid="battle-tokens"
          >
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Coins aria-hidden="true" className="size-4 text-primary" />
              {t('battle.tokens.balance', { n: formatInteger(h.tokens) })}
            </span>
            <span className="text-ink-muted">{entryText}</span>
          </p>
          <quick.Field name="topicId">
            {(field) => (
              <div className="grid gap-1.5">
                <Label htmlFor="quick-topic">{t('bank.field.topic')}</Label>
                <TopicPicker
                  id="quick-topic"
                  catalog={props.catalog}
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              </div>
            )}
          </quick.Field>
          <quick.Field name="source">
            {(field) => (
              <SourceToggle
                name="quick-source"
                value={field.state.value}
                onChange={field.handleChange}
              />
            )}
          </quick.Field>
          <Button
            type="submit"
            className="w-fit"
            disabled={!h.hasGoal || busy !== null || isShort}
            data-testid="battle-quick-go"
          >
            {t('battle.quick.go')}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
        </form>

        <div className={card}>
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Users aria-hidden="true" className="size-5 text-primary" />
            {t('battle.friend.title')}
          </h2>
          <form
            noValidate
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void join.handleSubmit();
            }}
          >
            <join.Field name="code">
              {(field) => (
                <div className="grid min-w-40 flex-1 gap-1.5">
                  <Label htmlFor="battle-code">{t('battle.friend.code')}</Label>
                  <Input
                    id="battle-code"
                    autoCapitalize="characters"
                    autoComplete="off"
                    maxLength={12}
                    className="font-mono tracking-widest uppercase"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    data-testid="battle-code"
                  />
                </div>
              )}
            </join.Field>
            <Button
              type="submit"
              variant="outline"
              disabled={!h.hasGoal || busy !== null}
              data-testid="battle-join"
            >
              <KeyRound aria-hidden="true" className="size-4" />
              {t('battle.friend.join')}
            </Button>
          </form>
          <form
            noValidate
            className="flex flex-col gap-4 border-t border-primary/10 pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void room.handleSubmit();
            }}
          >
            <p className="text-sm text-ink/80">{t('battle.friend.body')}</p>
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <room.Field name="topicId">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor="room-topic">{t('bank.field.topic')}</Label>
                    <TopicPicker
                      id="room-topic"
                      catalog={props.catalog}
                      value={field.state.value}
                      onChange={field.handleChange}
                    />
                  </div>
                )}
              </room.Field>
              <room.Field name="questionCount">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor="room-count">{t('exams.custom.count')}</Label>
                    <NativeSelect
                      id="room-count"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(Number(e.target.value))}
                    >
                      {[5, 10, 20].map((n) => (
                        <option key={n} value={n}>
                          {formatInteger(n)}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                )}
              </room.Field>
            </div>
            <room.Field name="source">
              {(field) => (
                <SourceToggle
                  name="room-source"
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              )}
            </room.Field>
            <Button
              type="submit"
              className="w-fit"
              disabled={!h.hasGoal || busy !== null}
              data-testid="battle-room-create"
            >
              {t('battle.friend.create')}
            </Button>
          </form>
        </div>
      </div>

      <section aria-labelledby="battle-hosted" className="flex flex-col gap-3">
        <h2 id="battle-hosted" className="flex items-center gap-2 text-xl font-bold">
          <CalendarClock aria-hidden="true" className="size-5 text-primary" />
          {t('battle.hosted.title')}
        </h2>
        {h.hosted.length === 0 ? (
          <p className="border border-dashed border-primary/25 bg-background p-4 text-sm text-ink-muted">
            {t('battle.hosted.empty')}
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {h.hosted.map((b) => (
              <li key={b.battleId} className={card} data-testid="battle-hosted-card">
                <span className="flex flex-col gap-1">
                  <span className="font-bold">{pick(b.titleBn, b.titleEn, locale)}</span>
                  <SummaryLine b={b} />
                  <span className="text-sm">
                    {t(b.status === 'running' ? 'battle.hosted.live' : 'battle.hosted.players', {
                      n: formatInteger(b.players),
                    })}
                  </span>
                </span>
                <Button
                  className="w-fit"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void run('hosted', () => props.onJoinHosted(b.battleId))}
                  data-testid="battle-hosted-join"
                >
                  {t('battle.hosted.join')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {h.recent.length > 0 ? (
        <section aria-labelledby="battle-recent" className="flex flex-col gap-3">
          <h2 id="battle-recent" className="flex items-center gap-2 text-xl font-bold">
            <Trophy aria-hidden="true" className="size-5 text-primary" />
            {t('battle.recent.title')}
          </h2>
          <ul className="flex flex-col divide-y divide-primary/10 border border-primary/15 bg-background">
            {h.recent.map((b) => (
              <li
                key={b.battleId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">
                    {b.mode === 'hosted'
                      ? pick(b.titleBn, b.titleEn, locale)
                      : t(`battle.mode.${b.mode}`)}
                  </span>
                  <SummaryLine b={b} />
                </span>
                <Link
                  to="/battles/$battleId"
                  params={{ battleId: b.battleId }}
                  className="tap-target font-semibold text-primary hover:underline"
                >
                  {b.myRank
                    ? t('battle.recent.place', {
                        rank: formatInteger(b.myRank),
                        n: formatInteger(b.players),
                      })
                    : t('exams.viewResult')}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

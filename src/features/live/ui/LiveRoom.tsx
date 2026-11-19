// The Student's side of live classes: the list (live now, coming up, recordings) and the room, with
// the YouTube Live player, a heartbeat for attendance and the pop-quiz panel. Refreshes itself.
import { Link } from '@tanstack/react-router';
import { CalendarClock, CircleCheck, Clock, Radio, Shield, Video } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { LiveClassCard, LiveRoom as LiveRoomData } from '../server/live.server.ts';

type Outcome = { ok: true } | { ok: false; error: { i18nKey: string } };
const LETTERS = { bn: ['ক', 'খ', 'গ', 'ঘ'], en: ['A', 'B', 'C', 'D'] } as const;
const pick = (bn: string, en: string, locale: string) => (locale === 'bn' ? bn : en) || bn || en;

export function LiveStateBadge(props: { state: LiveClassCard['state'] }) {
  const { t } = useI18n();
  const tone =
    props.state === 'live'
      ? 'bg-omr text-white'
      : props.state === 'open'
        ? 'bg-primary text-primary-foreground'
        : props.state === 'upcoming'
          ? 'bg-primary/10 text-primary'
          : 'bg-ink/10 text-ink';
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}
    >
      {props.state === 'live' ? <Radio aria-hidden="true" className="size-3.5" /> : null}
      {t(`live.state.${props.state}`)}
    </span>
  );
}

function ClassItem(props: { c: LiveClassCard; isRecording?: boolean }) {
  const { t, locale, formatDateTime, formatInteger } = useI18n();
  const c = props.c;
  const canEnter = props.isRecording || c.state === 'open' || c.state === 'live';
  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-3 border bg-background p-4 ${c.state === 'live' ? 'border-2 border-omr' : 'border-primary/15'}`}
      data-testid="live-item"
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-bold break-words">{pick(c.titleBn, c.titleEn, locale)}</span>
          {props.isRecording ? null : <LiveStateBadge state={c.state} />}
        </span>
        <span className="text-sm text-ink-muted">
          {pick(c.courseTitleBn, c.courseTitleEn, locale)}
        </span>
        <span className="inline-flex items-center gap-1.5 text-sm">
          <CalendarClock aria-hidden="true" className="size-4 text-primary" />
          {formatDateTime(c.startsAt)} ·{' '}
          {t('exams.minutes', { n: formatInteger(c.durationMinutes) })}
        </span>
      </span>
      {canEnter ? (
        <Link
          to="/live/$liveClassId"
          params={{ liveClassId: c.liveClassId }}
          className="inline-flex min-h-11 items-center gap-2 rounded-sm bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
          data-testid="live-enter"
        >
          {props.isRecording ? (
            <Video aria-hidden="true" className="size-4" />
          ) : (
            <Radio aria-hidden="true" className="size-4" />
          )}
          {t(props.isRecording ? 'live.watchRecording' : 'live.enter')}
        </Link>
      ) : (
        <span className="text-sm text-ink-muted">{t('live.opensEarly')}</span>
      )}
    </li>
  );
}

export function LiveListView(props: { upcoming: LiveClassCard[]; recordings: LiveClassCard[] }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-8" data-testid="live-page">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <Radio aria-hidden="true" className="size-8 text-primary" />
          {t('live.title')}
        </h1>
        <p className="text-ink/75">{t('live.subtitle')}</p>
      </header>
      <section aria-labelledby="live-upcoming" className="flex flex-col gap-3">
        <h2 id="live-upcoming" className="text-xl font-bold">
          {t('live.upcoming')}
        </h2>
        {props.upcoming.length === 0 ? (
          <p className="border border-dashed border-primary/25 bg-background p-4 text-sm text-ink-muted">
            {t('live.none')}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {props.upcoming.map((c) => (
              <ClassItem key={c.liveClassId} c={c} />
            ))}
          </ul>
        )}
      </section>
      {props.recordings.length > 0 ? (
        <section aria-labelledby="live-recordings" className="flex flex-col gap-3">
          <h2 id="live-recordings" className="text-xl font-bold">
            {t('live.recordings')}
          </h2>
          <ul className="flex flex-col gap-3">
            {props.recordings.map((c) => (
              <ClassItem key={c.liveClassId} c={c} isRecording />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Seconds left until an instant, against the server's clock. */
function useSecondsLeft(until: string | null, serverNow: string): number | null {
  const offset = useRef(new Date(serverNow).getTime() - Date.now());
  const [now, setNow] = useState(() => Date.now() + offset.current);
  useEffect(() => {
    offset.current = new Date(serverNow).getTime() - Date.now();
  }, [serverNow]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => window.clearInterval(id);
  }, []);
  return until ? Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000)) : null;
}

function QuizPanel(props: {
  room: LiveRoomData;
  onAnswer: (quizId: string, questionId: string, chosenIndex: number) => Promise<Outcome>;
}) {
  const { t, tDynamic, locale, formatInteger } = useI18n();
  const quiz = props.room.quiz;
  const left = useSecondsLeft(quiz?.closesAt ?? null, props.room.serverNow);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const letters = LETTERS[locale];
  if (!quiz) return null;
  if (quiz.phase === 'over')
    return (
      <section
        aria-labelledby="live-quiz-review"
        className="flex flex-col gap-3 border border-primary/15 bg-background p-4"
        data-testid="live-quiz-review"
      >
        <h2 id="live-quiz-review" className="flex items-center gap-2 text-lg font-bold">
          <CircleCheck aria-hidden="true" className="size-5 text-pass" />
          {t('live.quiz.over', {
            n: formatInteger(quiz.myScore ?? 0),
            total: formatInteger(quiz.total),
          })}
        </h2>
        {quiz.earnedShield ? (
          <p
            className="flex items-center gap-2 border border-primary/30 bg-primary/5 p-3 text-sm font-semibold"
            data-testid="live-earned-shield"
          >
            <Shield aria-hidden="true" className="size-5 text-primary" />
            {t('live.quiz.earnedShield')}
          </p>
        ) : null}
        <ol className="flex flex-col gap-2">
          {quiz.review.map((q, n) => {
            const options = locale === 'bn' ? q.optionsBn : q.optionsEn;
            return (
              <li key={q.questionId} className="flex flex-col gap-1 text-sm">
                <span className="font-semibold">
                  {formatInteger(n + 1)}. {pick(q.promptBn, q.promptEn, locale)}
                </span>
                <span>
                  {t('live.quiz.right', {
                    answer: `${letters[q.correctIndex] ?? ''} ${options[q.correctIndex] ?? ''}`,
                  })}
                  {q.chosenIndex === null
                    ? ` · ${t('exams.review.skipped')}`
                    : q.chosenIndex === q.correctIndex
                      ? ''
                      : ` · ${t('live.quiz.yours', { answer: letters[q.chosenIndex] ?? '' })}`}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    );
  const q = quiz.question;
  if (!q) return null;
  const options = locale === 'bn' ? q.optionsBn : q.optionsEn;
  const chosen = quiz.myChoice ?? picked[q.questionId] ?? null;
  return (
    <section
      aria-labelledby="live-quiz-q"
      className="flex flex-col gap-3 border-2 border-omr bg-background p-4"
      data-testid="live-quiz"
    >
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold text-omr">
          {t('live.quiz.question', {
            n: formatInteger((quiz.index ?? 0) + 1),
            total: formatInteger(quiz.total),
          })}
        </span>
        <span role="timer" className="inline-flex items-center gap-1 font-bold tabular-nums">
          <Clock aria-hidden="true" className="size-4" />
          {formatInteger(left ?? 0)}
        </span>
      </div>
      <h2 id="live-quiz-q" className="text-lg font-bold">
        {pick(q.promptBn, q.promptEn, locale)}
      </h2>
      <fieldset className="flex flex-col gap-2" disabled={chosen !== null}>
        <legend className="sr-only">{t('vault.practice.choose')}</legend>
        {options.map((o, i) => (
          <label
            key={letters[i]}
            className={`flex min-h-11 cursor-pointer items-center gap-3 border px-3 py-2 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 ${chosen === i ? 'border-ink bg-ink/5' : 'border-primary/20'}`}
            data-testid="live-quiz-option"
          >
            <input
              type="radio"
              className="sr-only"
              name={`live-${q.questionId}`}
              checked={chosen === i}
              onChange={async () => {
                setPicked((p) => ({ ...p, [q.questionId]: i }));
                const r = await props.onAnswer(quiz.quizId, q.questionId, i);
                setError(r.ok ? null : r.error.i18nKey);
              }}
            />
            <span
              aria-hidden="true"
              className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${chosen === i ? 'border-ink bg-ink text-ink-foreground' : 'border-omr text-omr'}`}
            >
              {letters[i]}
            </span>
            {o}
          </label>
        ))}
      </fieldset>
      {chosen !== null ? (
        <p className="text-sm text-ink/80" role="status">
          {t('live.quiz.sent')}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
    </section>
  );
}

export function LiveRoomView(props: {
  initial: LiveRoomData;
  onRefresh: () => Promise<LiveRoomData | null>;
  onHeartbeat: (isVisible: boolean) => Promise<void>;
  onAnswer: (quizId: string, questionId: string, chosenIndex: number) => Promise<Outcome>;
}) {
  const { t, locale, formatDateTime } = useI18n();
  const [room, setRoom] = useState(props.initial);
  const refresh = useCallback(async () => {
    const next = await props.onRefresh();
    if (next) setRoom(next);
  }, [props.onRefresh]);
  const state = room.liveClass.state;
  const isActive = state === 'open' || state === 'live';

  useEffect(() => {
    if (!isActive) return;
    const beat = () => void props.onHeartbeat(document.visibilityState === 'visible');
    beat();
    const id = window.setInterval(beat, 30_000);
    return () => window.clearInterval(id);
  }, [isActive, props.onHeartbeat]);
  useEffect(() => {
    if (state === 'ended') return;
    const id = window.setInterval(() => void refresh(), isActive ? 3000 : 30_000);
    return () => window.clearInterval(id);
  }, [state, isActive, refresh]);

  const c = room.liveClass;
  return (
    <div className="flex flex-col gap-5" data-testid="live-room">
      <Link to="/live" className="tap-target font-medium text-primary hover:underline">
        {t('live.back')}
      </Link>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold sm:text-3xl">
          {pick(c.titleBn, c.titleEn, locale)}
        </h1>
        <LiveStateBadge state={state} />
      </header>
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-3">
          {room.videoId ? (
            <div className="aspect-video w-full overflow-hidden bg-ink">
              <iframe
                title={pick(c.titleBn, c.titleEn, locale)}
                src={`https://www.youtube-nocookie.com/embed/${room.videoId}?rel=0&modestbranding=1&autoplay=1`}
                className="size-full"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
              />
            </div>
          ) : (
            <div
              className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-primary/10 p-6 text-center"
              data-testid="live-waiting"
            >
              <CalendarClock aria-hidden="true" className="size-8 text-primary" />
              <p className="font-semibold">
                {state === 'ended'
                  ? t('live.endedNoRecording')
                  : t('live.startsAt', { at: formatDateTime(c.startsAt) })}
              </p>
            </div>
          )}
          <p className="text-sm text-ink-muted">{pick(c.courseTitleBn, c.courseTitleEn, locale)}</p>
        </div>
        <aside className="flex flex-col gap-3">
          {room.quiz ? (
            <QuizPanel room={room} onAnswer={props.onAnswer} />
          ) : (
            <p className="border border-dashed border-primary/25 bg-background p-4 text-sm text-ink-muted">
              {t('live.quiz.none')}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

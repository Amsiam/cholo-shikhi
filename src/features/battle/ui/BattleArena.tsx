// One battle: the lobby (looking for an opponent, a room code to share, or the count-down to a
// hosted start), play at your own pace with the other players' progress beside you, and the
// scoreboard with every answer once the battle is over. Refreshes every two seconds.
import { Link } from '@tanstack/react-router';
import { Check, Clock, Copy, Flag, Loader2, Medal, Swords } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { StudentQuestion } from '#src/features/assessment/index.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import type { BattleView } from '../server/battle.server.ts';

type Outcome<T> = { ok: true; value: T } | { ok: false; error: { i18nKey: string } };
const LETTERS = { bn: ['ক', 'খ', 'গ', 'ঘ'], en: ['A', 'B', 'C', 'D'] } as const;
const pick = (bn: string | null, en: string | null, locale: string) =>
  (locale === 'bn' ? bn : en) || bn || en || '';

/** Milliseconds until an instant, against the server's clock. */
function useCountdown(until: string | null, serverNow: string): number | null {
  const offset = useRef(new Date(serverNow).getTime() - Date.now());
  const [now, setNow] = useState(() => Date.now() + offset.current);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => window.clearInterval(id);
  }, []);
  return until ? Math.max(0, new Date(until).getTime() - now) : null;
}

function useClockText(ms: number | null): string {
  const { formatInteger } = useI18n();
  if (ms === null) return '';
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const pad = (n: number) => formatInteger(n).padStart(2, formatInteger(0));
  return `${pad(m)}:${pad(s)}`;
}

function Players(props: { view: BattleView; total: number }) {
  const { t, formatInteger } = useI18n();
  return (
    <ul className="flex flex-col gap-2" data-testid="battle-players">
      {props.view.players.map((p, i) => {
        const pct = props.total > 0 ? Math.round((p.answered / props.total) * 100) : 0;
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: players have no public ID; order is stable
            key={i}
            className={`flex flex-col gap-1 px-3 py-2 ${p.isMe ? 'bg-primary/10' : 'bg-background'}`}
          >
            <span className="flex items-center justify-between gap-2 text-sm">
              <span className="font-semibold">{p.isMe ? t('exams.merit.you') : p.name}</span>
              <span className="text-xs text-ink-muted tabular-nums">
                {p.finished
                  ? t('battle.player.done')
                  : t('battle.player.answered', {
                      n: formatInteger(p.answered),
                      total: formatInteger(props.total),
                    })}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10"
            >
              <span
                className={`block h-full rounded-full ${p.finished ? 'bg-pass' : 'bg-primary'}`}
                style={{ width: `${p.finished ? 100 : pct}%` }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Lobby(props: {
  view: BattleView;
  onStart: () => Promise<void>;
  onLeave: () => Promise<void>;
}) {
  const { t, locale, formatInteger } = useI18n();
  const v = props.view;
  const until = v.mode === 'quick' ? v.quickWaitEndsAt : v.mode === 'hosted' ? v.startsAt : null;
  const left = useCountdown(until, v.serverNow);
  const clock = useClockText(left);
  const [copied, setCopied] = useState(false);
  return (
    <section
      className="flex flex-col items-center gap-6 border border-primary/15 bg-background p-6 text-center sm:p-10"
      data-testid="battle-lobby"
    >
      {v.mode === 'quick' ? (
        <>
          <Loader2
            aria-hidden="true"
            className="size-10 animate-spin text-primary motion-reduce:animate-none"
          />
          <h1 className="text-2xl font-extrabold">{t('battle.lobby.searching')}</h1>
          <p className="text-ink/80" aria-live="polite">
            {t('battle.lobby.searchingFor', { time: clock })}
          </p>
        </>
      ) : null}
      {v.mode === 'friend' ? (
        <>
          <h1 className="text-2xl font-extrabold">{t('battle.lobby.room')}</h1>
          {v.code ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-ink-muted">{t('battle.lobby.share')}</p>
              <p
                className="font-mono text-5xl font-extrabold tracking-[0.3em] text-primary"
                data-testid="battle-room-code"
              >
                {v.code}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(v.code ?? '').then(() => setCopied(true));
                }}
              >
                {copied ? (
                  <Check aria-hidden="true" className="size-4" />
                ) : (
                  <Copy aria-hidden="true" className="size-4" />
                )}
                {t(copied ? 'battle.lobby.copied' : 'battle.lobby.copy')}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {v.mode === 'hosted' ? (
        <>
          <h1 className="text-2xl font-extrabold">{pick(v.titleBn, v.titleEn, locale)}</h1>
          <p className="text-ink/80">{t('battle.lobby.startsIn', { time: clock })}</p>
        </>
      ) : null}
      <div className="w-full max-w-md text-left">
        <p className="mb-2 text-sm font-semibold">
          {t('battle.lobby.players', { n: formatInteger(v.players.length) })}
        </p>
        <Players view={v} total={v.questionCount} />
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {v.mode === 'friend' && v.isHost ? (
          <Button
            onClick={() => void props.onStart()}
            disabled={v.players.length < 2}
            data-testid="battle-start"
          >
            <Swords aria-hidden="true" className="size-4" />
            {t('battle.lobby.start')}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => void props.onLeave()} data-testid="battle-leave">
          {t('battle.lobby.leave')}
        </Button>
      </div>
    </section>
  );
}

function Play(props: {
  view: BattleView;
  questions: StudentQuestion[];
  onAnswer: (questionId: string, chosenIndex: number) => Promise<Outcome<unknown>>;
  onFinish: () => Promise<void>;
}) {
  const { t, tDynamic, locale, formatInteger } = useI18n();
  const v = props.view;
  const letters = LETTERS[locale];
  const [answers, setAnswers] = useState<Record<string, number>>(v.myAnswers);
  const [index, setIndex] = useState(() => {
    const i = props.questions.findIndex((q) => v.myAnswers[q.questionId] === undefined);
    return i < 0 ? props.questions.length - 1 : i;
  });
  const [error, setError] = useState<string | null>(null);
  const left = useCountdown(v.endsAt, v.serverNow);
  const clock = useClockText(left);
  const finished = useRef(false);
  const finish = useCallback(async () => {
    if (finished.current) return;
    finished.current = true;
    await props.onFinish();
  }, [props.onFinish]);
  useEffect(() => {
    if (left === 0) void finish();
  }, [left, finish]);

  const q = props.questions[index];
  if (!q) return null;
  const options = locale === 'bn' ? q.optionsBn : q.optionsEn;
  const chosen = answers[q.questionId];
  const answered = Object.keys(answers).length;
  const total = props.questions.length;
  const choose = async (i: number) => {
    setAnswers((a) => ({ ...a, [q.questionId]: i }));
    setError(null);
    const r = await props.onAnswer(q.questionId, i);
    if (!r.ok) {
      setError(r.error.i18nKey);
      if (r.error.i18nKey === 'errors.battle.closed') void finish();
      return;
    }
    // Move on by itself to the next unanswered question.
    const next = props.questions.findIndex(
      (x, j) => j > index && answers[x.questionId] === undefined,
    );
    if (next >= 0) window.setTimeout(() => setIndex(next), 250);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]" data-testid="battle-play">
      <section className="flex flex-col gap-5 border-2 border-primary/40 bg-background p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/20 pb-3">
          <span className="font-semibold text-primary tabular-nums">
            {t('vault.practice.progress', {
              n: formatInteger(index + 1),
              total: formatInteger(total),
            })}
          </span>
          <span
            role="timer"
            className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1 font-bold tabular-nums ${
              (left ?? 0) < 30_000 ? 'bg-omr text-white' : 'bg-ink/5'
            }`}
            data-testid="battle-clock"
          >
            <Clock aria-hidden="true" className="size-4" />
            {clock}
          </span>
        </div>
        <h2 className="text-xl leading-snug font-bold sm:text-2xl">
          {pick(q.promptBn, q.promptEn, locale)}
        </h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t('vault.practice.choose')}</legend>
          {options.map((option, i) => {
            const isChosen = chosen === i;
            return (
              <label
                key={letters[i]}
                className={`flex min-h-12 cursor-pointer items-center gap-3 border px-3 py-2 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 ${
                  isChosen ? 'border-ink bg-ink/5' : 'border-primary/20 hover:border-primary/50'
                }`}
                data-testid="battle-option"
              >
                <input
                  type="radio"
                  name={`battle-${q.questionId}`}
                  className="sr-only"
                  checked={isChosen}
                  onChange={() => void choose(i)}
                />
                <span
                  aria-hidden="true"
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${
                    isChosen ? 'border-ink bg-ink text-ink-foreground' : 'border-omr text-omr'
                  }`}
                >
                  {letters[i]}
                </span>
                <span className="flex-1">{option}</span>
              </label>
            );
          })}
        </fieldset>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {tDynamic(error)}
          </p>
        ) : null}
        <nav aria-label={t('exams.sheet.navigator')} className="flex flex-wrap gap-1.5">
          {props.questions.map((x, i) => (
            <button
              key={x.questionId}
              type="button"
              onClick={() => setIndex(i)}
              aria-current={i === index ? 'step' : undefined}
              aria-label={t(
                answers[x.questionId] !== undefined
                  ? 'exams.sheet.goAnswered'
                  : 'exams.sheet.goOpen',
                {
                  n: formatInteger(i + 1),
                },
              )}
              className={`flex size-11 items-center justify-center rounded-full border-2 text-sm font-bold tabular-nums ${
                answers[x.questionId] !== undefined
                  ? 'border-ink bg-ink text-ink-foreground'
                  : 'border-omr text-omr'
              } ${i === index ? 'ring-2 ring-primary ring-offset-2' : ''}`}
            >
              {formatInteger(i + 1)}
            </button>
          ))}
        </nav>
        <Button onClick={() => void finish()} className="w-fit" data-testid="battle-finish">
          <Flag aria-hidden="true" className="size-4" />
          {t(answered < total ? 'battle.play.finishEarly' : 'battle.play.finish', {
            n: formatInteger(total - answered),
          })}
        </Button>
      </section>
      <aside className="flex h-fit flex-col gap-3 border border-primary/15 bg-paper p-4 lg:sticky lg:top-20">
        <p className="text-sm font-semibold">{t('battle.play.others')}</p>
        <Players view={v} total={total} />
      </aside>
    </div>
  );
}

function Results(props: { view: BattleView }) {
  const { t, locale, formatInteger } = useI18n();
  const v = props.view;
  const letters = LETTERS[locale];
  const me = v.players.find((p) => p.isMe);
  const isWinner = me?.rank === 1;
  return (
    <div className="flex flex-col gap-6" data-testid="battle-results">
      <section className="flex flex-col items-center gap-3 border-2 border-ink bg-background p-6 text-center">
        <Medal aria-hidden="true" className={`size-10 ${isWinner ? 'text-omr' : 'text-primary'}`} />
        <h1 className="text-3xl font-extrabold">
          {me?.rank
            ? t(isWinner ? 'battle.result.won' : 'battle.result.place', {
                rank: formatInteger(me.rank),
              })
            : t('battle.result.over')}
        </h1>
        {me?.correct !== null && me?.correct !== undefined ? (
          <p className="text-ink/80">
            {t('battle.result.score', {
              n: formatInteger(me.correct),
              total: formatInteger(v.questionCount),
            })}
          </p>
        ) : null}
      </section>
      <section aria-labelledby="battle-board" className="flex flex-col gap-3">
        <h2 id="battle-board" className="text-xl font-bold">
          {t('battle.result.board')}
        </h2>
        <ol className="divide-y divide-primary/10 border border-primary/15 bg-background">
          {v.players.map((p, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: ranked order is stable for a finished battle
              key={i}
              className={`flex items-center gap-4 px-4 py-3 ${p.isMe ? 'bg-primary/10 font-semibold' : ''}`}
            >
              <span className="w-8 text-right font-bold tabular-nums">
                {formatInteger(p.rank ?? i + 1)}
              </span>
              <span className="flex-1">{p.isMe ? t('exams.merit.you') : p.name}</span>
              <span className="tabular-nums">
                {t('battle.result.correct', { n: formatInteger(p.correct ?? 0) })}
              </span>
            </li>
          ))}
        </ol>
      </section>
      {v.review.length > 0 ? (
        <section aria-labelledby="battle-review" className="flex flex-col gap-3">
          <h2 id="battle-review" className="text-xl font-bold">
            {t('exams.review.title')}
          </h2>
          <ol className="flex flex-col gap-3">
            {v.review.map((q, n) => {
              const options = locale === 'bn' ? q.optionsBn : q.optionsEn;
              const explanation = locale === 'bn' ? q.explanationBn : q.explanationEn;
              return (
                <li
                  key={q.questionId}
                  className="flex flex-col gap-2 border border-primary/15 bg-background p-4"
                >
                  <p className="font-bold">
                    {formatInteger(n + 1)}. {pick(q.promptBn, q.promptEn, locale)}
                  </p>
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {options.map((o, i) => {
                      const isRight = i === q.correctIndex;
                      const isMine = i === q.chosenIndex;
                      return (
                        <li
                          key={letters[i]}
                          className={`flex items-center gap-2 px-2 py-1 text-sm ${isRight ? 'bg-pass/10 font-semibold' : isMine ? 'bg-omr-soft' : ''}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                              isRight
                                ? 'border-pass bg-pass text-white'
                                : isMine
                                  ? 'border-omr bg-omr text-white'
                                  : 'border-omr/50 text-omr'
                            }`}
                          >
                            {letters[i]}
                          </span>
                          {o}
                          {isMine ? (
                            <span className="sr-only">{t('exams.review.yourAnswer')}</span>
                          ) : null}
                          {isRight ? (
                            <span className="sr-only">{t('exams.review.rightAnswer')}</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  {explanation ? <p className="text-sm text-ink/80">{explanation}</p> : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

export function BattleArena(props: {
  initial: BattleView;
  onRefresh: () => Promise<BattleView | null>;
  onAnswer: (questionId: string, chosenIndex: number) => Promise<Outcome<unknown>>;
  onFinish: () => Promise<void>;
  onStart: () => Promise<Outcome<unknown>>;
  onLeave: () => Promise<void>;
}) {
  const { t, tDynamic } = useI18n();
  const [view, setView] = useState(props.initial);
  const [questions, setQuestions] = useState<StudentQuestion[]>(props.initial.questions);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const next = await props.onRefresh();
    if (!next) return;
    setView(next);
    if (next.questions.length > 0) setQuestions((q) => (q.length > 0 ? q : next.questions));
  }, [props.onRefresh]);

  useEffect(() => {
    if (view.status === 'finished' || view.status === 'cancelled') return;
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [view.status, refresh]);

  const back = (
    <Link to="/battles" className="tap-target font-medium text-primary hover:underline">
      {t('battle.back')}
    </Link>
  );

  let body: ReactNode = null;
  if (view.status === 'cancelled')
    body = (
      <section
        className="flex flex-col items-start gap-3 border border-primary/15 bg-background p-6"
        data-testid="battle-cancelled"
      >
        <h1 className="text-2xl font-extrabold">{t('battle.cancelled.title')}</h1>
        <p className="text-ink/80">
          {t(view.mode === 'quick' ? 'battle.cancelled.quick' : 'battle.cancelled.room')}
        </p>
      </section>
    );
  else if (view.status === 'waiting')
    body = (
      <Lobby
        view={view}
        onStart={async () => {
          const r = await props.onStart();
          if (!r.ok) setError(r.error.i18nKey);
          await refresh();
        }}
        onLeave={props.onLeave}
      />
    );
  else if (view.status === 'running' && !view.myFinished && questions.length > 0)
    body = (
      <Play
        view={view}
        questions={questions}
        onAnswer={props.onAnswer}
        onFinish={async () => {
          await props.onFinish();
          await refresh();
        }}
      />
    );
  else if (view.status === 'running')
    body = (
      <section
        className="flex flex-col items-center gap-4 border border-primary/15 bg-background p-6 text-center"
        data-testid="battle-waiting-others"
      >
        <Loader2
          aria-hidden="true"
          className="size-8 animate-spin text-primary motion-reduce:animate-none"
        />
        <h1 className="text-2xl font-extrabold">{t('battle.wait.title')}</h1>
        <p className="text-ink/80">{t('battle.wait.body')}</p>
        <div className="w-full max-w-md text-left">
          <Players view={view} total={view.questionCount} />
        </div>
      </section>
    );
  else body = <Results view={view} />;

  return (
    <div className="flex flex-col gap-5">
      {back}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(error)}
        </p>
      ) : null}
      {body}
    </div>
  );
}

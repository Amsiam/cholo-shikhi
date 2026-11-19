// Staff: schedule an open battle for a goal's tier and see the ones already scheduled.
import { useForm } from '@tanstack/react-form';
import { CalendarPlus } from 'lucide-react';
import { useState } from 'react';
import type { TaxonomySubject } from '#src/features/assessment/server/bank.server.ts';
import type { GoalGroup } from '#src/features/assessment/ui/ExamBuilder.tsx';
import { TopicSelect } from '#src/features/assessment/ui/QuestionEditor.tsx';
import { DataTable } from '#src/features/platform/ui/DataTable.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import type { BattleSummary } from '../server/battle.server.ts';

type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: { i18nKey: string; fieldErrors?: Record<string, readonly string[]> } };

export function HostBattles(props: {
  battles: BattleSummary[];
  goals: GoalGroup[];
  taxonomy: TaxonomySubject[];
  onSchedule: (input: {
    goalId: string;
    titleBn: string;
    titleEn: string;
    topicId?: string;
    questionCount: number;
    startsAtLocal: string;
  }) => Promise<Outcome<{ battleId: string }>>;
}) {
  const { t, tDynamic, locale, formatInteger, formatDateTime } = useI18n();
  const [errors, setErrors] = useState<Record<string, readonly string[]>>({});
  const [message, setMessage] = useState<{ ok: boolean; key: string } | null>(null);
  const name = (x: { nameBn: string; nameEn: string }) => (locale === 'bn' ? x.nameBn : x.nameEn);
  const err = (k: string) => errors[k]?.map((x) => tDynamic(x)).join(' ');
  const form = useForm({
    defaultValues: {
      goalId: '',
      titleBn: '',
      titleEn: '',
      topicId: '',
      questionCount: 10,
      startsAtLocal: '',
    },
    onSubmit: async ({ value, formApi }) => {
      if (!value.goalId) return setErrors({ goalId: ['errors.exam.goalRequired'] });
      if (!value.startsAtLocal) return setErrors({ startsAtLocal: ['errors.exam.startRequired'] });
      const r = await props.onSchedule({
        goalId: value.goalId,
        titleBn: value.titleBn,
        titleEn: value.titleEn,
        ...(value.topicId ? { topicId: value.topicId } : {}),
        questionCount: value.questionCount,
        startsAtLocal: value.startsAtLocal,
      });
      if (!r.ok) {
        setErrors(r.error.fieldErrors ?? {});
        setMessage(r.error.fieldErrors ? null : { ok: false, key: r.error.i18nKey });
        return;
      }
      setErrors({});
      setMessage({ ok: true, key: 'battle.host.scheduled' });
      formApi.reset();
    },
  });
  const field = (id: string, label: string, input: React.ReactNode, error?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {input}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
  return (
    <div className="flex flex-col gap-6" data-testid="battle-host-page">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {t('battle.host.title')}
        </h1>
        <p className="text-ink/75">{t('battle.host.subtitle')}</p>
      </header>
      <form
        noValidate
        className="grid gap-4 border border-primary/15 bg-background p-5 sm:grid-cols-2 sm:p-7"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <h2 className="flex items-center gap-2 text-lg font-bold sm:col-span-2">
          <CalendarPlus aria-hidden="true" className="size-5 text-primary" />
          {t('battle.host.new')}
        </h2>
        <form.Field name="titleBn">
          {(f) =>
            field(
              'host-tbn',
              t('examBuilder.titleBn'),
              <Input
                id="host-tbn"
                lang="bn"
                maxLength={150}
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
              />,
              err('titleBn'),
            )
          }
        </form.Field>
        <form.Field name="titleEn">
          {(f) =>
            field(
              'host-ten',
              t('examBuilder.titleEn'),
              <Input
                id="host-ten"
                maxLength={150}
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
              />,
              err('titleEn'),
            )
          }
        </form.Field>
        <form.Field name="goalId">
          {(f) =>
            field(
              'host-goal',
              t('examBuilder.goal'),
              <NativeSelect
                id="host-goal"
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
              >
                <option value="">{t('examBuilder.goalPick')}</option>
                {props.goals.map((g) => (
                  <optgroup key={g.nameEn} label={name(g)}>
                    {g.goals.map((x) => (
                      <option key={x.goalId} value={x.goalId}>
                        {name(x)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>,
              err('goalId'),
            )
          }
        </form.Field>
        <form.Field name="topicId">
          {(f) =>
            field(
              'host-topic',
              t('bank.field.topic'),
              <TopicSelect
                id="host-topic"
                taxonomy={props.taxonomy}
                value={f.state.value}
                onChange={f.handleChange}
                emptyLabel={t('battle.anyTopic')}
              />,
            )
          }
        </form.Field>
        <form.Field name="questionCount">
          {(f) =>
            field(
              'host-count',
              t('exams.custom.count'),
              <NativeSelect
                id="host-count"
                value={f.state.value}
                onChange={(e) => f.handleChange(Number(e.target.value))}
              >
                {[5, 10, 20, 30].map((n) => (
                  <option key={n} value={n}>
                    {formatInteger(n)}
                  </option>
                ))}
              </NativeSelect>,
              err('questionCount'),
            )
          }
        </form.Field>
        <form.Field name="startsAtLocal">
          {(f) =>
            field(
              'host-start',
              t('examBuilder.startsAt'),
              <Input
                id="host-start"
                type="datetime-local"
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
              />,
              err('startsAtLocal'),
            )
          }
        </form.Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" data-testid="battle-host-schedule">
            {t('battle.host.schedule')}
          </Button>
          {message ? (
            <p
              role={message.ok ? 'status' : 'alert'}
              className={`text-sm font-semibold ${message.ok ? 'text-pass' : 'text-destructive'}`}
            >
              {tDynamic(message.key)}
            </p>
          ) : null}
        </div>
      </form>
      <DataTable
        testId="battle-host-table"
        caption={t('battle.host.title')}
        rows={props.battles}
        rowId={(b) => b.battleId}
        emptyText={t('battle.host.empty')}
        display={[
          {
            id: 'title',
            header: t('examBuilder.col.exam'),
            cell: (b) => (
              <span className="font-semibold">
                {(locale === 'bn' ? b.titleBn : b.titleEn) ?? ''}
              </span>
            ),
          },
          {
            id: 'start',
            header: t('examBuilder.startsAt'),
            cell: (b) => (b.startsAt ? formatDateTime(b.startsAt) : ''),
          },
          {
            id: 'status',
            header: t('insights.col.status'),
            cell: (b) => t(`battle.status.${b.status}`),
          },
          {
            id: 'players',
            header: t('battle.host.players'),
            isNumeric: true,
            cell: (b) => formatInteger(b.players),
          },
        ]}
      />
    </div>
  );
}

// I1 builder part 2: the course description, the publish dialog, and the unpublish and retire
// confirmations (US3.8, US3.0; BR9.1–BR9.5, BR4.3; SD-212; NFR7.201). The panel shows what the
// server's readiness read found (missing fields, blocking sections, lessons without captions, blocked
// links) and asks for the caption confirmation before it lets the Lead publish. Every list item is
// named by its title; the server re-checks everything under its row locks.
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { z } from 'zod';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, firstErrors, type SaveOutcome } from './fields.tsx';

export type Readiness = {
  status: 'draft' | 'published' | 'unpublished' | 'hidden' | 'retired';
  missingFields: string[];
  sections: Array<{
    sectionId: string;
    reviewState: string | null;
    willPublish: boolean;
    isBlocking: boolean;
  }>;
  missingCaptionLessonIds: string[];
  blockedLinkLessonIds: string[];
  lessons: Array<{
    lessonId: string;
    sectionId: string;
    titleBn: string | null;
    titleEn: string | null;
  }>;
  refusalKey: string | null;
};

export type PublishPanelProps = {
  readiness: Readiness;
  canManage: boolean;
  sectionTitles: Record<string, { titleBn: string; titleEn: string }>;
  description: { descriptionBn: string | null; descriptionEn: string | null };
  onSaveDescription: (input: {
    descriptionBn: string;
    descriptionEn: string;
  }) => Promise<SaveOutcome>;
  onPublish: (acknowledgedMissingCaptions: string[]) => Promise<SaveOutcome>;
  onUnpublish: () => Promise<SaveOutcome>;
  onRetire: () => Promise<SaveOutcome>;
};

const Description = z.object({
  descriptionBn: z.string().max(5000),
  descriptionEn: z.string().max(5000),
});

/** Lists each lesson behind a blocked-link field error (sections.<s>.lessons.<l>.body<Lang>.links.<n>). */
export function blockedLinkLessons(outcome: SaveOutcome): string[] {
  const ids = Object.keys(outcome?.fieldErrors ?? {})
    .map((key) => /^sections\.[^.]+\.lessons\.([^.]+)\./.exec(key)?.[1])
    .filter((id): id is string => id !== undefined);
  return [...new Set(ids)];
}

function DescriptionForm(props: Pick<PublishPanelProps, 'description' | 'onSaveDescription'>) {
  const { t, tDynamic } = useI18n();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const form = useForm({
    defaultValues: {
      descriptionBn: props.description.descriptionBn ?? '',
      descriptionEn: props.description.descriptionEn ?? '',
    },
    onSubmit: async ({ value }) => {
      setSaved(false);
      const local = firstErrors(Description, value);
      setErrors(local);
      if (Object.keys(local).length > 0) return;
      const outcome = await props.onSaveDescription(value);
      setErrors(
        outcome
          ? firstErrors(Description, value, outcome.fieldErrors ?? { _form: [outcome.i18nKey] })
          : {},
      );
      setSaved(outcome === null);
    },
  });
  const field = (name: 'descriptionBn' | 'descriptionEn', lang: 'bn' | 'en') => (
    <form.Field name={name}>
      {(f) => (
        <div className="grid gap-1.5">
          <label htmlFor={`course-${name}`} className="text-sm font-medium">
            {t(`catalog.instructor.description.${lang}`)}
          </label>
          <textarea
            id={`course-${name}`}
            lang={lang}
            className="min-h-24 rounded-sm border border-primary/20 bg-background p-2"
            value={f.state.value}
            onChange={(event) => f.handleChange(event.target.value)}
            aria-invalid={errors[name] ? true : undefined}
            aria-describedby={errors[name] ? `course-${name}-error` : undefined}
            data-testid={`course-description-${lang}`}
          />
          {errors[name] ? (
            <p id={`course-${name}-error`} role="alert" className="text-sm text-destructive">
              {tDynamic(errors[name] as string)}
            </p>
          ) : null}
        </div>
      )}
    </form.Field>
  );
  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      data-testid="course-description-form"
    >
      <h2 className="text-lg font-semibold">{t('catalog.instructor.description.heading')}</h2>
      <p className="text-sm text-muted-foreground">{t('catalog.instructor.description.hint')}</p>
      {field('descriptionBn', 'bn')}
      {field('descriptionEn', 'en')}
      {errors._form ? (
        <p role="alert" className="text-sm text-destructive">
          {tDynamic(errors._form)}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm" data-testid="course-description-saved">
          {t('catalog.instructor.description.saved')}
        </p>
      ) : null}
      <Button
        type="submit"
        className="w-fit justify-self-start"
        data-testid="course-description-save"
      >
        {t('catalog.instructor.description.save')}
      </Button>
    </form>
  );
}

export function PublishPanel(props: PublishPanelProps) {
  const { t, tDynamic, locale } = useI18n();
  const { readiness } = props;
  const [isAcknowledged, setIsAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState<'publish' | 'unpublish' | 'retire' | null>(null);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [blockedAfterPublish, setBlockedAfterPublish] = useState<string[]>([]);

  const titleOf = (item: { titleBn: string | null; titleEn: string | null }) =>
    (locale === 'bn' ? item.titleBn : item.titleEn) || item.titleBn || item.titleEn || '';
  const lessonTitle = (lessonId: string) => {
    const lesson = readiness.lessons.find((l) => l.lessonId === lessonId);
    return lesson ? titleOf(lesson) : lessonId;
  };
  const sectionTitle = (sectionId: string) => {
    const s = props.sectionTitles[sectionId];
    return s ? titleOf(s) : sectionId;
  };
  const needsCaptionConfirmation = readiness.missingCaptionLessonIds.length > 0;
  const canPublish =
    props.canManage &&
    readiness.refusalKey === null &&
    (!needsCaptionConfirmation || isAcknowledged);
  const blockedIds = [...new Set([...readiness.blockedLinkLessonIds, ...blockedAfterPublish])];

  async function run() {
    const action = confirming;
    setConfirming(null);
    if (!action) return;
    const outcome =
      action === 'publish'
        ? await props.onPublish(isAcknowledged ? readiness.missingCaptionLessonIds : [])
        : action === 'unpublish'
          ? await props.onUnpublish()
          : await props.onRetire();
    setBlockedAfterPublish(blockedLinkLessons(outcome));
    setMessage(
      outcome
        ? {
            text:
              blockedLinkLessons(outcome).length > 0
                ? t('errors.catalog.blockedLink')
                : tDynamic(outcome.i18nKey),
            isError: true,
          }
        : { text: t(`catalog.instructor.publish.done.${action}`), isError: false },
    );
  }

  const isLive = readiness.status === 'published' || readiness.status === 'unpublished';
  return (
    <section
      className="grid gap-6 rounded-sm border border-primary/20 bg-background p-4"
      data-testid="publish-panel"
    >
      {props.canManage ? (
        <DescriptionForm
          description={props.description}
          onSaveDescription={props.onSaveDescription}
        />
      ) : null}
      <div className="grid gap-3">
        <h2 className="text-lg font-semibold">{t('catalog.instructor.publish.heading')}</h2>
        {readiness.missingFields.length > 0 ? (
          <div role="alert" data-testid="publish-panel-missing">
            <p>{t('errors.catalog.publishPreconditions')}</p>
            <ul className="list-disc ps-6">
              {readiness.missingFields.map((field) => (
                <li key={field}>{tDynamic(`catalog.instructor.publish.missing.${field}`)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <ul className="grid gap-1" data-testid="publish-panel-sections">
          {readiness.sections.map((s) => (
            <li
              key={s.sectionId}
              className="flex flex-wrap items-center gap-2"
              data-testid="publish-panel-section"
            >
              <span>{sectionTitle(s.sectionId)}</span>
              <Badge variant={s.isBlocking ? 'destructive' : s.willPublish ? 'default' : 'outline'}>
                {t(
                  s.isBlocking
                    ? 'catalog.instructor.publish.blocking'
                    : s.willPublish
                      ? 'catalog.instructor.publish.willPublish'
                      : 'catalog.instructor.publish.unchanged',
                )}
              </Badge>
            </li>
          ))}
        </ul>
        {blockedIds.length > 0 ? (
          <div role="alert" data-testid="publish-panel-blocked-links">
            <p>{t('errors.catalog.blockedLink')}</p>
            <ul className="list-disc ps-6">
              {blockedIds.map((id) => (
                <li key={id}>{lessonTitle(id)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {needsCaptionConfirmation ? (
          <div
            className="grid gap-2 border border-omr/50 bg-omr-soft p-3"
            data-testid="publish-panel-captions"
          >
            <p>{t('catalog.instructor.publish.captionsWarning')}</p>
            <ul className="list-disc ps-6">
              {readiness.missingCaptionLessonIds.map((id) => (
                <li key={id}>{lessonTitle(id)}</li>
              ))}
            </ul>
            <label className="flex min-h-10 items-center gap-2">
              <input
                type="checkbox"
                checked={isAcknowledged}
                onChange={(event) => setIsAcknowledged(event.target.checked)}
                data-testid="publish-panel-captions-confirm"
              />
              {t('catalog.instructor.publish.captionsConfirm')}
            </label>
          </div>
        ) : null}
        {readiness.refusalKey && readiness.missingFields.length === 0 && blockedIds.length === 0 ? (
          <p role="alert" className="text-sm text-destructive" data-testid="publish-panel-refusal">
            {tDynamic(readiness.refusalKey)}
          </p>
        ) : null}
        {props.canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="w-fit justify-self-start"
              disabled={!canPublish}
              onClick={() => setConfirming('publish')}
              data-testid="publish-panel-publish"
            >
              {t(
                readiness.status === 'draft'
                  ? 'catalog.instructor.publish.publish'
                  : 'catalog.instructor.publish.republish',
              )}
            </Button>
            {readiness.status === 'published' ? (
              <Button
                type="button"
                variant="outline"
                className="w-fit justify-self-start"
                onClick={() => setConfirming('unpublish')}
                data-testid="publish-panel-unpublish"
              >
                {t('catalog.instructor.publish.unpublish')}
              </Button>
            ) : null}
            {isLive ? (
              <Button
                type="button"
                variant="outline"
                className="w-fit justify-self-start"
                onClick={() => setConfirming('retire')}
                data-testid="publish-panel-retire"
              >
                {t('catalog.instructor.publish.retire')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {message ? (
          <p
            role={message.isError ? 'alert' : 'status'}
            className={message.isError ? 'text-sm text-destructive' : 'text-sm'}
            data-testid="publish-panel-message"
          >
            {message.text}
          </p>
        ) : null}
      </div>
      <ConfirmDialog
        isOpen={confirming !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirming(null);
        }}
        title={t(`catalog.instructor.publish.confirm.${confirming ?? 'publish'}.title`)}
        description={t(`catalog.instructor.publish.confirm.${confirming ?? 'publish'}.body`)}
        confirmLabel={t(`catalog.instructor.publish.${confirming ?? 'publish'}`)}
        onConfirm={() => void run()}
        testId="publish-panel-confirm"
      />
    </section>
  );
}

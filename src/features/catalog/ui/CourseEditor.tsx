// I1 course builder, part 1 (US3.1–US3.5): the price field (Latin or Bangla digits, previewed and
// shown only through formatMoney, BR5.1, BR5.8), the access duration (read-only with its lock date
// once locked, BR5.7), and the section list with add, reorder, remove, cancel removal and
// Co-instructor assignment. Lead-only controls are not rendered for a Co-instructor (BR6.9); the
// server refuses them anyway. A section title is editable only where `canEdit` (BR6.8).
import { ArrowDown, ArrowUp, ChevronDown, Plus, Settings2, Trash2, Undo2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { formatMoney, type MoneyPoisha } from '#src/lib/money.ts';
import { formatDateTime } from '#src/lib/time.ts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { validateTitles } from '../domain/course.ts';
import { ACCESS_DURATIONS, parseTakaToPoisha } from '../domain/pricing.ts';
import { ChoiceField, FieldError, localTitle, type SaveOutcome, TextField } from './fields.tsx';

export type EditorSection = {
  sectionId: string;
  position: number;
  structureState: 'active' | 'removal_pending' | 'removed';
  titleBn: string;
  titleEn: string;
  ownerId: string | null;
  ownershipVersion: number | null;
  workingVersion: number | null;
  isLive: boolean;
  canEdit: boolean;
};

export type EditorCourse = {
  courseId: string;
  titleBn: string;
  titleEn: string;
  status: 'draft' | 'published' | 'unpublished' | 'hidden' | 'retired';
  leadInstructorId: string | null;
  listPricePoisha: number | null;
  accessDurationMonths: number | null;
  durationLockedAt: string | null;
  version: number;
};

export type CourseEditorActions = {
  onSetPrice(price: string): Promise<SaveOutcome>;
  onSetDuration(months: number): Promise<SaveOutcome>;
  onAddSection(titles: { titleBn: string; titleEn: string }): Promise<SaveOutcome>;
  onReorder(sectionIds: string[]): Promise<SaveOutcome>;
  onRemoveSection(sectionId: string): Promise<SaveOutcome>;
  onCancelRemoval(sectionId: string): Promise<SaveOutcome>;
  onAssign(section: EditorSection, assigneeId: string): Promise<SaveOutcome>;
  onEditTitle(
    section: EditorSection,
    titles: { titleBn: string; titleEn: string },
  ): Promise<SaveOutcome>;
};

export type CourseEditorProps = {
  course: EditorCourse;
  role: 'lead' | 'co_instructor' | 'admin';
  canManageCourse: boolean;
  viewerId: string;
  sections: EditorSection[];
  /** Part 2: the route supplies a link to each section's lessons and review. */
  renderSectionLink?: (section: EditorSection) => ReactNode;
} & CourseEditorActions;

/** Shows an outcome's first field error or its form-level key. */
function outcomeError(outcome: SaveOutcome, field: string): string | undefined {
  if (!outcome) return undefined;
  return outcome.fieldErrors?.[field]?.[0] ?? outcome.i18nKey;
}

function PriceField(props: { current: number | null; onSave: CourseEditorActions['onSetPrice'] }) {
  const { t, locale } = useI18n();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();
  const parsed = value.trim() === '' ? undefined : parseTakaToPoisha(value);
  const hint =
    parsed?.ok === true
      ? t('catalog.instructor.price.preview', { amount: formatMoney(parsed.value, locale) })
      : undefined;
  return (
    <form
      noValidate
      className="grid gap-2"
      data-testid="course-editor-price-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const local = parseTakaToPoisha(value);
        if (!local.ok) {
          setError(local.error.fieldErrors?.price?.[0]);
          return;
        }
        setError(outcomeError(await props.onSave(value), 'price'));
      }}
    >
      <p data-testid="course-editor-price-current">
        {t('catalog.instructor.price.current', {
          amount:
            props.current === null
              ? t('catalog.instructor.notSet')
              : formatMoney(props.current as MoneyPoisha, locale),
        })}
      </p>
      <TextField
        label={t('catalog.instructor.price.label')}
        inputMode="decimal"
        value={value}
        onChange={(next) => {
          setValue(next);
          setError(undefined);
        }}
        error={error}
        testId="course-editor-price-input"
        {...(hint ? { hint } : {})}
      />
      <Button
        type="submit"
        className="w-fit justify-self-start"
        data-testid="course-editor-price-submit"
      >
        {t('catalog.instructor.price.save')}
      </Button>
    </form>
  );
}

function DurationField(props: {
  course: EditorCourse;
  canManage: boolean;
  onSave: CourseEditorActions['onSetDuration'];
}) {
  const { t, locale } = useI18n();
  const [months, setMonths] = useState(String(props.course.accessDurationMonths ?? ''));
  const [error, setError] = useState<string | undefined>();
  const current =
    props.course.accessDurationMonths === null
      ? t('catalog.instructor.notSet')
      : t('catalog.instructor.duration.months', { months: props.course.accessDurationMonths });
  if (props.course.durationLockedAt !== null) {
    return (
      <p data-testid="course-editor-duration-locked">
        {t('catalog.instructor.duration.locked', {
          duration: current,
          date: formatDateTime(props.course.durationLockedAt, locale),
        })}
      </p>
    );
  }
  if (!props.canManage) {
    return <p data-testid="course-editor-duration-readonly">{current}</p>;
  }
  return (
    <form
      noValidate
      className="grid gap-2"
      data-testid="course-editor-duration-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(outcomeError(await props.onSave(Number(months)), 'months'));
      }}
    >
      <ChoiceField
        legend={t('catalog.instructor.duration.label')}
        value={months}
        onChange={setMonths}
        options={ACCESS_DURATIONS.map((m) => ({
          value: String(m),
          label: t('catalog.instructor.duration.months', { months: m }),
        }))}
        error={error}
        testId="course-editor-duration"
      />
      <Button
        type="submit"
        className="w-fit justify-self-start"
        data-testid="course-editor-duration-submit"
      >
        {t('catalog.instructor.duration.save')}
      </Button>
    </form>
  );
}

function TitleForm(props: {
  testId: string;
  submitLabel: string;
  initial: { titleBn: string; titleEn: string };
  onSave: (titles: { titleBn: string; titleEn: string }) => Promise<SaveOutcome>;
}) {
  const { t } = useI18n();
  const [titles, setTitles] = useState(props.initial);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  return (
    <form
      noValidate
      className="grid gap-2 sm:grid-cols-2"
      data-testid={props.testId}
      onSubmit={async (event) => {
        event.preventDefault();
        const valid = validateTitles(titles);
        if (!valid.ok) {
          setErrors({
            titleBn: valid.error.fieldErrors?.titleBn?.[0],
            titleEn: valid.error.fieldErrors?.titleEn?.[0],
          });
          return;
        }
        const outcome = await props.onSave(titles);
        setErrors(
          outcome
            ? {
                titleBn: outcomeError(outcome, 'titleBn'),
                titleEn: outcome.fieldErrors?.titleEn?.[0],
              }
            : {},
        );
      }}
    >
      <TextField
        label={t('catalog.instructor.field.titleBn')}
        lang="bn"
        value={titles.titleBn}
        onChange={(titleBn) => setTitles({ ...titles, titleBn })}
        error={errors.titleBn}
        testId={`${props.testId}-title-bn`}
      />
      <TextField
        label={t('catalog.instructor.field.titleEn')}
        lang="en"
        value={titles.titleEn}
        onChange={(titleEn) => setTitles({ ...titles, titleEn })}
        error={errors.titleEn}
        testId={`${props.testId}-title-en`}
      />
      <Button
        type="submit"
        className="w-fit justify-self-start sm:col-span-2"
        data-testid={`${props.testId}-submit`}
      >
        {props.submitLabel}
      </Button>
    </form>
  );
}

function AssignForm(props: { section: EditorSection; onAssign: CourseEditorActions['onAssign'] }) {
  const { t } = useI18n();
  const [assigneeId, setAssigneeId] = useState('');
  const [error, setError] = useState<string | undefined>();
  return (
    <form
      noValidate
      className="grid max-w-md gap-2"
      data-testid="section-row-assign-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(
          outcomeError(await props.onAssign(props.section, assigneeId.trim()), 'assigneeId'),
        );
      }}
    >
      <TextField
        label={t('catalog.instructor.sections.assignee')}
        value={assigneeId}
        onChange={setAssigneeId}
        error={error}
        testId="section-row-assignee"
      />
      <Button
        type="submit"
        variant="outline"
        className="w-fit justify-self-start"
        data-testid="section-row-assign-submit"
      >
        {t('catalog.instructor.sections.assign')}
      </Button>
    </form>
  );
}

const pill = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold';
const iconButton =
  'inline-flex size-11 items-center justify-center rounded-sm sm:size-9 border border-primary/20 bg-background text-ink/70 transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

export function statusTone(status: EditorCourse['status']): string {
  if (status === 'published') return 'bg-pass/15 text-pass';
  if (status === 'hidden' || status === 'retired') return 'bg-omr-soft text-omr';
  return 'bg-ink/10 text-ink/70';
}

function SectionRow(props: {
  section: EditorSection;
  index: number;
  count: number;
  canManage: boolean;
  viewerId: string;
  leadId: string | null;
  actions: CourseEditorActions;
  onMove: (from: number, to: number) => void;
  renderLink?: ((section: EditorSection) => ReactNode) | undefined;
}) {
  const { t, locale, formatInteger } = useI18n();
  const [error, setError] = useState<string | undefined>();
  const { section } = props;
  const isMine = section.ownerId !== null && section.ownerId === props.viewerId;
  const owner =
    section.ownerId === null
      ? t('catalog.instructor.sections.noOwner')
      : isMine
        ? t('catalog.instructor.sections.ownerYou')
        : section.ownerId === props.leadId
          ? t('catalog.instructor.role.lead')
          : t('catalog.instructor.role.co');
  const run = async (action: () => Promise<SaveOutcome>) =>
    setError(outcomeError(await action(), '_form'));
  const isPending = section.structureState === 'removal_pending';
  const hasDetails = section.canEdit || (props.canManage && section.structureState === 'active');
  return (
    <li
      className={`grid gap-3 border bg-background p-4 sm:p-5 ${isPending ? 'border-omr/40 border-dashed' : 'border-primary/20'}`}
      data-testid="section-row"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-primary font-bold text-primary tabular-nums"
        >
          {formatInteger(props.index + 1)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-lg font-semibold break-words" data-testid="section-row-title">
            {localTitle(section, locale)}
          </span>
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <span
              className={`${pill} ${isMine ? 'bg-primary/10 text-primary' : 'bg-ink/10 text-ink/70'}`}
              data-testid="section-row-owner"
            >
              {owner}
            </span>
            <span
              className={`${pill} ${section.isLive ? 'bg-pass/15 text-pass' : 'bg-ink/10 text-ink-muted'}`}
            >
              {t(
                section.isLive
                  ? 'catalog.instructor.sections.live'
                  : 'catalog.instructor.sections.notLive',
              )}
            </span>
            {section.workingVersion !== null && section.isLive ? (
              <span className={`${pill} border border-primary/40 text-primary`}>
                {t('catalog.instructor.sections.hasChanges')}
              </span>
            ) : null}
            {isPending ? (
              <Badge className="bg-omr text-white" data-testid="section-row-pending-removal">
                {t('catalog.instructor.sections.pendingRemoval')}
              </Badge>
            ) : null}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {props.renderLink?.(section)}
          {props.canManage ? (
            <div className="flex items-center gap-1.5" data-testid="section-row-lead-controls">
              <button
                type="button"
                className={iconButton}
                disabled={props.index === 0}
                aria-label={t('catalog.instructor.sections.moveUp')}
                title={t('catalog.instructor.sections.moveUp')}
                data-testid="section-row-move-up"
                onClick={() => props.onMove(props.index, props.index - 1)}
              >
                <ArrowUp aria-hidden="true" className="size-4" />
              </button>
              <button
                type="button"
                className={iconButton}
                disabled={props.index === props.count - 1}
                aria-label={t('catalog.instructor.sections.moveDown')}
                title={t('catalog.instructor.sections.moveDown')}
                data-testid="section-row-move-down"
                onClick={() => props.onMove(props.index, props.index + 1)}
              >
                <ArrowDown aria-hidden="true" className="size-4" />
              </button>
              {isPending ? (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="section-row-cancel-removal"
                  onClick={() => run(() => props.actions.onCancelRemoval(section.sectionId))}
                >
                  <Undo2 aria-hidden="true" className="size-4" />
                  {t('catalog.instructor.sections.cancelRemoval')}
                </Button>
              ) : (
                <button
                  type="button"
                  className={`${iconButton} hover:border-omr hover:text-omr`}
                  aria-label={t('catalog.instructor.sections.remove')}
                  title={t('catalog.instructor.sections.remove')}
                  data-testid="section-row-remove"
                  onClick={() => run(() => props.actions.onRemoveSection(section.sectionId))}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
      {hasDetails ? (
        <details className="group border-t border-primary/10 pt-3">
          <summary className="flex min-h-9 w-fit cursor-pointer list-none items-center gap-2 text-sm font-semibold text-primary [&::-webkit-details-marker]:hidden">
            <Settings2 aria-hidden="true" className="size-4" />
            {t('catalog.instructor.sections.settings')}
            <ChevronDown
              aria-hidden="true"
              className="size-4 transition-transform group-open:rotate-180"
            />
          </summary>
          <div className="mt-3 grid gap-4">
            {section.canEdit ? (
              <TitleForm
                testId="section-row-edit"
                submitLabel={t('catalog.instructor.sections.saveTitle')}
                initial={{ titleBn: section.titleBn, titleEn: section.titleEn }}
                onSave={(titles) => props.actions.onEditTitle(section, titles)}
              />
            ) : null}
            {props.canManage && section.structureState === 'active' ? (
              <AssignForm section={section} onAssign={props.actions.onAssign} />
            ) : null}
          </div>
        </details>
      ) : null}
      <FieldError id={`${section.sectionId}-error`} error={error} testId="section-row-error" />
    </li>
  );
}

type BuilderTab = 'curriculum' | 'pricing' | 'publish' | 'packs';

export function CourseEditor(
  props: CourseEditorProps & {
    /** Rendered in the header, e.g. a breadcrumb back to the course list. */
    backLink?: ReactNode;
    /** Rendered in the header's actions, e.g. "View course page". */
    headerActions?: ReactNode;
    /** The Publish tab's content (readiness, description, publish actions). */
    publishPanel?: ReactNode;
    /** The Practice packs tab's content (Lead only). */
    packsPanel?: ReactNode;
  },
) {
  const { t, tDynamic, locale, formatInteger } = useI18n();
  const [listError, setListError] = useState<string | undefined>();
  const [tab, setTab] = useState<BuilderTab>('curriculum');
  const canManage = props.canManageCourse;
  async function move(from: number, to: number) {
    const ids = props.sections.map((s) => s.sectionId);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved as string);
    const outcome = await props.onReorder(ids);
    setListError(outcome ? outcome.i18nKey : undefined);
  }
  const activeSections = props.sections.filter((s) => s.structureState !== 'removed');
  const priceText =
    props.course.listPricePoisha === null
      ? t('catalog.instructor.notSet')
      : formatMoney(props.course.listPricePoisha as MoneyPoisha, locale);
  const durationText =
    props.course.accessDurationMonths === null
      ? t('catalog.instructor.notSet')
      : t('catalog.instructor.duration.months', {
          months: formatInteger(props.course.accessDurationMonths),
        });
  const tabs: Array<{ id: BuilderTab; label: string; show: boolean }> = [
    { id: 'curriculum', label: t('catalog.instructor.tabs.curriculum'), show: true },
    { id: 'pricing', label: t('catalog.instructor.tabs.pricing'), show: true },
    {
      id: 'publish',
      label: t('catalog.instructor.tabs.publish'),
      show: props.publishPanel !== undefined,
    },
    {
      id: 'packs',
      label: t('catalog.instructor.tabs.packs'),
      show: props.packsPanel !== undefined,
    },
  ];
  const panel = 'flex flex-col gap-4';
  return (
    <section className="flex flex-col bg-paper text-ink" data-testid="course-editor">
      <header className="border-b border-primary/15 bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-6 sm:px-6">
          {props.backLink}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-2">
              <h1
                className="text-3xl leading-tight font-extrabold tracking-tight text-balance break-words sm:text-4xl"
                data-testid="course-editor-title"
              >
                {localTitle(props.course, locale)}
              </h1>
              <p className="flex flex-wrap items-center gap-2" data-testid="course-editor-status">
                <span className={`${pill} ${statusTone(props.course.status)}`}>
                  {t(`catalog.instructor.status.${props.course.status}`)}
                </span>
                <span className={`${pill} bg-primary/10 text-primary`}>
                  {props.role === 'co_instructor'
                    ? t('catalog.instructor.role.co')
                    : t('catalog.instructor.role.lead')}
                </span>
              </p>
            </div>
            {props.headerActions ? (
              <div className="flex flex-wrap gap-2">{props.headerActions}</div>
            ) : null}
          </div>
          <dl className="grid grid-cols-2 gap-px overflow-hidden border border-primary/15 bg-primary/15 sm:grid-cols-3">
            {[
              [t('catalog.instructor.sections.title'), formatInteger(activeSections.length)],
              [t('catalog.instructor.price.heading'), priceText],
              [t('catalog.instructor.duration.heading'), durationText],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5 bg-background px-4 py-3">
                <dt className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                  {label}
                </dt>
                <dd className="text-lg font-bold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <div
            role="tablist"
            aria-label={t('catalog.instructor.tabs.label')}
            className="-mb-px flex flex-wrap gap-1"
          >
            {tabs
              .filter((x) => x.show)
              .map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  id={`builder-tab-${x.id}`}
                  aria-selected={tab === x.id}
                  aria-controls={`builder-panel-${x.id}`}
                  onClick={() => setTab(x.id)}
                  className={`min-h-11 border-b-2 px-4 text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 ${
                    tab === x.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-ink/70 hover:text-primary'
                  }`}
                  data-testid={`course-editor-tab-${x.id}`}
                >
                  {x.label}
                </button>
              ))}
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <div
          role="tabpanel"
          id="builder-panel-curriculum"
          aria-labelledby="builder-tab-curriculum"
          hidden={tab !== 'curriculum'}
          className={panel}
        >
          <section className="flex flex-col gap-4" aria-labelledby="course-editor-sections-heading">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 id="course-editor-sections-heading" className="text-2xl font-bold">
                {t('catalog.instructor.sections.title')}
              </h2>
              <p className="text-sm text-ink-muted">{t('catalog.instructor.sections.hint')}</p>
            </div>
            {props.sections.length === 0 ? (
              <p
                className="border border-dashed border-primary/40 bg-background p-6"
                data-testid="course-editor-sections-empty"
              >
                {t('catalog.instructor.sections.empty')}
              </p>
            ) : (
              <ol className="flex flex-col gap-3" data-testid="course-editor-sections">
                {props.sections.map((section, index) => (
                  <SectionRow
                    key={section.sectionId}
                    section={section}
                    index={index}
                    count={props.sections.length}
                    canManage={canManage}
                    viewerId={props.viewerId}
                    leadId={props.course.leadInstructorId}
                    actions={props}
                    onMove={move}
                    renderLink={props.renderSectionLink}
                  />
                ))}
              </ol>
            )}
            {listError ? (
              <p
                role="alert"
                className="text-sm text-destructive"
                data-testid="course-editor-sections-error"
              >
                {tDynamic(listError)}
              </p>
            ) : null}
            {canManage ? (
              <div className="flex flex-col gap-3 border border-dashed border-primary/40 bg-background p-5">
                <h3 className="flex items-center gap-2 font-semibold">
                  <Plus aria-hidden="true" className="size-4 text-primary" />
                  {t('catalog.instructor.sections.addHeading')}
                </h3>
                <TitleForm
                  testId="course-editor-add-section"
                  submitLabel={t('catalog.instructor.sections.add')}
                  initial={{ titleBn: '', titleEn: '' }}
                  onSave={props.onAddSection}
                />
              </div>
            ) : null}
          </section>
        </div>

        <div
          role="tabpanel"
          id="builder-panel-pricing"
          aria-labelledby="builder-tab-pricing"
          hidden={tab !== 'pricing'}
          className="grid gap-5 md:grid-cols-2"
        >
          <section
            className="flex flex-col gap-3 border border-primary/20 bg-background p-5"
            aria-labelledby="course-editor-price-heading"
          >
            <h2 id="course-editor-price-heading" className="text-lg font-bold">
              {t('catalog.instructor.price.heading')}
            </h2>
            {canManage ? (
              <PriceField current={props.course.listPricePoisha} onSave={props.onSetPrice} />
            ) : (
              <p data-testid="course-editor-price-current">{priceText}</p>
            )}
          </section>
          <section
            className="flex flex-col gap-3 border border-primary/20 bg-background p-5"
            aria-labelledby="course-editor-duration-heading"
          >
            <h2 id="course-editor-duration-heading" className="text-lg font-bold">
              {t('catalog.instructor.duration.heading')}
            </h2>
            <DurationField
              course={props.course}
              canManage={canManage}
              onSave={props.onSetDuration}
            />
          </section>
        </div>

        {props.publishPanel !== undefined ? (
          <div
            role="tabpanel"
            id="builder-panel-publish"
            aria-labelledby="builder-tab-publish"
            hidden={tab !== 'publish'}
            className={panel}
          >
            {props.publishPanel}
          </div>
        ) : null}
        {props.packsPanel !== undefined ? (
          <div
            role="tabpanel"
            id="builder-panel-packs"
            aria-labelledby="builder-tab-packs"
            hidden={tab !== 'packs'}
            className={panel}
          >
            {props.packsPanel}
          </div>
        ) : null}
      </div>
    </section>
  );
}

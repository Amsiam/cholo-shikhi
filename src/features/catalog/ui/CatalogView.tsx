// S3 catalog for a Goal (UC5, US2.1): the Student's current Goal, or the Goal a visitor picked on the
// public catalog. A labelled tablist with keyboard support (arrow keys move, Enter or Space selects:
// manual activation, so a key press never fires a load); the selected tab lives in the page address
// (BR11.7). Cards show the title in the active language and the price through formatMoney (BR5.8,
// BR3.1); plan cards head the Courses tab with their price per month (BR11.2). Empty and error states
// are announced (NFR7.201).
import { Link } from '@tanstack/react-router';
import type { MessageKey } from '#src/lib/i18n/index.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { formatMoney, type MoneyPoisha } from '#src/lib/money.ts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { CatalogTab } from '../server/catalog-browse.schema.ts';
import type {
  CatalogCard,
  CourseCard as CourseCardData,
  ExamPackageCard,
  PlanCard as PlanCardData,
} from '../server/catalog-browse.types.ts';
import { localTitle } from './fields.tsx';
import { BuyProductButton } from './ProductBuy.tsx';

/** A course, exam package or plan card (BR11.1, BR11.2). */
export type CatalogCardView = CatalogCard;

export type CatalogViewState =
  | {
      kind: 'loaded';
      items: CatalogCardView[];
      nextCursor: string | null;
      tabsWithItems: readonly string[];
    }
  | { kind: 'failed' };

export type CatalogViewProps = {
  tab: CatalogTab;
  isBundlesTabEnabled: boolean;
  goal: { nameBn: string; nameEn: string };
  state: CatalogViewState;
  onSelectTab: (tab: CatalogTab) => void;
  onRetry: () => void;
  onLoadMore: () => void;
  isLoadingMore?: boolean;
  isLoadMoreFailed?: boolean;
};

const TAB_LABEL: Record<CatalogTab, MessageKey> = {
  courses: 'catalog.browse.tab.courses',
  exam_packages: 'catalog.browse.tab.exam_packages',
  bundles: 'catalog.browse.tab.bundles',
  free_trial: 'catalog.browse.tab.free_trial',
};
const EMPTY_TEXT: Record<CatalogTab, MessageKey> = {
  courses: 'catalog.browse.empty.courses',
  exam_packages: 'catalog.browse.empty.exam_packages',
  bundles: 'catalog.browse.empty.bundles',
  free_trial: 'catalog.browse.empty.free_trial',
};

export const catalogContainer = 'mx-auto w-full max-w-6xl px-4 sm:px-6';

/** Functional-spec §6 tab order; Bundles only with catalog.bundlesTab (BR11.3). */
export function visibleTabs(isBundlesTabEnabled: boolean): CatalogTab[] {
  return isBundlesTabEnabled
    ? ['courses', 'exam_packages', 'bundles', 'free_trial']
    : ['courses', 'exam_packages', 'free_trial'];
}

function PinnedBadge({ isPinned }: { isPinned: boolean }) {
  const { t } = useI18n();
  return isPinned ? (
    <Badge variant="secondary" className="w-fit bg-primary/10 text-primary">
      {t('catalog.browse.pinned')}
    </Badge>
  ) : null;
}

/** BR11.2: a plan card, priced per month through formatMoney (BR5.8). */
export function PlanCard({ card }: { card: PlanCardData }) {
  const { t, locale } = useI18n();
  return (
    <li
      data-testid="catalog-plan-card"
      className="flex flex-col gap-3 rounded-sm bg-primary p-5 text-primary-foreground sm:col-span-2 lg:col-span-3"
    >
      <span className="text-sm font-semibold">{t('catalog.browse.plan')}</span>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <span className="text-xl font-bold break-words" data-testid="catalog-plan-card-name">
          {locale === 'bn' ? card.nameBn : card.nameEn}
        </span>
        <span className="text-lg font-semibold tabular-nums" data-testid="catalog-plan-card-price">
          {t('catalog.browse.perMonth', {
            price: formatMoney(card.monthlyPricePoisha as MoneyPoisha, locale),
          })}
        </span>
      </div>
      {card.isPinned ? (
        <Badge className="w-fit bg-primary-foreground text-primary">
          {t('catalog.browse.pinned')}
        </Badge>
      ) : null}
      <BuyProductButton productType="subscription_plan" productId={card.planId} tone="onPrimary" />
    </li>
  );
}

/** BR11.1: an exam package card, drawn as an answer sheet; six months of access once bought. */
export function ExamCard({ card }: { card: ExamPackageCard }) {
  const { t, locale } = useI18n();
  return (
    <li data-testid="catalog-exam-card" className="flex flex-col border-2 border-omr bg-background">
      <span className="border-b-2 border-omr bg-omr-soft px-4 py-1.5 text-xs font-semibold text-omr">
        {t('catalog.browse.examAccess')}
      </span>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <span className="text-lg font-semibold break-words" data-testid="catalog-exam-card-title">
          {localTitle(card, locale)}
        </span>
        <span
          className="mt-auto text-xl font-bold tabular-nums"
          data-testid="catalog-exam-card-price"
        >
          {formatMoney(card.listPricePoisha as MoneyPoisha, locale)}
        </span>
        <PinnedBadge isPinned={card.isPinned} />
        <BuyProductButton productType="exam_package" productId={card.examPackageId} />
      </div>
    </li>
  );
}

function cardKey(card: CatalogCardView): string {
  if (card.kind === 'plan') return `plan:${card.planId}`;
  if (card.kind === 'exam_package') return `exam:${card.examPackageId}`;
  return `course:${card.courseId}`;
}

function Card({ card }: { card: CatalogCardView }) {
  if (card.kind === 'plan') return <PlanCard card={card} />;
  if (card.kind === 'exam_package') return <ExamCard card={card} />;
  return <CourseCard card={card} />;
}

function CourseCard({ card }: { card: CourseCardData }) {
  const { t, locale, formatInteger } = useI18n();
  return (
    <li data-testid="catalog-card" className="group flex">
      <Link
        to="/courses/$courseId"
        params={{ courseId: card.courseId }}
        className="flex w-full flex-col overflow-hidden rounded-sm border border-primary/25 bg-background transition-[border-color,transform] group-hover:-translate-y-0.5 group-hover:border-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
        data-testid="catalog-card-link"
      >
        <span
          aria-hidden="true"
          className="block h-20 bg-primary/10"
          style={{
            backgroundImage:
              'repeating-linear-gradient(to bottom, transparent 0, transparent 15px, color-mix(in oklch, var(--primary) 18%, transparent) 15px, color-mix(in oklch, var(--primary) 18%, transparent) 16px)',
          }}
        />
        <span className="flex flex-1 flex-col gap-2 p-4">
          <PinnedBadge isPinned={card.isPinned} />
          <span
            className="text-lg leading-snug font-semibold break-words"
            data-testid="catalog-card-title"
          >
            {localTitle(card, locale)}
          </span>
          <span className="text-sm text-ink-muted">
            {t('catalog.browse.duration', { months: formatInteger(card.accessDurationMonths) })}
          </span>
          <span className="mt-auto flex items-end justify-between gap-2 pt-3">
            <span className="text-xl font-bold tabular-nums" data-testid="catalog-card-price">
              {formatMoney(card.listPricePoisha as MoneyPoisha, locale)}
            </span>
            <span className="text-sm font-semibold text-primary">
              {t('catalog.browse.viewCourse')}
            </span>
          </span>
        </span>
      </Link>
    </li>
  );
}

function TabBody(props: CatalogViewProps & { tabs: CatalogTab[] }) {
  const { t } = useI18n();
  const { state, tab } = props;
  if (state.kind === 'failed') {
    return (
      <div
        role="alert"
        data-testid="catalog-error"
        className="flex flex-col items-start gap-3 py-8"
      >
        <p className="text-lg">{t('catalog.browse.loadFailed')}</p>
        <Button
          type="button"
          variant="outline"
          onClick={props.onRetry}
          data-testid="catalog-error-retry"
        >
          {t('catalog.browse.retry')}
        </Button>
      </div>
    );
  }
  if (state.items.length === 0) {
    const target =
      props.tabs.find((x) => x !== tab && state.tabsWithItems.includes(x)) ??
      (tab === 'courses' ? null : 'courses');
    return (
      <div
        role="status"
        data-testid="catalog-empty"
        className="flex flex-col items-start gap-2 border border-dashed border-primary/40 bg-background p-8"
      >
        <p className="text-lg">{t(EMPTY_TEXT[tab])}</p>
        {target ? (
          <Button
            type="button"
            variant="link"
            className="px-0"
            onClick={() => props.onSelectTab(target)}
            data-testid="catalog-empty-link"
          >
            {t('catalog.browse.empty.link', { tab: t(TAB_LABEL[target]) })}
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="catalog-list">
        {state.items.map((card) => (
          <Card key={cardKey(card)} card={card} />
        ))}
      </ul>
      {state.nextCursor ? (
        <Button
          type="button"
          variant="outline"
          className="self-center"
          disabled={props.isLoadingMore}
          onClick={props.onLoadMore}
          data-testid="catalog-load-more"
        >
          {t('catalog.browse.loadMore')}
        </Button>
      ) : null}
      {props.isLoadMoreFailed ? (
        <p
          role="alert"
          data-testid="catalog-load-more-error"
          className="text-center text-destructive"
        >
          {t('catalog.browse.loadMoreFailed')}
        </p>
      ) : null}
    </div>
  );
}

export function CatalogView(props: CatalogViewProps) {
  const { t, locale } = useI18n();
  const tabs = visibleTabs(props.isBundlesTabEnabled);
  const goalName = locale === 'bn' ? props.goal.nameBn : props.goal.nameEn;
  return (
    <section className="flex flex-col bg-paper text-ink" data-testid="catalog-page">
      <header className="border-b-2 border-primary bg-background">
        <div className={`${catalogContainer} flex flex-col gap-5 py-10`}>
          <div className="flex flex-col gap-2">
            <h1 className="text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">
              {t('catalog.browse.title')}
            </h1>
            <p data-testid="catalog-goal" className="flex items-center gap-2 text-lg text-ink/75">
              <span aria-hidden="true" className="size-4 shrink-0 rounded-full bg-primary" />
              {t('catalog.browse.goalLine', { goal: goalName })}
            </p>
          </div>
        </div>
      </header>
      <div className={`${catalogContainer} py-8`}>
        <Tabs
          value={props.tab}
          onValueChange={(value) => props.onSelectTab(value as CatalogTab)}
          activationMode="manual"
          className="gap-6"
        >
          <TabsList
            aria-label={t('catalog.browse.tabsLabel')}
            className="h-auto w-full flex-wrap justify-start gap-1 rounded-none border-b border-primary/20 bg-transparent p-0"
            data-testid="catalog-tabs"
          >
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="min-h-11 min-w-fit flex-none rounded-none border-0 border-b-2 border-transparent px-4 text-base data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
                data-testid={`catalog-tab-${tab}`}
              >
                {t(TAB_LABEL[tab])}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((tab) => (
            <TabsContent key={tab} value={tab} forceMount hidden={tab !== props.tab}>
              {tab === props.tab ? <TabBody {...props} tabs={tabs} /> : null}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}

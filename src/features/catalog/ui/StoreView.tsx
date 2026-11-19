// Packages and plans for the Student's goal: monthly subscriptions (which open their courses and
// exam packages) and exam packages on their own. Practice Packs are sold on their course's page.
import { ClipboardList, Layers } from 'lucide-react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import type { ExamPackageCard, PlanCard as PlanCardData } from '../server/catalog-browse.types.ts';
import { ExamCard, PlanCard } from './CatalogView.tsx';

export function StoreView(props: {
  goal: { nameBn: string; nameEn: string } | null;
  plans: PlanCardData[];
  packages: ExamPackageCard[];
}) {
  const { t, locale } = useI18n();
  return (
    <div className="flex flex-col gap-8" data-testid="store-page">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('store.title')}</h1>
        <p className="text-ink/75">
          {props.goal
            ? t('store.subtitle', { goal: locale === 'bn' ? props.goal.nameBn : props.goal.nameEn })
            : t('practice.noGoal')}
        </p>
      </header>
      <section aria-labelledby="store-plans" className="flex flex-col gap-3">
        <h2 id="store-plans" className="flex items-center gap-2 text-xl font-bold">
          <Layers aria-hidden="true" className="size-5 text-primary" />
          {t('store.plans')}
        </h2>
        <p className="text-sm text-ink/75">{t('store.plansNote')}</p>
        {props.plans.length === 0 ? (
          <p className="border border-dashed border-primary/25 bg-background p-4 text-sm text-ink-muted">
            {t('store.noPlans')}
          </p>
        ) : (
          <ul className="grid gap-4">
            {props.plans.map((p) => (
              <PlanCard key={p.planId} card={p} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="store-packages" className="flex flex-col gap-3">
        <h2 id="store-packages" className="flex items-center gap-2 text-xl font-bold">
          <ClipboardList aria-hidden="true" className="size-5 text-primary" />
          {t('store.packages')}
        </h2>
        {props.packages.length === 0 ? (
          <p className="border border-dashed border-primary/25 bg-background p-4 text-sm text-ink-muted">
            {t('store.noPackages')}
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {props.packages.map((p) => (
              <ExamCard key={p.examPackageId} card={p} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

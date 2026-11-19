// Shared pieces of the S1 picker and the S12 change section: the bilingual name in the active
// language (BR2.2) and the grouped radio list of active Goals.
import { useId } from 'react';
import type { Locale } from '#src/lib/i18n/locale.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export type Named = { nameBn: string; nameEn: string };
export type GoalOption = Named & { goalId: string };
export type GoalGroup = Named & { segmentId: string; goals: GoalOption[] };

/** The name in the active language, falling back to the other language if one is empty. */
export function localName(item: Named, locale: Locale): string {
  return locale === 'bn' ? item.nameBn || item.nameEn : item.nameEn || item.nameBn;
}

export function GoalChoiceList(props: {
  groups: GoalGroup[];
  value: string;
  onValueChange: (goalId: string) => void;
  testId: string;
  excludeGoalId?: string;
}) {
  const { t, locale } = useI18n();
  const baseId = useId();
  return (
    <RadioGroup
      value={props.value}
      onValueChange={props.onValueChange}
      className="grid gap-6"
      data-testid={props.testId}
    >
      {props.groups.map((group, groupIndex) => {
        const headingId = `${baseId}-segment-${groupIndex}`;
        const options = group.goals.filter((g) => g.goalId !== props.excludeGoalId);
        if (options.length === 0) return null;
        return (
          <section
            key={group.segmentId}
            aria-labelledby={headingId}
            className="grid gap-3"
            data-testid={`${props.testId}-segment`}
          >
            <h2 id={headingId} className="font-medium">
              <span className="sr-only">
                {t('goals.picker.groupLabel', { segment: localName(group, locale) })}
              </span>
              <span aria-hidden="true">{localName(group, locale)}</span>
            </h2>
            {options.map((goal, goalIndex) => {
              const id = `${baseId}-goal-${groupIndex}-${goalIndex}`;
              return (
                <div key={goal.goalId} className="flex min-h-12 items-center gap-3">
                  <RadioGroupItem
                    id={id}
                    value={goal.goalId}
                    data-testid={`${props.testId}-option`}
                  />
                  <Label htmlFor={id} className="text-base">
                    {localName(goal, locale)}
                  </Label>
                </div>
              );
            })}
          </section>
        );
      })}
    </RadioGroup>
  );
}

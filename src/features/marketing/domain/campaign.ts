// Campaigns and bundles (US8.1, US8.4). Plain TypeScript. Campaign dates are Asia/Dhaka calendar
// dates, both inclusive: a campaign for 1–7 Feb shows all day on the 7th and not on the 8th.
import { dhakaDateParts } from '#src/lib/time.ts';

/** The Asia/Dhaka calendar date of an instant, as "YYYY-MM-DD". */
export function dhakaToday(instant: string): string {
  const { year, month, day } = dhakaDateParts(instant);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** AC8.1.3: the end date may not be before the start date. */
export function isDateRange(startsOn: string, endsOn: string): boolean {
  return endsOn >= startsOn;
}

/** AC8.1.1 / AC8.1.2: a campaign shows to its segments on its dates only. */
export function isCampaignLive(
  campaign: { segmentIds: readonly string[]; startsOn: string; endsOn: string },
  segmentId: string | null,
  today: string,
): boolean {
  return (
    segmentId !== null &&
    campaign.segmentIds.includes(segmentId) &&
    today >= campaign.startsOn &&
    today <= campaign.endsOn
  );
}

/** AC8.4.2: a bundle holds at least two different courses. */
export const MIN_BUNDLE_COURSES = 2;
export function distinctCourses(courseIds: readonly string[]): string[] {
  return [...new Set(courseIds)];
}
export function isBundleSize(courseIds: readonly string[]): boolean {
  return distinctCourses(courseIds).length >= MIN_BUNDLE_COURSES;
}

// Free trial service (FR-DIST-1). Admins designate one trial course per Goal segment; a Student may
// start one trial per segment, ever (switching Goals does not reset it). Which lessons a trial opens,
// and when it has run out, is decided by Learning from the shared rules in src/lib/trial.ts.

import { courseTitlesOf, getPublishedCourse } from '#src/features/catalog/index.ts';
import { getActiveGoal } from '#src/features/goals/index.ts';
import { type Actor, phoneOf } from '#src/features/identity-access/index.ts';
import { settings } from '#src/features/platform/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { TRIAL_DAYS, TRIAL_LESSONS, trialEndsAt } from '#src/lib/trial.ts';
import { getDb } from '#src/server/db.ts';
import { createCommerceRepository } from '../data/commerce.repository.ts';
import { createTrialRepository } from '../data/trial.repository.ts';
import { alreadyEnrolled } from '../domain/checkout.ts';
import { COMMERCE_SETTINGS } from '../domain/commerce-settings.ts';
import { StartCheckoutInput } from './commerce.schema.ts';
import { entitlementsOf } from './product.server.ts';

const repo = createTrialRepository();
const commerce = createCommerceRepository();
type TrialError = AppError<'NOT_FOUND' | 'ALREADY_ENROLLED' | 'INVALID_STATE'>;

/** The Goal segment of a published course, or null. */
async function segmentOfCourse(courseId: string): Promise<string | null> {
  const course = await getPublishedCourse(courseId);
  if (!course.ok) return null;
  const goal = await getActiveGoal(course.value.goal.goalId);
  return goal.ok ? goal.value.segmentId : null;
}

/** Admin: make a published course its segment's free trial course. */
export async function setTrialCourse(
  actor: Actor,
  raw: StartCheckoutInput,
): Promise<Result<{ segmentId: string; courseId: string }, AppError<'NOT_FOUND'>>> {
  const input = StartCheckoutInput.parse(raw);
  const segmentId = await segmentOfCourse(input.courseId);
  if (!segmentId) return err(appError('NOT_FOUND'));
  await repo.setOffer(getDb(), { segmentId, courseId: input.courseId, setBy: actor.userId });
  return ok({ segmentId, courseId: input.courseId });
}

/** Admin: this course is no longer a trial course (running trials keep their access). */
export async function clearTrialCourse(raw: StartCheckoutInput): Promise<Result<null, never>> {
  const input = StartCheckoutInput.parse(raw);
  const db = getDb();
  const offer = await repo.offerOfCourse(db, input.courseId);
  if (offer) await repo.clearOffer(db, offer.segmentId);
  return ok(null);
}

/** Admin: every designated trial course, with its title. */
export async function listTrialCourses(): Promise<
  Result<
    Array<{
      segmentId: string;
      courseId: string;
      titleBn: string;
      titleEn: string;
      goalNameBn: string;
      goalNameEn: string;
      days: number;
      lessons: number;
    }>,
    never
  >
> {
  const offers = await repo.offers(getDb());
  const titles = await courseTitlesOf(offers.map((o) => o.courseId));
  const pages = await Promise.all(offers.map((o) => getPublishedCourse(o.courseId)));
  const caps = await Promise.all(offers.map((o) => trialCaps(o.segmentId)));
  return ok(
    offers.map((o, i) => {
      const page = pages[i];
      return {
        segmentId: o.segmentId,
        courseId: o.courseId,
        titleBn: titles[o.courseId]?.titleBn ?? '',
        titleEn: titles[o.courseId]?.titleEn ?? '',
        goalNameBn: page?.ok ? page.value.goal.nameBn : '',
        goalNameEn: page?.ok ? page.value.goal.nameEn : '',
        days: caps[i]?.days ?? TRIAL_DAYS,
        lessons: caps[i]?.lessons ?? TRIAL_LESSONS,
      };
    }),
  );
}

export type TrialOfferStatus = {
  /** This course is its segment's free trial course. */
  isTrialCourse: boolean;
  /** available: can start now; active / used: a trial of this course exists; usedElsewhere: the
   * Student already had this segment's trial on an earlier trial course. */
  state: 'none' | 'available' | 'active' | 'used' | 'usedElsewhere';
  endsAt: string | null;
};

/** What the course page shows about the free trial for this Student (signed in). */
export async function trialStatusFor(userId: string, courseId: string): Promise<TrialOfferStatus> {
  const db = getDb();
  const offer = await repo.offerOfCourse(db, courseId);
  const own = await repo.trialOfCourse(db, userId, courseId);
  if (own) {
    const isRunning = own.endsAt.getTime() > Date.now();
    return {
      isTrialCourse: offer !== null,
      state: isRunning ? 'active' : 'used',
      endsAt: own.endsAt.toISOString(),
    };
  }
  if (!offer) return { isTrialCourse: false, state: 'none', endsAt: null };
  const used = await repo.trialOfSegment(db, userId, offer.segmentId);
  return { isTrialCourse: true, state: used ? 'usedElsewhere' : 'available', endsAt: null };
}

/** US2.23: a segment's trial caps (Admin settings scoped to the segment; defaults 30 days, 5 lessons). */
export async function trialCaps(segmentId: string): Promise<{ days: number; lessons: number }> {
  const [days, lessons] = await Promise.all([
    settings().get(COMMERCE_SETTINGS.trialDays, segmentId),
    settings().get(COMMERCE_SETTINGS.trialLessons, segmentId),
  ]);
  return {
    days: days.ok ? days.value.value : TRIAL_DAYS,
    lessons: lessons.ok ? lessons.value.value : TRIAL_LESSONS,
  };
}

/** Starts the Student's free trial of a segment's trial course. */
export async function startTrial(
  actor: Actor,
  raw: StartCheckoutInput,
): Promise<Result<{ courseId: string; endsAt: string }, TrialError>> {
  const input = StartCheckoutInput.parse(raw);
  const db = getDb();
  const offer = await repo.offerOfCourse(db, input.courseId);
  if (!offer) return err(appError('NOT_FOUND'));
  if (await commerce.activeEnrolment(db, actor.userId, input.courseId))
    return err(alreadyEnrolled() as TrialError);
  // Q15: a trial needs a mobile number on the account; one account per number, so a fresh account
  // cannot take the same segment's trial again with the same phone.
  if (!(await phoneOf(actor.userId)))
    return err({ ...appError('INVALID_STATE'), i18nKey: 'errors.commerce.trialNeedsPhone' });
  // US2.23: the segment's caps now; the trial keeps them even if an Admin changes them later.
  const caps = await trialCaps(offer.segmentId);
  const startedAt = new Date();
  const endsAt = trialEndsAt(startedAt, caps.days);
  const inserted = await repo.insertTrial(db, {
    userId: actor.userId,
    segmentId: offer.segmentId,
    courseId: input.courseId,
    startedAt,
    endsAt,
    lessonCap: caps.lessons,
  });
  if (!inserted) return err({ ...appError('INVALID_STATE'), i18nKey: 'errors.commerce.trialUsed' });
  return ok({ courseId: input.courseId, endsAt: endsAt.toISOString() });
}

export type CourseAccess =
  | { kind: 'enrolled'; endsAt: string }
  | { kind: 'trial'; startedAt: string; endsAt: string; lessonCap: number }
  | null;

/** How a Student may open a course: a paid enrolment, a trial (Learning applies its caps), or not. */
export async function courseAccessOf(userId: string, courseId: string): Promise<CourseAccess> {
  const db = getDb();
  const enrolment = await commerce.activeEnrolment(db, userId, courseId);
  if (enrolment) return { kind: 'enrolled', endsAt: enrolment.endsAt.toISOString() };
  // A course included in an active subscription opens like an enrolment until the plan ends.
  const viaPlan = (await entitlementsOf(userId)).planCourses.find((c) => c.courseId === courseId);
  if (viaPlan) return { kind: 'enrolled', endsAt: viaPlan.endsAt };
  const trial = await repo.trialOfCourse(db, userId, courseId);
  return trial
    ? {
        kind: 'trial',
        startedAt: trial.startedAt.toISOString(),
        endsAt: trial.endsAt.toISOString(),
        lessonCap: trial.lessonCap,
      }
    : null;
}

/** The Student's trials (for My courses), newest first. */
export async function listTrialsOf(
  userId: string,
): Promise<Array<{ courseId: string; startedAt: string; endsAt: string; lessonCap: number }>> {
  const rows = await repo.trialsOf(getDb(), userId);
  return rows
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .map((r) => ({
      courseId: r.courseId,
      startedAt: r.startedAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      lessonCap: r.lessonCap,
    }));
}

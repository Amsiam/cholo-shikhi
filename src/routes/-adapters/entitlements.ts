// Route-level adapter for the S4 Buy / Continue switch (BR11.10). The catalog feature never imports
// commerce (ADR-020): the route composes this read beside the catalog read. It calls the commerce
// server function, so it works from both the server render and client navigation.
import {
  getMyEnrolmentStatus,
  getMyTrialStatus,
} from '#src/features/commerce/server/commerce.functions.ts';

export async function isEnrolledInCourse(courseId: string): Promise<boolean> {
  const result = await getMyEnrolmentStatus({ data: { courseId } });
  return result.ok && result.value.isEnrolled;
}

/** The enrolment state for the course page: enrolled, renewable now (last 14 days), and until when. */
export async function enrolmentStateOf(
  courseId: string,
): Promise<{ isEnrolled: boolean; canRenew: boolean; endsAt: string | null }> {
  const result = await getMyEnrolmentStatus({ data: { courseId } });
  return result.ok ? result.value : { isEnrolled: false, canRenew: false, endsAt: null };
}

/** The free-trial state of a course for the signed-in Student (FR-DIST-1). */
export async function trialStateOf(courseId: string): Promise<{
  state: 'none' | 'available' | 'active' | 'used' | 'usedElsewhere';
  isTrialCourse: boolean;
}> {
  const result = await getMyTrialStatus({ data: { courseId } });
  return result.ok
    ? { state: result.value.state, isTrialCourse: result.value.isTrialCourse }
    : { state: 'none', isTrialCourse: false };
}

// BR2.1 Goal guard for Goal-scoped screens (S2, S3, S4): a signed-in Student with no current Goal is
// sent to S1 before anything else loads. Used from a route's beforeLoad or loader:
//   const goal = await requireCurrentGoal(() => getCurrentGoal({ data: {} }));
import { redirect } from '@tanstack/react-router';

type LoadResult =
  | { ok: true; value?: unknown }
  | { ok: false; error?: { code: string; i18nKey: string } };

export type CurrentGoal = { goalId: string; segmentId: string; nameBn: string; nameEn: string };

/** The S1 Goal picker path. */
export const GOAL_PICKER_PATH = '/goals';

export async function requireCurrentGoal(load: () => Promise<LoadResult>): Promise<CurrentGoal> {
  const result = await load();
  if (result.ok) return result.value as CurrentGoal;
  const code = result.error?.code;
  if (code === 'NOT_FOUND') throw redirect({ to: GOAL_PICKER_PATH });
  if (code === 'UNAUTHENTICATED') throw redirect({ to: '/sign-in' });
  // Any other failure is unexpected here: the route's error boundary shows the retry screen.
  throw new Error(`current goal could not be loaded: ${code ?? 'unknown'}`);
}

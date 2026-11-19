// [LT] Step 10: the BR2.1 Goal guard used by S2, S3 and S4.
import { isRedirect } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { GOAL_PICKER_PATH, requireCurrentGoal } from './require-current-goal.ts';

async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('requireCurrentGoal (BR2.1)', () => {
  it('returns the current Goal when one is chosen', async () => {
    const goal = { goalId: 'g', segmentId: 's', nameBn: 'ক', nameEn: 'A' };
    await expect(requireCurrentGoal(async () => ({ ok: true, value: goal }))).resolves.toEqual(
      goal,
    );
  });

  it('redirects to S1 when the Student has no Goal', async () => {
    const thrown = await thrownBy(
      requireCurrentGoal(async () => ({
        ok: false,
        error: { code: 'NOT_FOUND', i18nKey: 'errors.common.NOT_FOUND' },
      })),
    );
    expect(isRedirect(thrown)).toBe(true);
    expect(thrown).toMatchObject({ options: { to: GOAL_PICKER_PATH } });
    expect(GOAL_PICKER_PATH).toBe('/goals');
  });

  it('redirects a signed-out caller to sign-in', async () => {
    const thrown = await thrownBy(
      requireCurrentGoal(async () => ({
        ok: false,
        error: { code: 'UNAUTHENTICATED', i18nKey: 'errors.common.UNAUTHENTICATED' },
      })),
    );
    expect(thrown).toMatchObject({ options: { to: '/sign-in' } });
  });

  it('lets any other failure reach the route error boundary', async () => {
    const thrown = await thrownBy(
      requireCurrentGoal(async () => ({
        ok: false,
        error: { code: 'INTERNAL_ERROR', i18nKey: 'errors.common.INTERNAL_ERROR' },
      })),
    );
    expect(isRedirect(thrown)).toBe(false);
    expect(thrown).toBeInstanceOf(Error);
  });
});

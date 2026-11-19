// [AT] US1.5 Enforce roles on every server action (written before src/server/fn-core.ts exists).
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Actor } from '#src/features/identity-access/domain/actor.schema.ts';
import { appError } from '#src/lib/errors.ts';
import { err, ok } from '#src/lib/result.ts';
import { guard } from './fn-core.ts';

const FINANCE: Actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  roles: ['student', 'finance'],
  locale: 'en',
  hasStepUp: true,
};
const STUDENT_A: Actor = {
  userId: '22222222-2222-4222-8222-222222222222',
  roles: ['student'],
  locale: 'bn',
  hasStepUp: false,
};
const INSTRUCTOR: Actor = {
  userId: '33333333-3333-4333-8333-333333333333',
  roles: ['student', 'instructor'],
  locale: 'en',
  hasStepUp: true,
};
const request = new Request('http://localhost:3000/_serverFn/x', { method: 'POST' });
const signedIn = (actor: Actor) => async () => ok(actor);
const anonymous = async () => err(appError('UNAUTHENTICATED'));
const Input = z.object({ payoutRunId: z.uuid() });
const input = { payoutRunId: '44444444-4444-4444-8444-444444444444' };

describe('US1.5 Enforce roles on every server action', () => {
  it('AC1.5.1 Given a Finance user, When they call a Finance-only function, Then it runs', async () => {
    const handler = vi.fn(async () => ok({ approved: true }));
    const result = await guard(
      { access: { kind: 'role', roles: ['finance'] }, schema: Input, handler },
      { request, rawInput: input, getActor: signedIn(FINANCE) },
    );
    expect(result).toEqual({ ok: true, value: { approved: true } });
    expect(handler).toHaveBeenCalledOnce();
  });

  it.each([
    ['an anonymous caller', anonymous, 'UNAUTHENTICATED'],
    ['a Student', signedIn(STUDENT_A), 'FORBIDDEN'],
    ['an Instructor', signedIn(INSTRUCTOR), 'FORBIDDEN'],
  ])(
    'AC1.5.2 Given %s, When they call a Finance-only function, Then it is refused and nothing runs',
    async (_who, getActor, code) => {
      const handler = vi.fn(async () => ok({}));
      const result = await guard(
        { access: { kind: 'role', roles: ['finance'] }, schema: Input, handler },
        { request, rawInput: input, getActor },
      );
      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("AC1.5.3 Given Student A, When they request Student B's object by ID, Then the response is NOT_FOUND", async () => {
    const ownerOf: Record<string, string> = { 'enrol-b': 'student-b' };
    const result = await guard(
      {
        access: { kind: 'authed' },
        schema: z.object({ enrolmentId: z.string() }),
        handler: async ({ actor, input: data }) =>
          ownerOf[data.enrolmentId] === actor.userId
            ? ok({ id: data.enrolmentId })
            : err(appError('NOT_FOUND')),
      },
      { request, rawInput: { enrolmentId: 'enrol-b' }, getActor: signedIn(STUDENT_A) },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});

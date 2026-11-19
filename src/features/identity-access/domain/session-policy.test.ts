// Session tiers (BR3.1–BR3.4, BR3.13, BR3.14) with hand-computed timestamps.
import { describe, expect, it } from 'vitest';
import { evaluateSession, hasStepUp, type SessionSnapshot } from './session-policy.ts';

const T0 = '2026-11-01T00:00:00.000Z';
const at = (offsetMs: number) => new Date(new Date(T0).getTime() + offsetMs).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const student: SessionSnapshot = {
  tier: 'student',
  state: 'active',
  createdAt: T0,
  tierAnchorAt: T0,
  lastActiveAt: T0,
  stepUpVerifiedAt: null,
};
const staff: SessionSnapshot = { ...student, tier: 'staff', stepUpVerifiedAt: T0 };
const facts = {
  student: { isStaff: false, hasActiveAuthenticator: false },
  staff: { isStaff: true, hasActiveAuthenticator: true },
};

describe('student tier (30 days absolute, 7 days idle)', () => {
  it('stays live inside both limits and records activity at 1-minute granularity', () => {
    const r = evaluateSession(student, facts.student, at(2 * MIN));
    expect(r).toMatchObject({
      outcome: 'live',
      isChanged: true,
      next: { lastActiveAt: at(2 * MIN) },
    });
    expect(evaluateSession(student, facts.student, at(30_000))).toMatchObject({
      outcome: 'live',
      isChanged: false,
    });
  });
  it('ends after 7 days idle', () => {
    expect(evaluateSession(student, facts.student, at(7 * DAY))).toEqual({
      outcome: 'ended',
      endReason: 'idle_timeout',
    });
  });
  it('ends 30 days after the anchor even when active', () => {
    const busy = { ...student, lastActiveAt: at(30 * DAY - MIN) };
    expect(evaluateSession(busy, facts.student, at(30 * DAY))).toEqual({
      outcome: 'ended',
      endReason: 'absolute_timeout',
    });
  });
});

describe('staff tier (12 hours absolute, 30 minutes idle)', () => {
  it('ends after 30 minutes idle', () => {
    expect(evaluateSession(staff, facts.staff, at(30 * MIN))).toEqual({
      outcome: 'ended',
      endReason: 'idle_timeout',
    });
  });
  it('ends 12 hours after the anchor', () => {
    const busy = { ...staff, lastActiveAt: at(12 * HOUR - MIN) };
    expect(evaluateSession(busy, facts.staff, at(12 * HOUR))).toEqual({
      outcome: 'ended',
      endReason: 'absolute_timeout',
    });
  });
});

describe('tier transitions', () => {
  it('BR3.13 gaining a staff role moves the session into two-step with staff limits from now', () => {
    // Created 10 days ago (past staff's 12 h limit if it were anchored at creation), last active 2 h ago
    // (past staff's 30 min idle limit): it is re-anchored and its activity clock starts now.
    const live = { ...student, lastActiveAt: at(10 * DAY - 2 * HOUR) };
    const r2 = evaluateSession(live, facts.staff, at(10 * DAY));
    expect(r2).toMatchObject({
      outcome: 'live',
      next: {
        tier: 'staff',
        state: 'pending_challenge',
        tierAnchorAt: at(10 * DAY),
        lastActiveAt: at(10 * DAY),
        stepUpVerifiedAt: null,
      },
    });
  });
  it('a student session idle for 7 days ends before any tier transition is applied', () => {
    expect(evaluateSession(student, facts.staff, at(10 * DAY))).toEqual({
      outcome: 'ended',
      endReason: 'idle_timeout',
    });
  });
  it('BR3.14 a session older than 30 days that drops back to student limits ends', () => {
    const old = { ...staff, tierAnchorAt: at(31 * DAY), lastActiveAt: at(31 * DAY) };
    expect(evaluateSession(old, facts.student, at(31 * DAY + MIN))).toEqual({
      outcome: 'ended',
      endReason: 'absolute_timeout',
    });
  });
  it('BR5.2 a new staff user without an authenticator must enrol', () => {
    expect(
      evaluateSession(student, { isStaff: true, hasActiveAuthenticator: false }, at(MIN)),
    ).toMatchObject({
      next: { state: 'pending_enrolment' },
    });
  });
  it('BR3.14 losing the last staff role returns to student limits from creation, with no step-up', () => {
    const r = evaluateSession(
      { ...staff, tierAnchorAt: at(DAY), lastActiveAt: at(DAY) },
      facts.student,
      at(DAY + MIN),
    );
    expect(r).toMatchObject({
      outcome: 'live',
      next: { tier: 'student', tierAnchorAt: T0, state: 'active', stepUpVerifiedAt: null },
    });
  });
  it('a revoked authenticator sends a pending challenge back to enrolment', () => {
    const pending = { ...staff, state: 'pending_challenge' as const, stepUpVerifiedAt: null };
    expect(
      evaluateSession(pending, { isStaff: true, hasActiveAuthenticator: false }, at(MIN)),
    ).toMatchObject({
      next: { state: 'pending_enrolment' },
    });
  });
});

describe('hasStepUp', () => {
  it('is true only for an active staff session whose two-step passed', () => {
    expect(hasStepUp(staff)).toBe(true);
    expect(hasStepUp(student)).toBe(false);
    expect(hasStepUp({ ...staff, state: 'pending_challenge' })).toBe(false);
    expect(hasStepUp({ ...staff, stepUpVerifiedAt: null })).toBe(false);
  });
});

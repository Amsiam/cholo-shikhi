// Session tiers and two-step state (BR3.1–BR3.4, BR3.13, BR3.14, BR5.1–BR5.3; functional-design Q1).
export type SessionTier = 'student' | 'staff';
export type SessionState =
  | 'pending_enrolment'
  | 'pending_challenge'
  | 'active'
  | 'expired'
  | 'revoked';

export const SESSION_LIMITS = {
  student: { absoluteMs: 30 * 24 * 60 * 60 * 1000, idleMs: 7 * 24 * 60 * 60 * 1000 },
  staff: { absoluteMs: 12 * 60 * 60 * 1000, idleMs: 30 * 60 * 1000 },
} as const;

/** lastActiveAt is coalesced to 1-minute granularity to avoid a write on every request. */
export const ACTIVITY_WRITE_GRANULARITY_MS = 60 * 1000;

export type SessionSnapshot = {
  tier: SessionTier;
  state: SessionState;
  createdAt: string;
  tierAnchorAt: string;
  lastActiveAt: string;
  stepUpVerifiedAt: string | null;
};

export type SessionEvaluation =
  | { outcome: 'ended'; endReason: 'idle_timeout' | 'absolute_timeout' }
  | { outcome: 'live'; next: SessionSnapshot; isChanged: boolean };

const ms = (iso: string) => new Date(iso).getTime();

/**
 * Evaluated on every request (BR3.4). Applies tier transitions first, so a session that just
 * gained a staff role takes staff limits from now (BR3.13), and one that lost its last staff role
 * goes back to student limits counted from creation, with no step-up (BR3.14).
 */
export function evaluateSession(
  session: SessionSnapshot,
  facts: { isStaff: boolean; hasActiveAuthenticator: boolean },
  now: string,
): SessionEvaluation {
  // 1. The session must still be inside the limits of the tier it was in until this request.
  const before = checkLimits(session, now);
  if (before) return { outcome: 'ended', endReason: before };

  // 2. Tier transitions take effect at this request.
  let next: SessionSnapshot = { ...session };
  const desiredTier: SessionTier = facts.isStaff ? 'staff' : 'student';
  if (desiredTier !== session.tier) {
    next =
      desiredTier === 'staff'
        ? {
            ...next,
            tier: 'staff',
            tierAnchorAt: now,
            lastActiveAt: now,
            stepUpVerifiedAt: null,
            state: facts.hasActiveAuthenticator ? 'pending_challenge' : 'pending_enrolment',
          }
        : {
            ...next,
            tier: 'student',
            tierAnchorAt: session.createdAt,
            stepUpVerifiedAt: null,
            state: 'active',
          };
  } else if (
    next.tier === 'staff' &&
    next.state === 'pending_challenge' &&
    !facts.hasActiveAuthenticator
  ) {
    // The authenticator was revoked (e.g. a recovery code was used elsewhere): enrol again.
    next = { ...next, state: 'pending_enrolment' };
  }

  // 3. Back on student limits counted from creation, the session may already be past them.
  const after = checkLimits(next, now);
  if (after) return { outcome: 'ended', endReason: after };

  if (ms(now) - ms(next.lastActiveAt) >= ACTIVITY_WRITE_GRANULARITY_MS)
    next = { ...next, lastActiveAt: now };
  const isChanged = JSON.stringify(next) !== JSON.stringify(session);
  return { outcome: 'live', next, isChanged };
}

function checkLimits(
  session: SessionSnapshot,
  now: string,
): 'idle_timeout' | 'absolute_timeout' | null {
  const limits = SESSION_LIMITS[session.tier];
  if (ms(now) - ms(session.tierAnchorAt) >= limits.absoluteMs) return 'absolute_timeout';
  if (ms(now) - ms(session.lastActiveAt) >= limits.idleMs) return 'idle_timeout';
  return null;
}

/** A staff session counts as stepped up only once its two-step check passed in this session. */
export function hasStepUp(
  session: Pick<SessionSnapshot, 'tier' | 'state' | 'stepUpVerifiedAt'>,
): boolean {
  return (
    session.tier === 'staff' && session.state === 'active' && session.stepUpVerifiedAt !== null
  );
}

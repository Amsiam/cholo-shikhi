// Feature-flag evaluation (BR8.1–BR8.3, BR8.9). Pure: callers load the flag and the user's roles.
import { createHash } from 'node:crypto';

export type FlagState = 'off' | 'on' | 'targeted';
export type FlagRole = 'student' | 'instructor' | 'admin' | 'finance';

export type FlagDefinition = {
  flagKey: string;
  state: FlagState;
  targetRoles: readonly string[];
  targetGoalSegmentIds: readonly string[];
  rolloutPercent: number;
};

export type FlagSubject = { userId?: string; roles: readonly FlagRole[]; goalSegmentId?: string };

/** Stable 0–99 bucket per (flag, user): the same user always gets the same answer (BR8.3). */
export function rolloutBucket(flagKey: string, userId: string): number {
  const digest = createHash('sha256').update(`${flagKey}:${userId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export type FlagDecision = {
  isEnabled: boolean;
  reason:
    | 'unknown'
    | 'off'
    | 'on'
    | 'role'
    | 'segment'
    | 'segment_missing'
    | 'rollout'
    | 'targeted';
};

/** BR8.2: unknown key off; off off; on on; targeted on only when every dimension matches. */
export function evaluateFlag(flag: FlagDefinition | undefined, subject: FlagSubject): FlagDecision {
  if (!flag) return { isEnabled: false, reason: 'unknown' };
  if (flag.state === 'off') return { isEnabled: false, reason: 'off' };
  if (flag.state === 'on') return { isEnabled: true, reason: 'on' };
  if (
    flag.targetRoles.length > 0 &&
    !subject.roles.some((role) => flag.targetRoles.includes(role))
  ) {
    return { isEnabled: false, reason: 'role' };
  }
  if (flag.targetGoalSegmentIds.length > 0) {
    // BR8.9: U1 cannot read Goals; without a caller-supplied segment the rule does not match.
    if (!subject.goalSegmentId) return { isEnabled: false, reason: 'segment_missing' };
    if (!flag.targetGoalSegmentIds.includes(subject.goalSegmentId))
      return { isEnabled: false, reason: 'segment' };
  }
  if (flag.rolloutPercent < 100) {
    if (!subject.userId || rolloutBucket(flag.flagKey, subject.userId) >= flag.rolloutPercent) {
      return { isEnabled: false, reason: 'rollout' };
    }
  }
  return { isEnabled: true, reason: 'targeted' };
}

// Ambiguous attribution cases (US7.13). Plain TypeScript: who may be confirmed as a section's
// owner, and which dry-run lines an open case affects. No payout amount is computed here.

/** An override needs a real reason (at least 10 characters). */
export function isOverrideReason(text: string | undefined): text is string {
  return typeof text === 'string' && text.trim().length >= 10;
}

/** Why a case cannot be resolved this way, or null. The owner must be one of the claimants. */
export function resolveRefusal(
  c: { state: 'open' | 'resolved'; claimantIds: readonly string[] },
  ownerId: string,
  reason: string | undefined,
):
  | 'errors.attribution.resolved'
  | 'errors.attribution.notClaimant'
  | 'errors.attribution.reason'
  | null {
  if (c.state !== 'open') return 'errors.attribution.resolved';
  if (!c.claimantIds.includes(ownerId)) return 'errors.attribution.notClaimant';
  if (!isOverrideReason(reason)) return 'errors.attribution.reason';
  return null;
}

/** AC7.13.2: the instructors whose dry-run lines are marked while cases about them are open. */
export function disputedInstructors(
  cases: ReadonlyArray<{ state: 'open' | 'resolved'; claimantIds: readonly string[] }>,
): Set<string> {
  return new Set(cases.filter((c) => c.state === 'open').flatMap((c) => c.claimantIds));
}

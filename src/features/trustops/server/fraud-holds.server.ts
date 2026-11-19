// The holds an open fraud flag places (US4.8, US5.15, US8.10), read by other features through
// TrustOps' index. Flags are set by hand on A3; nothing here detects anything.
import type { Executor } from '#src/server/db.ts';
import { getDb } from '#src/server/db.ts';
import { createFraudRepository } from '../data/fraud.repository.ts';

const repo = createFraudRepository();

/** AC4.8.1: Vault items wrong at or before this instant are held, or null when not flagged. */
export async function vaultHeldUpTo(userId: string): Promise<Date | null> {
  return (await repo.openOf(getDb(), userId, 'vault_gaming'))?.flaggedAt ?? null;
}

/** AC5.15.1: the users who may not receive live-quiz shields while a collusion flag is open. */
export async function shieldIneligible(
  exec: Executor,
  userIds: readonly string[],
): Promise<Set<string>> {
  return new Set(await repo.openUsersOf(exec, userIds, 'quiz_collusion'));
}

/** AC8.10.1: whether the account's referral earnings are held (quarantined). */
export async function isReferralQuarantined(userId: string): Promise<boolean> {
  return (await repo.openOf(getDb(), userId, 'referral_fraud')) !== null;
}

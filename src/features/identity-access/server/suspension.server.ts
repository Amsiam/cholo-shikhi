// Account suspension (fraud ban), contract 3 addition: Admin-only (re-checked here), audited and
// reversible, separate from account closure (disableAccount, U12 only). Server-only.
import type { TxHandle } from '#src/lib/tx.ts';
import type { Actor } from '../domain/actor.schema.ts';
import { getIdentity } from './identity-instance.server.ts';

/** Suspends the account: sign-in is refused and every session ends until it is reinstated. */
export function suspendAccount(
  tx: TxHandle,
  actor: Actor,
  input: { userId: string; reason: string; source: string },
) {
  return getIdentity().suspendAccount(tx, actor, input);
}

/** Lifts the account's active suspension; INVALID_STATE when it is not suspended. */
export function reinstateAccount(
  tx: TxHandle,
  actor: Actor,
  input: { userId: string; reason: string },
) {
  return getIdentity().reinstateAccount(tx, actor, input);
}

export function isAccountSuspended(userId: string): Promise<boolean> {
  return getIdentity().isSuspended(userId);
}

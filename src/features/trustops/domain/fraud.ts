// Fraud review queues (US4.9, US8.11): manual flags only, no detector. Plain TypeScript.
export type FraudKind = 'vault_gaming' | 'quiz_collusion' | 'referral_fraud';
export type FraudState = 'open' | 'cleared' | 'banned' | 'reinstated';
export type FraudAction = 'clear' | 'ban' | 'reinstate';

/**
 * The next state, or null when the action does not apply: an open flag is cleared or banned once;
 * a ban is reversible once (reinstated); cleared and reinstated flags are final.
 */
export function nextFraudState(from: FraudState, action: FraudAction): FraudState | null {
  if (from === 'open' && action === 'clear') return 'cleared';
  if (from === 'open' && action === 'ban') return 'banned';
  if (from === 'banned' && action === 'reinstate') return 'reinstated';
  return null;
}

/** A flag or a decision needs a real reason (at least 10 characters). */
export function isFraudReason(text: string | undefined): text is string {
  return typeof text === 'string' && text.trim().length >= 10;
}

/**
 * AC4.8.1 (hold, by hand): while a Vault flag is open, the Student's items last answered wrongly at
 * or before the flag are held out of resurfacing; later mistakes resurface as usual.
 */
export function isVaultItemHeld(lastWrongAt: Date, heldUpTo: Date | null): boolean {
  return heldUpTo !== null && lastWrongAt.getTime() <= heldUpTo.getTime();
}

/** A user typed into the flag form: an email address or an account ID. */
export function userRefOf(text: string): { email: string } | { userId: string } | null {
  const trimmed = text.trim();
  const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(trimmed);
  if (id) return { userId: trimmed.toLowerCase() };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { email: trimmed.toLowerCase() };
  return null;
}

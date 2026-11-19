// The takedown notice state machine (US9.7). Plain TypeScript.
export type TakedownState = 'open' | 'honoured' | 'rejected' | 'reversed';
export type TakedownAction = 'honour' | 'reject' | 'reverse';

/** The next state, or null when the action is not allowed from this state. */
export function nextTakedownState(
  from: TakedownState,
  action: TakedownAction,
): TakedownState | null {
  if (from === 'open' && action === 'honour') return 'honoured';
  if (from === 'open' && action === 'reject') return 'rejected';
  if (from === 'honoured' && action === 'reverse') return 'reversed';
  return null;
}

/** AC9.7.3: a decision or a reversal needs a real reason (at least 10 characters). */
export function isReason(text: string | undefined): text is string {
  return typeof text === 'string' && text.trim().length >= 10;
}

/** A course ID from a pasted course link or the ID itself; null if there is none. */
export function courseIdFrom(input: string): string | null {
  const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(input);
  return m ? m[0].toLowerCase() : null;
}

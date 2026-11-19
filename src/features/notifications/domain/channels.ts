// BR12.3: requested channels -> SMS-off fallback -> push gate -> preferences (locked types exempt).
import type { Channel } from './notification-types.ts';

export type ChannelFacts = {
  requested: readonly Channel[];
  isSmsEnabled: boolean;
  isPushEnabled: boolean;
  isLocked: boolean;
  /** Explicit per-channel choices for this type; a missing entry means the default (on). */
  preferences: Partial<Record<Channel, boolean>>;
};

const ORDER: readonly Channel[] = ['in_app', 'push', 'email', 'sms'];

export function resolveChannels(facts: ChannelFacts): Channel[] {
  const set = new Set<Channel>(facts.requested);
  // BR12.5: while SMS is off, an SMS-bound notice goes in-app, by push and by email instead.
  if (set.has('sms') && !facts.isSmsEnabled) {
    set.delete('sms');
    for (const c of ['in_app', 'push', 'email'] as const) set.add(c);
  }
  // BR12.20: push is gated by notifications.pushEnabled (off at launch).
  if (!facts.isPushEnabled) set.delete('push');
  if (!facts.isLocked) {
    for (const channel of [...set]) if (facts.preferences[channel] === false) set.delete(channel);
    // BR12.9: push carries no detail and points to the in-app copy.
    if (facts.preferences.in_app === false) set.delete('push');
  }
  return ORDER.filter((c) => set.has(c));
}

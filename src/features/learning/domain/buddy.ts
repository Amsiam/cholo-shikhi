// Study buddies (FR5.6, US5.12–US5.14). Plain TypeScript: no framework, DB or env access.

/** On a day both buddies study, each earns this multiple of the base daily tokens (FR5.6). */
export const BUDDY_MULTIPLIER_TENTHS = 12;
export const INVITE_DAYS = 7;

export const BUDDY_ROUNDING = ['half_up', 'down', 'up'] as const;
export type BuddyRounding = (typeof BUDDY_ROUNDING)[number];

export function isBuddyRounding(value: unknown): value is BuddyRounding {
  return typeof value === 'string' && (BUDDY_ROUNDING as readonly string[]).includes(value);
}

/** 1.2 × base, rounded to a whole token by the configured rule; exact integer arithmetic. */
export function buddyDailyTokens(base: number, rounding: BuddyRounding): number {
  const tenths = base * BUDDY_MULTIPLIER_TENTHS;
  if (rounding === 'down') return Math.floor(tenths / 10);
  if (rounding === 'up') return Math.ceil(tenths / 10);
  return Math.floor((tenths + 5) / 10);
}

/** The extra tokens on a buddy day, on top of the base daily credit (never negative). */
export function buddyBonus(base: number, rounding: BuddyRounding): number {
  return Math.max(0, buddyDailyTokens(base, rounding) - base);
}

/** A pair counts on Asia/Dhaka days from its first day up to, not including, its end day. */
export function isPairActiveOn(pair: { startsDay: string; endsDay: string | null }, day: string) {
  return day >= pair.startsDay && (pair.endsDay === null || day < pair.endsDay);
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A six-character invite code without look-alike characters. */
export function makeInviteCode(random: () => number): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

export function normaliseInviteCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, '');
}

// US3.12 viewer badge: a short Student ID drawn over lesson videos to deter piracy. It is derived
// from the account ID, so it identifies the account to staff without showing a name, email or
// phone, and it is drawn by the app: nothing about the Student is sent to the video service.

/** "CS-" and the first 8 hex digits of the account ID, upper case ("CS-0F9A5B2E"). */
export function viewerBadge(userId: string): string {
  return `CS-${userId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/**
 * Where the badge may sit, as top/left percentages of the video. All are in the upper three
 * quarters, so the badge never covers the caption area at the bottom.
 */
export const BADGE_SPOTS: ReadonlyArray<{ top: number; left: number }> = [
  { top: 6, left: 6 },
  { top: 6, left: 62 },
  { top: 30, left: 30 },
  { top: 52, left: 8 },
  { top: 52, left: 58 },
  { top: 18, left: 40 },
];

/** The next spot, never the same as the current one. */
export function nextBadgeSpot(current: number, random: () => number): number {
  const step = 1 + Math.floor(random() * (BADGE_SPOTS.length - 1));
  return (current + step) % BADGE_SPOTS.length;
}

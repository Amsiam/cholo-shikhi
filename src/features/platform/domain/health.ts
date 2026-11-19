// Health rules (US9.5, US9.6; BR15.3–BR15.5).
export type ComponentStatus = 'operational' | 'degraded' | 'down';
export const STATUS_COMPONENTS = [
  'app',
  'sign_in',
  'catalog',
  'checkout',
  'lessons',
  'live',
  'payouts',
  'notifications',
] as const;
export type StatusComponent = (typeof STATUS_COMPONENTS)[number];

/** BR15.3: a component's published state changes only after 3 consecutive results agree. */
export function publishedStatus(
  current: ComponentStatus,
  recent: readonly ComponentStatus[],
): ComponentStatus {
  const lastThree = recent.slice(-3);
  if (lastThree.length < 3) return current;
  const [first] = lastThree;
  return first !== undefined && lastThree.every((s) => s === first) ? first : current;
}

export type SliSample = { at: string; successRate: number };
export type P1Decision =
  | { shouldAlert: false }
  | {
      shouldAlert: true;
      severity: 'P1';
      incident: 'payment_confirmation_degraded';
      links: { statusPage: string; runbook: string };
    };

/**
 * BR15.4/BR15.5: alert only when the payment-confirmation success rate stayed below the SLI for the
 * whole window (default 90% for 5 minutes); a breach that recovers inside the window raises nothing.
 */
export function evaluatePaymentSli(
  samples: readonly SliSample[],
  now: string,
  policy: { sliPercent: number; windowMinutes: number },
): P1Decision {
  const end = new Date(now).getTime();
  const start = end - policy.windowMinutes * 60_000;
  const inWindow = samples.filter((s) => {
    const at = new Date(s.at).getTime();
    return at >= start && at <= end;
  });
  const coversWindow = inWindow.some((s) => new Date(s.at).getTime() <= start);
  const isBreached =
    inWindow.length > 0 && inWindow.every((s) => s.successRate * 100 < policy.sliPercent);
  if (!coversWindow || !isBreached) return { shouldAlert: false };
  return {
    shouldAlert: true,
    severity: 'P1',
    incident: 'payment_confirmation_degraded',
    links: { statusPage: '/status', runbook: '/docs/runbooks/payment-confirmation.md' },
  };
}

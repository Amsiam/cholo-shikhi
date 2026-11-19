// Instrumentation events (US11.8, BR13.1–BR13.4). Plain TypeScript: no framework or DB imports.
import { z } from 'zod';
import type { Metrics } from '#src/lib/metrics.ts';

/** The event catalogue. Every story's named event must appear here (AC11.8.3). */
export const INSTRUMENTATION_CATALOGUE: ReadonlyMap<string, { featureArea: string; tile: string }> =
  new Map([
    ['account_created', { featureArea: 'identity', tile: 'Sign-ups' }],
    ['email_verified', { featureArea: 'identity', tile: 'Verified accounts' }],
    ['sign_in_succeeded', { featureArea: 'identity', tile: 'Sign-ins' }],
    ['sign_in_failed', { featureArea: 'identity', tile: 'Failed sign-ins' }],
    ['sign_in_locked', { featureArea: 'identity', tile: 'Sign-in lockouts' }],
    ['signed_out', { featureArea: 'identity', tile: 'Sign-outs' }],
    ['password_reset_completed', { featureArea: 'identity', tile: 'Password resets' }],
    ['staff_role_changed', { featureArea: 'identity', tile: 'Staff role changes' }],
    ['two_step_enrolled', { featureArea: 'identity', tile: 'Two-step enrolments' }],
    ['two_step_challenge_failed', { featureArea: 'identity', tile: 'Two-step failures' }],
    ['recovery_code_used', { featureArea: 'identity', tile: 'Recovery codes used' }],
    ['language_changed', { featureArea: 'app-shell', tile: 'Language switches' }],
    ['install_prompt_shown', { featureArea: 'app-shell', tile: 'Install prompts' }],
    ['app_update_applied', { featureArea: 'app-shell', tile: 'App updates' }],
    ['flag_changed', { featureArea: 'platform', tile: 'Flag changes' }],
    ['setting_changed', { featureArea: 'platform', tile: 'Setting changes' }],
    ['job_succeeded', { featureArea: 'platform', tile: 'Jobs succeeded' }],
    ['job_failed', { featureArea: 'platform', tile: 'Jobs failed' }],
    ['outbox_dead_lettered', { featureArea: 'platform', tile: 'Dead letters' }],
    ['document_rendered', { featureArea: 'platform', tile: 'Rendered documents' }],
    ['health_status_changed', { featureArea: 'platform', tile: 'Status changes' }],
    ['notification_created', { featureArea: 'notifications', tile: 'Notifications' }],
    ['notification_delivery_failed', { featureArea: 'notifications', tile: 'Delivery failures' }],
    ['realtime_room_joined', { featureArea: 'realtime', tile: 'Room joins' }],
    // Named by AC11.8.1 as the worked example; emitted by U3 Commerce.
    ['enrolment_confirmed', { featureArea: 'commerce', tile: 'Enrolments' }],
  ]);

/** Returns the names that are not in the catalogue (the CI catalogue check, AC11.8.3). */
export function missingFromCatalogue(names: readonly string[]): string[] {
  return names.filter((name) => !INSTRUMENTATION_CATALOGUE.has(name));
}

/** Key tokens that indicate personal data (BR13.2). Keys are split on camelCase and `_`/`-`. */
const FORBIDDEN_KEY_TOKENS: ReadonlySet<string> = new Set([
  'phone',
  'mobile',
  'msisdn',
  'email',
  'token',
  'otp',
  'password',
  'secret',
  'card',
  'pan',
  'cvv',
  'kyc',
  'nid',
  'passport',
  'address',
  'birth',
  'dob',
]);
/** Person-name keys; `jobName`, `consumerName` and similar technical names stay allowed. */
const PERSON_NAME_KEY = /^(full|display|first|last|given|family|user|student|instructor)?_?name$/i;
/** Values that look like an email address or a phone number are rejected too. */
const EMAIL_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_VALUE = /(?:\+?880|\b0)1[3-9]\d{8}\b|\+\d{10,15}\b/;

export function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

export function isPersonalDataKey(key: string): boolean {
  return PERSON_NAME_KEY.test(key) || keyTokens(key).some((t) => FORBIDDEN_KEY_TOKENS.has(t));
}

export function looksLikePersonalValue(value: unknown): boolean {
  return typeof value === 'string' && (EMAIL_VALUE.test(value) || PHONE_VALUE.test(value));
}

const PropertyValue = z.union([z.string().max(200), z.number().int(), z.boolean()]);

export const InstrumentationInput = z.object({
  eventName: z.string().min(1).max(100),
  featureArea: z.string().min(1).max(60),
  correlationId: z.string().min(1).max(100),
  properties: z
    .record(z.string(), PropertyValue)
    .superRefine((props, ctx) => {
      for (const [key, value] of Object.entries(props)) {
        if (isPersonalDataKey(key) || looksLikePersonalValue(value)) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'personal data is not allowed' });
        }
      }
    })
    .optional(),
});
export type InstrumentationInput = z.infer<typeof InstrumentationInput>;

export type InstrumentationRecord = InstrumentationInput & { occurredAt: string };

export type InstrumentationSink = {
  write(record: InstrumentationRecord): Promise<void>;
};

export type Instrument = {
  /** Fire and forget: never throws and never awaits the sink (BR13.4). */
  emit(event: InstrumentationInput): void;
  /** Test and shutdown hook: waits for in-flight writes. */
  flush(): Promise<void>;
};

export function createInstrument(deps: {
  sink: InstrumentationSink;
  metrics: Metrics;
  now: () => string;
  onError?: (eventName: string, error: unknown) => void;
}): Instrument {
  const inFlight = new Set<Promise<void>>();
  return {
    emit(event) {
      const parsed = InstrumentationInput.safeParse(event);
      const eventName = typeof event?.eventName === 'string' ? event.eventName : 'unknown';
      if (!parsed.success || !INSTRUMENTATION_CATALOGUE.has(parsed.data.eventName)) {
        deps.metrics.increment('instrumentation_rejected_total', { event: eventName });
        return;
      }
      const record: InstrumentationRecord = { ...parsed.data, occurredAt: deps.now() };
      const write = deps.sink
        .write(record)
        .then(() => {
          deps.metrics.increment('instrumentation_events_total', { event: eventName });
        })
        .catch((error: unknown) => {
          deps.metrics.increment('instrumentation_emit_failures_total', { event: eventName });
          deps.onError?.(eventName, error);
        })
        .finally(() => {
          inFlight.delete(write);
        });
      inFlight.add(write);
    },
    async flush() {
      await Promise.all([...inFlight]);
    },
  };
}

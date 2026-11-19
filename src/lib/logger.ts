// Structured JSON logger (team.md Errors and logging, BR19.2, NFR9.4). Server-only.
// Redaction is by exact key name at any depth, plus scrubbing of email and phone patterns inside
// string values. The `code` field (error codes) is deliberately NOT redacted.
import pino, { type DestinationStream, type Logger } from 'pino';
import { currentCorrelationId } from './correlation.ts';
import { getLogLevel } from './env.ts';

/** Exact keys (compared lower-case) whose values are never logged. */
export const REDACTED_KEYS: ReadonlySet<string> = new Set([
  'password',
  'passwordhash',
  'newpassword',
  'currentpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'sessiontoken',
  'tokenhash',
  'cookie',
  'set-cookie',
  'authorization',
  'otp',
  'totp',
  'totpsecret',
  'secret',
  'recoverycode',
  'recoverycodes',
  'backupcodes',
  'phone',
  'phonenumber',
  'mobile',
  'email',
  'cardnumber',
  'pan',
  'cvv',
  'nid',
  'nidnumber',
  'nidnumbersealed',
  // KYC photos (base64) and payout account numbers (US7.19, US7.20).
  'front',
  'back',
  'accountnumber',
  'accountsealed',
  'kyc',
  'passport',
  'dateofbirth',
]);

export const REDACTED = '[REDACTED]';
const EMAIL_PATTERN = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[A-Za-z]{2,}/g;
const PHONE_PATTERN = /(?:\+?880|\b0)1[3-9]\d{8}\b/g;

function scrubString(value: string): string {
  return value.replace(EMAIL_PATTERN, REDACTED).replace(PHONE_PATTERN, REDACTED);
}

/** Returns a deep copy with denylisted keys replaced and string values scrubbed. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[DEPTH_LIMIT]';
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) {
    return {
      type: value.name,
      message: scrubString(value.message),
      stack: value.stack ? scrubString(value.stack) : undefined,
    };
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : redact(inner, depth + 1);
    }
    return out;
  }
  return value;
}

export function createLogger(
  options: { level?: string; destination?: DestinationStream } = {},
): Logger {
  return pino(
    {
      level: options.level ?? 'info',
      base: { service: 'cholo-shikhi' },
      timestamp: pino.stdTimeFunctions.isoTime,
      messageKey: 'msg',
      formatters: {
        level: (label) => ({ level: label }),
        log: (object) => redact(object) as Record<string, unknown>,
      },
      mixin: () => {
        const correlationId = currentCorrelationId();
        return correlationId ? { correlationId } : {};
      },
      hooks: {
        // Scrub the message string itself as well as the structured fields.
        logMethod(args, method) {
          const scrubbed = args.map((arg) => (typeof arg === 'string' ? scrubString(arg) : arg));
          return method.apply(this, scrubbed as Parameters<typeof method>);
        },
      },
    },
    options.destination,
  );
}

let shared: Logger | undefined;

/** The process logger. Its level is LOG_LEVEL, validated by getLogLevel() in env.ts. */
export function getLogger(): Logger {
  if (!shared) {
    shared = createLogger({ level: getLogLevel() });
  }
  return shared;
}

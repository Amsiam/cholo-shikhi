// [LT] Logger redaction: every required field survives, PII keys are dropped (US11.8, BR19.2).
import { describe, expect, it } from 'vitest';
import { withCorrelation } from './correlation.ts';
import { createLogger, REDACTED, redact } from './logger.ts';

function capture() {
  const lines: Array<Record<string, unknown>> = [];
  const destination = { write: (line: string) => lines.push(JSON.parse(line)) };
  return { logger: createLogger({ level: 'debug', destination }), lines };
}

describe('logger', () => {
  it('writes structured JSON with level, time, message and service', () => {
    const { logger, lines } = capture();
    logger.info({ jobName: 'relay' }, 'started');
    expect(lines[0]).toMatchObject({
      level: 'info',
      msg: 'started',
      service: 'cholo-shikhi',
      jobName: 'relay',
    });
    expect(typeof lines[0]?.time).toBe('string');
  });

  it('keeps the error code field while redacting secrets', () => {
    const { logger, lines } = capture();
    logger.warn(
      { code: 'RATE_LIMITED', password: 'hunter22', token: 'abc', otp: '123456' },
      'refused',
    );
    expect(lines[0]).toMatchObject({
      code: 'RATE_LIMITED',
      password: REDACTED,
      token: REDACTED,
      otp: REDACTED,
    });
  });

  it('redacts denylisted keys at any depth and case', () => {
    const out = redact({
      user: { Email: 'a@b.test', profile: { phoneNumber: '01712345678' } },
      list: [{ cvv: '1' }],
    });
    expect(out).toEqual({
      user: { Email: REDACTED, profile: { phoneNumber: REDACTED } },
      list: [{ cvv: REDACTED }],
    });
  });

  it('AC7.19.3: redacts KYC numbers, photos and payout account numbers', () => {
    expect(
      redact({
        input: {
          nidNumber: '1990123456789',
          front: 'base64',
          back: 'base64',
          accountNumber: '017',
        },
      }),
    ).toEqual({
      input: { nidNumber: REDACTED, front: REDACTED, back: REDACTED, accountNumber: REDACTED },
    });
  });

  it('scrubs emails and phone numbers inside free text, including error messages', () => {
    const { logger, lines } = capture();
    logger.error(
      { err: new Error('Key (email)=(x.y@example.test) already exists') },
      'insert failed for 01712345678',
    );
    const serialised = JSON.stringify(lines[0]);
    expect(serialised).not.toContain('x.y@example.test');
    expect(serialised).not.toContain('01712345678');
  });

  it('adds the correlation ID from the async context', () => {
    const { logger, lines } = capture();
    withCorrelation('corr-abcdef12', () => logger.info('inside'));
    logger.info('outside');
    expect(lines[0]?.correlationId).toBe('corr-abcdef12');
    expect(lines[1]?.correlationId).toBeUndefined();
  });

  it('never logs authorization headers or cookies', () => {
    const out = redact({
      headers: { authorization: 'Bearer x', cookie: 's=1', 'user-agent': 'ua' },
    });
    expect(out).toEqual({
      headers: { authorization: REDACTED, cookie: REDACTED, 'user-agent': 'ua' },
    });
  });

  it('stops at a depth limit instead of recursing forever', () => {
    let nested: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 12; i++) nested = { nested };
    expect(JSON.stringify(redact(nested))).toContain('[DEPTH_LIMIT]');
  });
});

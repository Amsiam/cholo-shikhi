// Correlation-ID propagation through async work (NFR9.5). Server-only (node:async_hooks).
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const storage = new AsyncLocalStorage<{ correlationId: string }>();

export const CORRELATION_HEADER = 'x-correlation-id';
const VALID_ID = /^[A-Za-z0-9._:-]{8,100}$/;

export function newCorrelationId(): string {
  return randomUUID();
}

/** Accepts a caller-supplied ID only if it is well-formed; otherwise mints a new one. */
export function correlationIdFrom(headerValue: string | null | undefined): string {
  return headerValue && VALID_ID.test(headerValue) ? headerValue : newCorrelationId();
}

export function withCorrelation<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

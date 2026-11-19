// EmailSender port (TS-10). The real global provider is chosen later (recorded residency exception,
// Q10=B); locally the dev-mailbox adapter writes each message to .dev-mailbox/ and the dev mailbox page.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

export type EmailKind = 'verify' | 'reset' | 'staff_invite' | 'notification';

export type EmailMessage = {
  to: string;
  locale: 'bn' | 'en';
  kind: EmailKind;
  subject: string;
  text: string;
  /** The single action link in the message, if any. */
  link: string;
};

export type EmailSendResult = { providerMessageId: string };

export class EmailSendError extends Error {
  readonly isRetryable: boolean;
  readonly providerCode: string;
  constructor(providerCode: string, isRetryable: boolean) {
    super(`email provider refused the message (${providerCode})`);
    this.name = 'EmailSendError';
    this.providerCode = providerCode;
    this.isRetryable = isRetryable;
  }
}

export type EmailSender = { send(message: EmailMessage): Promise<EmailSendResult> };

/** Test adapter: records messages; can be told to fail the next N sends. */
export function createRecordingEmailSender() {
  const sent: EmailMessage[] = [];
  let failures = 0;
  return {
    sent,
    failNext(count: number) {
      failures = count;
    },
    async send(message: EmailMessage): Promise<EmailSendResult> {
      if (failures > 0) {
        failures -= 1;
        throw new EmailSendError('stub_unavailable', true);
      }
      sent.push(message);
      return { providerMessageId: `stub-${sent.length}` };
    },
  };
}

export type DevMailboxEntry = EmailMessage & { id: string; sentAt: string };

const DEFAULT_DIR = new URL('../../../../.dev-mailbox/', import.meta.url);

/** Local development adapter. Never used in production (EMAIL_TRANSPORT is validated in env.ts). */
export function createDevMailboxSender(
  dir: URL = DEFAULT_DIR,
  log: (message: string) => void = () => undefined,
): EmailSender {
  return {
    async send(message) {
      mkdirSync(dir, { recursive: true });
      const id = randomUUID();
      const entry: DevMailboxEntry = { ...message, id, sentAt: new Date().toISOString() };
      writeFileSync(new URL(`${Date.now()}-${id}.json`, dir), JSON.stringify(entry, null, 2));
      // The address is not logged (BR19.2); the dev mailbox page shows it locally.
      log(`dev-mailbox: wrote ${message.kind} email ${id}`);
      return { providerMessageId: id };
    },
  };
}

/** Reads the dev mailbox, newest first (used by the local mailbox page and e2e tests). */
export function readDevMailbox(dir: URL = DEFAULT_DIR): DevMailboxEntry[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files
    .sort()
    .reverse()
    .map((file) => JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as DevMailboxEntry);
}

// [LT] dev-mailbox adapter: writes each message, reads newest first, logs without the address.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDevMailboxSender,
  createRecordingEmailSender,
  EmailSendError,
  readDevMailbox,
} from './email-sender.server.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const message = (to: string) => ({
  to,
  locale: 'en' as const,
  kind: 'verify' as const,
  subject: 's',
  text: 't',
  link: 'http://localhost/x',
});

describe('dev mailbox sender', () => {
  it('writes messages and reads them back newest first, logging no address', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cs-mail-'));
    dirs.push(dir);
    const logs: string[] = [];
    const sender = createDevMailboxSender(pathToFileURL(`${dir}/`), (m) => logs.push(m));
    await sender.send(message('one@example.test'));
    await new Promise((r) => setTimeout(r, 5));
    await sender.send(message('two@example.test'));
    const mailbox = readDevMailbox(pathToFileURL(`${dir}/`));
    expect(mailbox.map((m) => m.to)).toEqual(['two@example.test', 'one@example.test']);
    expect(logs.join(' ')).not.toContain('@example.test');
  });
  it('returns an empty mailbox when the folder does not exist', () => {
    expect(readDevMailbox(pathToFileURL('/nonexistent-cholo-shikhi-mailbox/'))).toEqual([]);
  });
});

describe('recording sender', () => {
  it('fails the requested number of sends with a retryable provider error', async () => {
    const sender = createRecordingEmailSender();
    sender.failNext(1);
    await expect(sender.send(message('a@example.test'))).rejects.toBeInstanceOf(EmailSendError);
    await expect(sender.send(message('a@example.test'))).resolves.toEqual({
      providerMessageId: 'stub-1',
    });
  });
});

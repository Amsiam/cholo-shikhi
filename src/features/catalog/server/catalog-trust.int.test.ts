// [LT] Step 25: the A9 blocked-domain list through its real builders (roleFn('admin') with step-up),
// on a per-file schema with real Better Auth sessions. A domain blocked now is refused at the very
// next lesson save (no cache; NFR6.210), entries are stored ASCII-normalised (SD-210), and the audit
// records the entry ID and action, never the domain text.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildGoalInput, buildSegmentInput, buildTitle } from '#src/test/factories/catalog.ts';
import {
  type Caller,
  createServerFnHarness,
  type ServerFnHarness,
  type ServerFnResultLike,
} from '#src/test/server-fn-harness.ts';

let s: ServerFnHarness;
let finance: Caller;
let goalId: string;

function value<T>(result: ServerFnResultLike): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value as T;
}

beforeAll(async () => {
  s = await createServerFnHarness();
  finance = await s.newFinance();
  const segment = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  goalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segment.segmentId)),
  ).goalId;
});
afterAll(async () => {
  await s?.close();
});

type Row = { blockedDomainId: string; domain: string; version: number };
const list = async () =>
  value<{ rows: Row[]; total: number }>(
    await s.call('listBlockedDomains', s.admin.request, { page: 1, pageSize: 100 }),
  );

describe('NFR6.202 negative matrix (Admin only)', () => {
  const ALL = ['listBlockedDomains', 'addBlockedDomain', 'removeBlockedDomain'];
  const inputs: Record<string, unknown> = {
    listBlockedDomains: { page: 1 },
    addBlockedDomain: { domain: 'example.org' },
    removeBlockedDomain: {
      blockedDomainId: '0b6f8c9e-3a8d-4f57-9b7e-0c1d2e3f4a5b',
      expectedVersion: 1,
    },
  };
  it.each(ALL)('%s refuses an anonymous caller', async (name) => {
    expect(await s.call(name, s.anonymous(), inputs[name])).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
  it.each(ALL)('%s refuses a Student, an Instructor and Finance staff', async (name) => {
    const student = await s.newStudent();
    for (const caller of [student, s.instructor, finance]) {
      expect(await s.call(name, caller.request, inputs[name])).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
    }
  });
  it.each(ALL)('%s refuses an Admin without step-up', async (name) => {
    expect(await s.call(name, s.adminWithoutStepUp.request, inputs[name])).toMatchObject({
      ok: false,
      error: { code: 'STEP_UP_REQUIRED' },
    });
  });
});

describe('managing the list', () => {
  it('adds a normalised entry, refuses duplicates and invalid domains, and removes with a token', async () => {
    const added = value<{ blockedDomainId: string; domain: string }>(
      await s.call('addBlockedDomain', s.admin.request, { domain: '  Phish.Example. ' }),
    );
    expect(added.domain).toBe('phish.example');
    expect(
      await s.call('addBlockedDomain', s.admin.request, { domain: 'PHISH.example' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', fieldErrors: { domain: ['errors.catalog.domainAlreadyBlocked'] } },
    });
    for (const domain of ['https://x.example', 'localhost', '10.0.0.1', 'intranet']) {
      expect(await s.call('addBlockedDomain', s.admin.request, { domain })).toMatchObject({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED',
          fieldErrors: { domain: ['errors.catalog.domainInvalid'] },
        },
      });
    }
    const idn = value<{ domain: string }>(
      await s.call('addBlockedDomain', s.admin.request, { domain: 'аpple.com' }),
    );
    expect(idn.domain).toBe('xn--pple-43d.com');
    const row = (await list()).rows.find((r) => r.blockedDomainId === added.blockedDomainId) as Row;
    expect(
      await s.call('removeBlockedDomain', s.admin.request, {
        blockedDomainId: row.blockedDomainId,
        expectedVersion: row.version + 1,
      }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    value(
      await s.call('removeBlockedDomain', s.admin.request, {
        blockedDomainId: row.blockedDomainId,
        expectedVersion: row.version,
      }),
    );
    expect((await list()).rows.map((r) => r.domain)).not.toContain('phish.example');
    const { rows } = await s.t.pool.query(
      `SELECT action, before, after FROM audit_log_entry WHERE subject_type = 'blocked_domain' ORDER BY occurred_at`,
    );
    expect(rows.map((r) => r.action)).toEqual([
      'catalog.blockedDomain.added',
      'catalog.blockedDomain.added',
      'catalog.blockedDomain.removed',
    ]);
    expect(JSON.stringify(rows)).not.toContain('phish');
  });

  it('a domain blocked now is refused at the next lesson save; unblocked, the save goes through', async () => {
    const lead = await s.newInstructor();
    const { courseId } = value<{ courseId: string }>(
      await s.call('createCourse', lead.request, {
        goalId,
        ...buildTitle(),
        sections: [buildTitle()],
      }),
    );
    const sectionId = value<{ sections: Array<{ sectionId: string }> }>(
      await s.call('getCourseForEditing', lead.request, { courseId }),
    ).sections[0]?.sectionId as string;
    const edit = async () =>
      value<{ editVersion: number; lessons: Array<{ lessonId: string; version: number }> }>(
        await s.call('getSectionForEditing', lead.request, { courseId, sectionId }),
      );
    const { lessonId } = value<{ lessonId: string }>(
      await s.call('addLesson', lead.request, {
        courseId,
        sectionId,
        expectedVersion: (await edit()).editVersion,
        kind: 'text',
        ...buildTitle(),
      }),
    );
    const save = async () =>
      s.call('saveTextLessonBody', lead.request, {
        courseId,
        sectionId,
        lessonId,
        expectedVersion: (await edit()).lessons[0]?.version,
        language: 'en',
        body: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'go',
                  marks: [{ type: 'link', attrs: { href: 'https://www.scam.example/' } }],
                },
              ],
            },
          ],
        },
      });
    value(await save());
    const added = value<{ blockedDomainId: string }>(
      await s.call('addBlockedDomain', s.admin.request, { domain: 'scam.example' }),
    );
    expect(await save()).toMatchObject({
      ok: false,
      error: { fieldErrors: { 'bodyEn.links.0': ['errors.catalog.blockedLink'] } },
    });
    const row = (await list()).rows.find((r) => r.blockedDomainId === added.blockedDomainId) as Row;
    value(
      await s.call('removeBlockedDomain', s.admin.request, {
        blockedDomainId: row.blockedDomainId,
        expectedVersion: row.version,
      }),
    );
    value(await save());
  });
});

// [LT] Step 50: OD-207 moderation signals on real PostgreSQL, with the real U1 audit log, rate-limit
// store and contract 4 notify (asserted on the NotificationRequested rows it writes, IDs only).
// Each signal fires at threshold + 1 and not at the threshold, and never changes the instructor's
// answer. The publish-burst job runs as `catalog.moderation.signals`; the link and course-creation
// signals are raised at refusal time through the real server functions.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getNotifications } from '#src/features/notifications/index.ts';
import { createAudit } from '#src/features/platform/index.ts';
import { createLogger } from '#src/lib/logger.ts';
import { fixedClock } from '#src/lib/time.ts';
import { getDb, withTransaction } from '#src/server/db.ts';
import { buildGoalInput, buildSegmentInput, buildTitle } from '#src/test/factories/catalog.ts';
import {
  type Caller,
  createServerFnHarness,
  type ServerFnHarness,
} from '#src/test/server-fn-harness.ts';
import { createPublishHelper, value } from '../test-fixtures/publish-helper.ts';
import { createModeration, MODERATION_JOB } from './catalog-moderation.server.ts';

let s: ServerFnHarness;
let goalId: string;

beforeAll(async () => {
  s = await createServerFnHarness();
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  goalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, buildGoalInput(segmentId)),
  ).goalId;
  for (const [settingKey, v] of [
    ['catalog.coursePrice.minPoisha', 10_000],
    ['catalog.coursePrice.maxPoisha', 5_000_000],
  ] as const) {
    value(
      await s.call('saveSetting', s.admin.request, {
        settingKey,
        value: v,
        reason: 'LT price bounds',
      }),
    );
  }
});
afterAll(async () => {
  await s?.close();
});

/** NotificationRequested rows of one moderation signal for one instructor (one per Admin). */
async function signals(signal: string, instructorId: string) {
  const { rows } = await s.t.pool.query<{ recipient: string; dedupe: string }>(
    `SELECT payload->>'recipientUserId' AS recipient, payload->>'dedupeKey' AS dedupe FROM outbox_event
     WHERE event_type = 'notifications.NotificationRequested'
       AND payload->>'templateKey' = 'notify.catalog.moderationSignal'
       AND payload->'params'->>'signal' = $1 AND payload->'params'->>'instructorId' = $2`,
    [signal, instructorId],
  );
  return rows;
}

describe('catalog.moderation.signals: publish bursts (more than 20 a Dhaka day)', () => {
  const clock = fixedClock('2026-11-17T08:00:00.000Z'); // 14:00 in Dhaka
  const moderation = () =>
    createModeration({
      db: getDb(),
      clock,
      log: createLogger({ level: 'silent' }),
      hashId: (id) => `h:${id}`,
      notify: (tx, request, correlationId) => getNotifications().notify(tx, request, correlationId),
    });

  async function publishes(actorId: string, n: number, at: string) {
    const audit = createAudit({ clock: fixedClock(at) });
    await withTransaction(getDb(), async (tx) => {
      for (let i = 0; i < n; i += 1) {
        await audit.record(tx, {
          actorId,
          action: 'catalog.course.published',
          subjectType: 'course',
          subjectId: randomUUID(),
          after: { kind: 'republished' },
          correlationId: 'lt-moderation',
        });
      }
    });
  }

  it('signals every Admin for 21 publishes today, not for 20, and ignores yesterday', async () => {
    const busy = randomUUID();
    const atLimit = randomUUID();
    const yesterday = randomUUID();
    await publishes(busy, 21, '2026-11-17T07:00:00.000Z');
    await publishes(atLimit, 20, '2026-11-17T07:00:00.000Z');
    await publishes(yesterday, 30, '2026-11-16T17:00:00.000Z'); // 23:00 Dhaka, the day before
    const result = await moderation().jobHandlers()[MODERATION_JOB]?.({ correlationId: 'c' });
    expect(result).toEqual({ ok: true, value: { signalled: 1 } });
    const raised = await signals('publishBurst', busy);
    expect(raised.map((r) => r.recipient)).toContain(s.admin.userId);
    expect(await signals('publishBurst', atLimit)).toEqual([]);
    expect(await signals('publishBurst', yesterday)).toEqual([]);
  });

  it('keys a repeated run in the same Dhaka day with the same dedupe key (one notification, BR12.2)', async () => {
    const busy = randomUUID();
    await publishes(busy, 25, '2026-11-17T07:30:00.000Z');
    await moderation().runSignals('c1');
    await moderation().runSignals('c2');
    const keys = new Set((await signals('publishBurst', busy)).map((r) => r.dedupe));
    expect([...keys]).toEqual([`signal:publishBurst:${busy}:2026-11-16T18:00:00.000Z`]);
  });
});

describe('link refusals at save (more than 10 an hour)', () => {
  let lead: Caller;
  let lesson: { courseId: string; sectionId: string; lessonId: string };

  beforeAll(async () => {
    const helper = createPublishHelper(s);
    const draft = await helper.draft(goalId);
    lead = draft.lead;
    lesson = {
      courseId: draft.courseId,
      sectionId: draft.sectionIds[0] as string,
      lessonId: draft.lessonIds[0] as string,
    };
  });

  async function refusedSave() {
    const edit = value<{ lessons: Array<{ lessonId: string; version: number }> }>(
      await s.call('getSectionForEditing', lead.request, {
        courseId: lesson.courseId,
        sectionId: lesson.sectionId,
      }),
    );
    const version = edit.lessons.find((l) => l.lessonId === lesson.lessonId)?.version;
    const result = await s.call('saveTextLessonBody', lead.request, {
      ...lesson,
      expectedVersion: version,
      language: 'en',
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'link',
                marks: [{ type: 'link', attrs: { href: 'http://example.com/' } }],
              },
            ],
          },
        ],
      },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
  }

  it('raises nothing for 10 refusals, one signal on the 11th, and keeps refusing the same way', async () => {
    for (let i = 0; i < 10; i += 1) await refusedSave();
    expect(await signals('linkRefusals', lead.userId)).toEqual([]);
    await refusedSave();
    const raised = await signals('linkRefusals', lead.userId);
    expect(raised.map((r) => r.recipient)).toContain(s.admin.userId);
    const count = raised.length;
    await refusedSave();
    expect(await signals('linkRefusals', lead.userId)).toHaveLength(count);
  });
});

describe('the course-creation limit (SD-218) at refusal time', () => {
  it('raises a signal when the 11th course of the Dhaka day is refused, and none before', async () => {
    const instructor = await s.newInstructor();
    const create = () =>
      s.call('createCourse', instructor.request, {
        goalId,
        ...buildTitle(),
        sections: [buildTitle()],
      });
    for (let i = 0; i < 10; i += 1) expect((await create()).ok).toBe(true);
    expect(await signals('courseCreateLimit', instructor.userId)).toEqual([]);
    expect(await create()).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
    expect((await signals('courseCreateLimit', instructor.userId)).length).toBeGreaterThan(0);
  });
});

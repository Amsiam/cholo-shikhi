// [LT] Step 46: image visibility after a takedown (NFR6.218; SD-220, RD-211, RD-212), on real
// PostgreSQL with the real contract 5 hideContent / restoreContent, the real U1 outbox rows and a real
// relay delivering catalog.ContentVisibilityChanged to the catalog.imageVisibility consumer. Objects
// live in the local storage stub (the buckets need Step 47). Images are inserted as rows because the
// upload route fails closed without an approved decoder (Step 44).
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hideContent, restoreContent } from '#src/features/catalog/index.ts';
import { createOutbox } from '#src/features/platform/server/outbox.server.ts';
import { createLogger } from '#src/lib/logger.ts';
import { createMetrics } from '#src/lib/metrics.ts';
import { fixedClock } from '#src/lib/time.ts';
import { getDb, withTransaction } from '#src/server/db.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import { createRelay } from '#src/worker/relay.ts';
import { createImageRepository } from '../data/image.repository.ts';
import { variantKey } from '../domain/image.ts';
import {
  createPublishHelper,
  type PublishedCourse,
  value,
} from '../test-fixtures/publish-helper.ts';
import { createImageVisibility, ORPHAN_AGE_MS } from './catalog-image-visibility.server.ts';
import { createMemoryImageStorage, type ImageStorage } from './image-ports.server.ts';

let s: ServerFnHarness;
let goalId: string;
const clock = fixedClock('2026-11-17T06:00:00.000Z');
const repo = createImageRepository();

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

type World = {
  course: PublishedCourse;
  storage: ImageStorage;
  copies: { n: number };
  scheduled: string[];
  service: ReturnType<typeof createImageVisibility>;
  deliver: () => Promise<void>;
  image: (
    kind: 'cover' | 'inline',
    lessonIds: string[],
  ) => Promise<{ imageId: string; key: string }>;
  where: (key: string) => Promise<'public' | 'quarantine' | 'both' | 'none'>;
  state: (imageId: string) => Promise<{ desired: string; actual: string }>;
};

async function liveLessonVersion(lessonId: string): Promise<string> {
  const { rows } = await s.t.pool.query<{ lesson_version_id: string }>(
    `SELECT lv.lesson_version_id FROM lesson_version lv
     JOIN section_version sv ON sv.section_version_id = lv.section_version_id
     WHERE lv.lesson_id = $1 AND sv.review_state = 'published'`,
    [lessonId],
  );
  return rows[0]?.lesson_version_id as string;
}

async function world(): Promise<World> {
  const course = await createPublishHelper(s).published(goalId, { sections: 2 });
  const base = createMemoryImageStorage(clock);
  const copies = { n: 0 };
  const storage: ImageStorage = {
    ...base,
    copy: async (from, to, key) => {
      copies.n += 1;
      await base.copy(from, to, key);
    },
  };
  const scheduled: string[] = [];
  const service = createImageVisibility({
    db: getDb(),
    clock,
    storage,
    log: createLogger({ level: 'silent' }),
    metrics: createMetrics(),
    scheduleApply: async (courseId, eventId) => {
      if (!scheduled.includes(eventId)) scheduled.push(eventId);
      expect(courseId).toBe(course.courseId);
    },
  });
  const outbox = createOutbox({ clock });
  outbox.registerConsumer(service.consumer());
  const relay = createRelay({
    db: getDb(),
    outbox,
    clock,
    workerId: `visibility-${randomUUID()}`,
    metrics: createMetrics(),
    onAlert: () => undefined,
    random: () => 0.5,
  });
  return {
    course,
    storage,
    copies,
    scheduled,
    service,
    async deliver() {
      for (let i = 0; i < 3; i += 1) await relay.runOnce();
      await relay.release();
    },
    async image(kind, lessonIds) {
      const key = `img/${randomBytes(16).toString('base64url')}`;
      const imageId = await repo.insert(getDb(), {
        courseId: course.courseId,
        kind,
        storageKey: key,
        variantWidths: [400, 800],
        width: 800,
        height: 600,
        uploadedBy: course.lead.userId,
      });
      for (const lessonId of lessonIds) {
        await repo.addReference(getDb(), await liveLessonVersion(lessonId), imageId);
      }
      for (const width of [400, 800])
        await base.put('public', variantKey(key, width), new Uint8Array([1]));
      return { imageId, key };
    },
    async where(key) {
      const object = variantKey(key, 800);
      const [p, q] = [await base.exists('public', object), await base.exists('quarantine', object)];
      return p && q ? 'both' : p ? 'public' : q ? 'quarantine' : 'none';
    },
    async state(imageId) {
      const row = await repo.get(getDb(), imageId);
      return { desired: row?.desiredState as string, actual: row?.actualState as string };
    },
  };
}

const takedown = (fn: typeof hideContent, type: 'course' | 'lesson', id: string, notice: string) =>
  withTransaction(getDb(), (tx) => fn(tx, { contentRef: { type, id }, takedownNoticeId: notice }));

beforeEach(() => {
  clock.advanceMs(1000);
});

describe('catalog.imageVisibility consumer and catalog.image.applyVisibility', () => {
  it('quarantines only the images whose every reference is hidden, then restores them under the same key', async () => {
    const w = await world();
    const [lessonA, lessonB] = w.course.lessonIds as [string, string];
    const onlyA = await w.image('inline', [lessonA]);
    const shared = await w.image('inline', [lessonA, lessonB]);
    const cover = await w.image('cover', []);
    const notice = randomUUID();

    value(await takedown(hideContent, 'lesson', lessonA, notice));
    await w.deliver();
    expect(await w.state(onlyA.imageId)).toEqual({ desired: 'quarantined', actual: 'active' });
    expect(w.scheduled).toHaveLength(1);
    expect(await w.service.applyForCourse(w.course.courseId)).toBe(1);
    expect(await w.state(onlyA.imageId)).toEqual({ desired: 'quarantined', actual: 'quarantined' });
    expect(await w.where(onlyA.key)).toBe('quarantine');
    expect(await w.where(shared.key)).toBe('public');
    expect(await w.where(cover.key)).toBe('public');

    value(await takedown(restoreContent, 'lesson', lessonA, notice));
    await w.deliver();
    await w.service.applyForCourse(w.course.courseId);
    expect(await w.state(onlyA.imageId)).toEqual({ desired: 'active', actual: 'active' });
    expect(await w.where(onlyA.key)).toBe('public');
  });

  it('hides every image of a hidden course, cover included', async () => {
    const w = await world();
    const inline = await w.image('inline', [w.course.lessonIds[0] as string]);
    const cover = await w.image('cover', []);
    value(await takedown(hideContent, 'course', w.course.courseId, randomUUID()));
    await w.deliver();
    expect(await w.service.applyForCourse(w.course.courseId)).toBe(2);
    expect(await w.where(inline.key)).toBe('quarantine');
    expect(await w.where(cover.key)).toBe('quarantine');
  });

  it('applies a duplicated event once: one move, one apply job', async () => {
    const w = await world();
    const image = await w.image('inline', [w.course.lessonIds[0] as string]);
    value(await takedown(hideContent, 'lesson', w.course.lessonIds[0] as string, randomUUID()));
    await w.deliver();
    const consumer = w.service.consumer();
    const [event] = (
      await s.t.pool.query<{ id: string; payload: Record<string, unknown> }>(
        `SELECT outbox_event_id AS id, payload FROM outbox_event
         WHERE event_type = 'catalog.ContentVisibilityChanged' AND aggregate_key = $1`,
        [w.course.courseId],
      )
    ).rows;
    await withTransaction(getDb(), (tx) =>
      consumer.handle(tx, {
        id: event?.id as string,
        type: 'catalog.ContentVisibilityChanged',
        version: 1,
        aggregateKey: w.course.courseId,
        occurredAt: clock.now(),
        recordedAt: clock.now(),
        producer: 'catalog',
        correlationId: 'dup',
        payload: event?.payload as never,
      }),
    );
    expect(w.scheduled).toHaveLength(1);
    await w.service.applyForCourse(w.course.courseId);
    await w.service.applyForCourse(w.course.courseId);
    expect(w.copies.n).toBe(2); // two variants, moved once
    expect(await w.where(image.key)).toBe('quarantine');
  });

  it('converges to the database state when a hide and restore are seen out of order', async () => {
    const w = await world();
    const lesson = w.course.lessonIds[0] as string;
    const image = await w.image('inline', [lesson]);
    const notice = randomUUID();
    value(await takedown(hideContent, 'lesson', lesson, notice));
    value(await takedown(restoreContent, 'lesson', lesson, notice));
    // Both events commit before either is handled: every recompute reads the database (visible),
    // never the event's action, so the hide's delivery does not quarantine anything.
    await w.deliver();
    await w.service.applyForCourse(w.course.courseId);
    expect(await w.state(image.imageId)).toEqual({ desired: 'active', actual: 'active' });
    expect(await w.where(image.key)).toBe('public');
  });

  it('finishes a half-done move left in both buckets by a crash', async () => {
    const w = await world();
    const lesson = w.course.lessonIds[0] as string;
    const image = await w.image('inline', [lesson]);
    for (const width of [400, 800])
      await w.storage.copy('public', 'quarantine', variantKey(image.key, width));
    value(await takedown(hideContent, 'lesson', lesson, randomUUID()));
    await w.deliver();
    await w.service.applyForCourse(w.course.courseId);
    expect(await w.where(image.key)).toBe('quarantine');
  });

  it('refuses an apply job whose payload is not a course ID', async () => {
    const w = await world();
    const result = await w.service
      .jobHandlers()
      ['catalog.image.applyVisibility']?.({ payload: {} });
    expect(result?.ok).toBe(false);
  });
});

describe('catalog.image.reconcile (RD-211)', () => {
  it('re-applies an image whose states have differed for more than 60 s, and only then', async () => {
    const w = await world();
    const lesson = w.course.lessonIds[0] as string;
    const image = await w.image('inline', [lesson]);
    value(await takedown(hideContent, 'lesson', lesson, randomUUID()));
    await w.deliver(); // desired = quarantined; the apply job is "lost"
    expect(await w.service.reconcile()).toBe(0);
    clock.advanceMs(61_000);
    const handlers = w.service.jobHandlers();
    const result = await handlers['catalog.image.reconcile']?.({ payload: {} });
    expect(result).toEqual({ ok: true, value: { applied: 1 } });
    expect(await w.where(image.key)).toBe('quarantine');
  });
});

describe('catalog.image.orphanSweep (RD-212)', () => {
  it('deletes only objects older than 24 h that have no row', async () => {
    const w = await world();
    const kept = await w.image('inline', []);
    const orphan = `img/${randomBytes(16).toString('base64url')}`;
    await w.storage.put('public', variantKey(orphan, 400), new Uint8Array([1]));
    await w.storage.put('quarantine', variantKey(orphan, 800), new Uint8Array([1]));
    clock.advanceMs(ORPHAN_AGE_MS + 1000);
    const young = `img/${randomBytes(16).toString('base64url')}`;
    await w.storage.put('public', variantKey(young, 400), new Uint8Array([1]));
    const result = await w.service.jobHandlers()['catalog.image.orphanSweep']?.({ payload: {} });
    expect(result).toEqual({ ok: true, value: { deleted: 2 } });
    expect(await w.storage.exists('public', variantKey(young, 400))).toBe(true);
    expect(await w.where(kept.key)).toBe('public');
  });
});

// [LT] Live classes: course staff schedule with a YouTube link; only the course's Students enter;
// attendance counts visible time; a pop-quiz sends one question per minute to everyone, takes one
// answer per question while it is open, and gives the teacher a heatmap and Students their review.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '#src/server/db.ts';
import {
  liveAttendance,
  liveClass,
  liveQuiz,
  streakActivity,
  streakShield,
} from '#src/server/schema/index.ts';
import { buildGoalInput, buildSegmentInput } from '#src/test/factories/catalog.ts';
import { createServerFnHarness, type ServerFnHarness } from '#src/test/server-fn-harness.ts';
import {
  createPublishHelper,
  type PublishedCourse,
  value,
} from '../../catalog/test-fixtures/publish-helper.ts';

let s: ServerFnHarness;
let goalId: string;
let course: PublishedCourse;

beforeAll(async () => {
  s = await createServerFnHarness();
  for (const [settingKey, v] of [
    ['catalog.coursePrice.minPoisha', 10_000],
    ['catalog.coursePrice.maxPoisha', 5_000_000],
  ] as const)
    value(
      await s.call('saveSetting', s.admin.request, { settingKey, value: v, reason: 'LT bounds' }),
    );
  value(
    await s.call('saveFlag', s.admin.request, {
      flagKey: 'commerce.fakeGateway',
      description: 'LT: fake gateway',
      state: 'on',
    }),
  );
  const { segmentId } = value<{ segmentId: string }>(
    await s.call('saveSegment', s.admin.request, buildSegmentInput()),
  );
  goalId = value<{ goalId: string }>(
    await s.call('saveGoal', s.admin.request, { ...buildGoalInput(segmentId), status: 'active' }),
  ).goalId;
  course = await createPublishHelper(s).published(goalId, { sections: 1, months: 6 });
  const { subjectId } = value<{ subjectId: string }>(
    await s.call('saveQuestionSubject', s.admin.request, {
      nameBn: 'ক',
      nameEn: 'S',
      goalIds: [goalId],
    }),
  );
  const { topicId } = value<{ topicId: string }>(
    await s.call('saveQuestionTopic', s.admin.request, { subjectId, nameBn: 'খ', nameEn: 'T' }),
  );
  for (let i = 0; i < 3; i += 1)
    value(
      await s.call('saveBankQuestionDraft', s.admin.request, {
        topicId,
        difficulty: 'easy',
        promptBn: `প্রশ্ন ${i}`,
        promptEn: `Q ${i}`,
        optionsBn: ['ক', 'খ', 'গ', 'ঘ'],
        optionsEn: ['A', 'B', 'C', 'D'],
        correctIndex: 2,
      }),
    );
}, 240_000);
afterAll(async () => {
  await s?.close();
});

const future = new Date(Date.now() + 2 * 3600_000 + 6 * 3600_000).toISOString().slice(0, 16);

describe('live classes', () => {
  it('only course staff schedule, with a real YouTube link', async () => {
    const outsider = await s.newInstructor();
    expect(
      await s.call('scheduleLiveClass', outsider.request, {
        courseId: course.courseId,
        titleBn: 'ক্লাস',
        titleEn: 'Class',
        youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
        startsAtLocal: future,
        durationMinutes: 60,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await s.call('scheduleLiveClass', course.lead.request, {
        courseId: course.courseId,
        titleBn: 'ক্লাস',
        titleEn: 'Class',
        youtubeUrl: 'https://example.com/video',
        startsAtLocal: future,
        durationMinutes: 60,
      }),
    ).toMatchObject({
      ok: false,
      error: { fieldErrors: { youtubeUrl: ['errors.live.youtubeInvalid'] } },
    });
  });

  it('runs a class: attendance, a pop-quiz, a heatmap and the review', async () => {
    const lc = value<{ liveClassId: string }>(
      await s.call('scheduleLiveClass', course.lead.request, {
        courseId: course.courseId,
        titleBn: 'লাইভ ক্লাস',
        titleEn: 'Live class',
        youtubeUrl: 'https://www.youtube.com/live/dQw4w9WgXcQ',
        startsAtLocal: future,
        durationMinutes: 60,
        keepsRecording: true,
      }),
    );
    const student = await s.newStudent();
    const checkout = value<{ paymentId: string }>(
      await s.call('startCourseCheckout', student.request, { courseId: course.courseId }),
    );
    value(
      await s.call('settleMyFakePayment', student.request, {
        paymentId: checkout.paymentId,
        outcome: 'succeed',
      }),
    );
    const stranger = await s.newStudent();
    expect(
      await s.call('getLiveRoom', stranger.request, { liveClassId: lc.liveClassId }),
    ).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    // Before the lobby opens there is no video.
    expect(
      value<{ videoId: string | null }>(
        await s.call('getLiveRoom', student.request, { liveClassId: lc.liveClassId }),
      ).videoId,
    ).toBeNull();
    // The class starts now.
    const db = getDb();
    await db
      .update(liveClass)
      .set({ startsAt: new Date(Date.now() - 60_000) })
      .where(eq(liveClass.liveClassId, lc.liveClassId));
    expect(
      value<{ videoId: string }>(
        await s.call('getLiveRoom', student.request, { liveClassId: lc.liveClassId }),
      ).videoId,
    ).toBe('dQw4w9WgXcQ');
    value(
      await s.call('sendLiveHeartbeat', student.request, {
        liveClassId: lc.liveClassId,
        isVisible: true,
      }),
    );
    await db
      .update(liveAttendance)
      .set({ lastSeenAt: new Date(Date.now() - 30_000) })
      .where(eq(liveAttendance.liveClassId, lc.liveClassId));
    value(
      await s.call('sendLiveHeartbeat', student.request, {
        liveClassId: lc.liveClassId,
        isVisible: true,
      }),
    );
    const [att] = await db
      .select()
      .from(liveAttendance)
      .where(eq(liveAttendance.liveClassId, lc.liveClassId));
    expect(att?.activeSeconds).toBeGreaterThanOrEqual(29);
    // Attending the class is the day's qualifying activity for this course (FR5.1).
    expect(
      await db.select().from(streakActivity).where(eq(streakActivity.userId, student.userId)),
    ).toMatchObject([{ courseId: course.courseId, kind: 'live' }]);

    const fired = value<{ quizId: string }>(
      await s.call('fireLiveQuiz', course.lead.request, { liveClassId: lc.liveClassId, count: 3 }),
    );
    expect(
      await s.call('fireLiveQuiz', course.lead.request, { liveClassId: lc.liveClassId, count: 3 }),
    ).toMatchObject({
      ok: false,
      error: { i18nKey: 'errors.live.quizRunning' },
    });
    const room = value<{
      quiz: {
        index: number;
        total: number;
        question: Record<string, unknown> & { questionId: string };
      };
    }>(await s.call('getLiveRoom', student.request, { liveClassId: lc.liveClassId }));
    expect(room.quiz).toMatchObject({ index: 0, total: 3 });
    expect(room.quiz.question).not.toHaveProperty('correctIndex');
    const q0 = room.quiz.question.questionId;
    expect(
      value<{ saved: boolean }>(
        await s.call('answerLiveQuestion', student.request, {
          quizId: fired.quizId,
          questionId: q0,
          chosenIndex: 2,
        }),
      ).saved,
    ).toBe(true);
    expect(
      value<{ saved: boolean }>(
        await s.call('answerLiveQuestion', student.request, {
          quizId: fired.quizId,
          questionId: q0,
          chosenIndex: 0,
        }),
      ).saved,
    ).toBe(false);

    // The quiz ends.
    await db
      .update(liveQuiz)
      .set({ startedAt: new Date(Date.now() - 4 * 60_000) })
      .where(eq(liveQuiz.quizId, fired.quizId));
    expect(
      await s.call('answerLiveQuestion', student.request, {
        quizId: fired.quizId,
        questionId: q0,
        chosenIndex: 2,
      }),
    ).toMatchObject({ ok: false, error: { i18nKey: 'errors.live.questionClosed' } });
    const after = value<{
      quiz: {
        phase: string;
        myScore: number;
        earnedShield: boolean;
        review: Array<{ correctIndex: number }>;
      };
    }>(await s.call('getLiveRoom', student.request, { liveClassId: lc.liveClassId }));
    // US5.6: a score above 0 in the top N earns one streak-shield, handed out once.
    expect(after.quiz).toMatchObject({ phase: 'over', myScore: 1, earnedShield: true });
    expect(after.quiz.review).toHaveLength(3);
    const control = value<{
      joined: number;
      quizzes: Array<{
        shieldWinners: number;
        heatmap: Array<{ answered: number; percent: number | null }>;
      }>;
    }>(await s.call('getLiveControl', course.lead.request, { liveClassId: lc.liveClassId }));
    expect(control.joined).toBe(1);
    // US6.3: the teacher sees each attendee with join, last-seen and visible-tab time.
    const { attendees } = control as unknown as {
      attendees: Array<{ firstJoinAt: string; lastSeenAt: string; activeMinutes: number }>;
    };
    expect(attendees).toHaveLength(1);
    expect(attendees[0]?.activeMinutes).toBeGreaterThanOrEqual(0);
    expect(control.quizzes[0]?.shieldWinners).toBe(1);
    const shields = await db
      .select()
      .from(streakShield)
      .where(eq(streakShield.userId, student.userId));
    expect(shields).toMatchObject([{ source: 'live_quiz', sourceRef: fired.quizId }]);
    expect(
      value<{ streak: { shieldsAvailable: number } }>(
        await s.call('getMyStreakRewards', student.request, {}),
      ).streak.shieldsAvailable,
    ).toBe(1);
    expect(control.quizzes[0]?.heatmap.map((h) => [h.answered, h.percent])).toEqual([
      [1, 100],
      [0, null],
      [0, null],
    ]);
  });
});

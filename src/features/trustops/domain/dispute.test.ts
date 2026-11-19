// [UT] US9.3 evidence pack assembly and US9.4 export rows.
import { describe, expect, it } from 'vitest';
import { buildEvidencePack, type EvidenceInput, packRows } from './dispute.ts';

const base: EvidenceInput = {
  payment: {
    paymentId: 'p1',
    amountPoisha: 100_000,
    status: 'succeeded',
    gatewayRef: 'fake-p1',
    createdAt: '2027-02-01T04:00:00.000Z',
    settledAt: '2027-02-01T04:01:00.000Z',
  },
  enrolment: {
    enrolmentId: 'e1',
    startsAt: '2027-02-01T04:01:00.000Z',
    endsAt: '2027-08-01T04:01:00.000Z',
    status: 'active',
  },
  course: { courseId: 'c1', title: 'BCS Maths' },
  lessons: [
    { lessonId: 'v1', kind: 'video', title: 'Fractions' },
    { lessonId: 't1', kind: 'text', title: 'Notes' },
    { lessonId: 'q1', kind: 'quiz', title: 'Quiz 1' },
  ],
  completions: [
    { lessonId: 't1', at: '2027-02-03T10:00:00.000Z' },
    { lessonId: 'v1', at: '2027-02-02T10:00:00.000Z' },
  ],
  quizAttempts: [{ lessonId: 'q1', score: 7, total: 10, at: '2027-02-04T10:00:00.000Z' }],
};

describe('buildEvidencePack', () => {
  it('AC9.3.1: holds the payment, enrolment, access log, video views, quiz scores and summary', () => {
    const pack = buildEvidencePack(base);
    expect(pack.payment.paymentId).toBe('p1');
    expect(pack.enrolment?.enrolmentId).toBe('e1');
    expect(pack.accessLog.map((a) => a.lessonId)).toEqual(['v1', 't1']);
    expect(pack.videoViews).toEqual([
      { at: '2027-02-02T10:00:00.000Z', lessonId: 'v1', title: 'Fractions' },
    ]);
    expect(pack.quizScores[0]).toMatchObject({ score: 7, total: 10, title: 'Quiz 1' });
    expect(pack.summary).toEqual({
      hasActivity: true,
      lessonsCompleted: 2,
      videosWatched: 1,
      quizzesTaken: 1,
      firstActivityAt: '2027-02-02T10:00:00.000Z',
      lastActivityAt: '2027-02-04T10:00:00.000Z',
    });
  });
  it('AC9.3.3: with no activity the pack is still produced and says so', () => {
    const pack = buildEvidencePack({ ...base, enrolment: null, completions: [], quizAttempts: [] });
    expect(pack.summary).toMatchObject({ hasActivity: false, firstActivityAt: null });
    expect(packRows(pack, '2027-02-05T00:00:00.000Z').at(-1)?.item).toBe('no activity recorded');
  });
  it('marks a lesson no longer in the course as unknown', () => {
    const pack = buildEvidencePack({ ...base, lessons: [] });
    expect(pack.accessLog.every((a) => a.kind === 'unknown')).toBe(true);
    expect(pack.videoViews).toEqual([]);
  });
});

describe('packRows (US9.4)', () => {
  it('starts with the lock timestamp and has a row per section item', () => {
    const rows = packRows(buildEvidencePack(base), '2027-02-05T00:00:00.000Z');
    expect(rows[0]).toEqual({
      section: 'lock',
      item: 'lockedAt',
      detail: '',
      at: '2027-02-05T00:00:00.000Z',
    });
    expect(rows.map((r) => r.section)).toEqual([
      'lock',
      'payment',
      'enrolment',
      'access',
      'access',
      'video',
      'quiz',
      'summary',
    ]);
  });
});

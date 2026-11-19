// Payment dispute evidence packs (US9.3, US9.4). Plain TypeScript: the pack is assembled from the
// payment, its enrolment and the Student's own activity in the course, then locked by the service.

export type PackLesson = {
  lessonId: string;
  kind: 'video' | 'text' | 'quiz' | 'unknown';
  title: string;
};

export type EvidenceInput = {
  payment: {
    paymentId: string;
    amountPoisha: number;
    status: string;
    gatewayRef: string | null;
    createdAt: string;
    settledAt: string | null;
  };
  enrolment: { enrolmentId: string; startsAt: string; endsAt: string; status: string } | null;
  course: { courseId: string; title: string };
  lessons: readonly PackLesson[];
  completions: ReadonlyArray<{ lessonId: string; at: string }>;
  quizAttempts: ReadonlyArray<{ lessonId: string; score: number; total: number; at: string }>;
};

export type EvidencePack = {
  payment: EvidenceInput['payment'];
  enrolment: EvidenceInput['enrolment'];
  course: EvidenceInput['course'];
  /** Every lesson the Student opened to completion, in time order. */
  accessLog: Array<{ at: string; lessonId: string; title: string; kind: PackLesson['kind'] }>;
  /** The video lessons among them. */
  videoViews: Array<{ at: string; lessonId: string; title: string }>;
  quizScores: Array<{ at: string; lessonId: string; title: string; score: number; total: number }>;
  summary: {
    hasActivity: boolean;
    lessonsCompleted: number;
    videosWatched: number;
    quizzesTaken: number;
    firstActivityAt: string | null;
    lastActivityAt: string | null;
  };
};

/** AC9.3.1 / AC9.3.3: the pack's sections; with no activity the summary says so. */
export function buildEvidencePack(input: EvidenceInput): EvidencePack {
  const lessons = new Map(input.lessons.map((l) => [l.lessonId, l]));
  const lessonOf = (lessonId: string) =>
    lessons.get(lessonId) ?? { lessonId, kind: 'unknown' as const, title: '' };
  const accessLog = [...input.completions]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((c) => {
      const l = lessonOf(c.lessonId);
      return { at: c.at, lessonId: c.lessonId, title: l.title, kind: l.kind };
    });
  const videoViews = accessLog
    .filter((a) => a.kind === 'video')
    .map(({ at, lessonId, title }) => ({ at, lessonId, title }));
  const quizScores = [...input.quizAttempts]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((q) => ({ ...q, title: lessonOf(q.lessonId).title }));
  const times = [...accessLog.map((a) => a.at), ...quizScores.map((q) => q.at)].sort();
  return {
    payment: input.payment,
    enrolment: input.enrolment,
    course: input.course,
    accessLog,
    videoViews,
    quizScores,
    summary: {
      hasActivity: times.length > 0,
      lessonsCompleted: accessLog.length,
      videosWatched: videoViews.length,
      quizzesTaken: quizScores.length,
      firstActivityAt: times[0] ?? null,
      lastActivityAt: times[times.length - 1] ?? null,
    },
  };
}

/** The pack as rows for export (one row per item), section by section. */
export function packRows(
  pack: EvidencePack,
  lockedAt: string,
): Array<{ section: string; item: string; detail: string; at: string }> {
  const rows: Array<{ section: string; item: string; detail: string; at: string }> = [
    { section: 'lock', item: 'lockedAt', detail: '', at: lockedAt },
    {
      section: 'payment',
      item: pack.payment.paymentId,
      detail:
        `${pack.payment.status} ${pack.payment.amountPoisha} poisha ${pack.payment.gatewayRef ?? ''}`.trim(),
      at: pack.payment.settledAt ?? pack.payment.createdAt,
    },
    {
      section: 'enrolment',
      item: pack.enrolment?.enrolmentId ?? 'none',
      detail: pack.enrolment ? `${pack.enrolment.status} until ${pack.enrolment.endsAt}` : '',
      at: pack.enrolment?.startsAt ?? '',
    },
    ...pack.accessLog.map((a) => ({
      section: 'access',
      item: a.lessonId,
      detail: `${a.kind} ${a.title}`.trim(),
      at: a.at,
    })),
    ...pack.videoViews.map((v) => ({
      section: 'video',
      item: v.lessonId,
      detail: v.title,
      at: v.at,
    })),
    ...pack.quizScores.map((q) => ({
      section: 'quiz',
      item: q.lessonId,
      detail: `${q.score}/${q.total} ${q.title}`.trim(),
      at: q.at,
    })),
    {
      section: 'summary',
      item: pack.summary.hasActivity ? 'activity' : 'no activity recorded',
      detail: `lessons ${pack.summary.lessonsCompleted}, videos ${pack.summary.videosWatched}, quizzes ${pack.summary.quizzesTaken}`,
      at: pack.summary.lastActivityAt ?? '',
    },
  ];
  return rows;
}

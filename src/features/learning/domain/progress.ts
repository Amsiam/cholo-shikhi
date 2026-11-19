// Course progress and lesson navigation. Plain TypeScript: no framework, DB or env access.

export type CourseProgress = {
  completed: number;
  total: number;
  /** Whole percent, rounded down so 100 means every lesson is done. */
  percent: number;
  /** The first lesson in course order not yet completed; null when all are done or none exist. */
  nextLessonId: string | null;
};

/** Progress over the course's lessons in outline order. Completions of removed lessons don't count. */
export function courseProgress(
  orderedLessonIds: readonly string[],
  completedLessonIds: ReadonlySet<string>,
): CourseProgress {
  const total = orderedLessonIds.length;
  const completed = orderedLessonIds.filter((id) => completedLessonIds.has(id)).length;
  const nextLessonId = orderedLessonIds.find((id) => !completedLessonIds.has(id)) ?? null;
  return {
    completed,
    total,
    percent: total === 0 ? 0 : Math.floor((completed * 100) / total),
    nextLessonId,
  };
}

/** The lessons before and after one lesson in course order, across section boundaries. */
export function lessonNeighbours(
  orderedLessonIds: readonly string[],
  lessonId: string,
): { previousLessonId: string | null; nextLessonId: string | null } {
  const index = orderedLessonIds.indexOf(lessonId);
  if (index < 0) return { previousLessonId: null, nextLessonId: null };
  return {
    previousLessonId: orderedLessonIds[index - 1] ?? null,
    nextLessonId: orderedLessonIds[index + 1] ?? null,
  };
}

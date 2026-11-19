// MCQ grading. The correct answers live only on the server; the client sends chosen indexes and
// gets back the grade. Plain TypeScript: no framework, DB or env access.

export type GradableQuestion = { questionId: string; correctIndex: number };
export type SubmittedAnswer = { questionId: string; chosenIndex: number | null };

export type GradedAnswer = {
  questionId: string;
  chosenIndex: number | null;
  correctIndex: number;
  isCorrect: boolean;
};

export type QuizGrade = { score: number; total: number; answers: GradedAnswer[] };

/**
 * Grades every question of the quiz in its order. A question the Student skipped, or answered with
 * an index outside 0–3, is wrong. Answers for unknown questions are ignored, and only the first
 * answer per question counts, so a crafted request cannot raise the score.
 */
export function gradeQuiz(
  questions: readonly GradableQuestion[],
  submitted: readonly SubmittedAnswer[],
): QuizGrade {
  const chosen = new Map<string, number | null>();
  for (const answer of submitted) {
    if (!chosen.has(answer.questionId)) chosen.set(answer.questionId, answer.chosenIndex);
  }
  const answers = questions.map((q) => {
    const raw = chosen.get(q.questionId) ?? null;
    const chosenIndex = raw !== null && Number.isInteger(raw) && raw >= 0 && raw <= 3 ? raw : null;
    return {
      questionId: q.questionId,
      chosenIndex,
      correctIndex: q.correctIndex,
      isCorrect: chosenIndex !== null && chosenIndex === q.correctIndex,
    };
  });
  return {
    score: answers.filter((a) => a.isCorrect).length,
    total: questions.length,
    answers,
  };
}

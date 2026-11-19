// Route-level adapter for the dashboard's learning counts. Active enrolments come from commerce;
// "questions in your vault" counts the distinct quiz questions the Student has answered wrongly,
// which is what the Mistake Vault (U5) will hold once it ships.
import { getMyLearningSummary } from '#src/features/learning/server/learning.functions.ts';

export async function getLearningCounts(): Promise<{ enrolled: number; vaultQuestions: number }> {
  const result = await getMyLearningSummary({ data: {} });
  return result.ok
    ? { enrolled: result.value.enrolled, vaultQuestions: result.value.wrongAnswers }
    : { enrolled: 0, vaultQuestions: 0 };
}

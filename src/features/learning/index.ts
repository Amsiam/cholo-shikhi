// Learning public surface for other units. Server-only, in-process functions.

export { type NpsSummary, npsOf } from './domain/nps.ts';
export { type CourseActivity, courseActivityOf } from './server/evidence.server.ts';
export { countWrongAnswers, courseNpsScores } from './server/learning.server.ts';
export {
  type CourseLearningStats,
  courseLearningStats,
} from './server/learning-stats.server.ts';
export {
  awardQuizShields,
  battleEntryTokens,
  lockTokenAccount,
  recordLiveActivity,
  refundTokens,
  shieldTopN,
  spendTokens,
  tokenBalance,
} from './server/streak.server.ts';
export { activeVaultBankQuestionIds, recordBankMistake } from './server/vault.server.ts';

// U4 Assessment public surface for other units (Learning: topic practice and Mistake Vault).
// Server-only, in-process functions.
export type { Difficulty } from './domain/bank.ts';
export {
  AttemptRef,
  CreateCustomExamInput,
  ExamRef,
  ExploreInput,
  SaveExamAnswerInput,
} from './server/bank.schema.ts';
export {
  bankQuestionsByIds,
  practiceCatalogFor,
  practiceQuestionsFor,
  recordBankAnswer,
  type StudentQuestion,
  similarBankQuestion,
  topicNamesOf,
  toStudentQuestion,
} from './server/bank.server.ts';
export {
  type AttemptSheet,
  battleQuestionPool,
  closeExpiredAttempts,
  createCustomExam,
  type ExamGrants,
  type ExamHistoryItem,
  type ExamResult,
  type ExploredQuestion,
  ensurePackageExams,
  examResult,
  exploreQuestions,
  markAttemptsSettled,
  myExamHistory,
  type StudentExamCard,
  saveExamAnswer,
  settleableAttempts,
  startExamAttempt,
  studentExams,
  submitExamAttempt,
  topicFamilyOf,
} from './server/exam.server.ts';

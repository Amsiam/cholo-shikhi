// Inputs of the question bank server functions.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';
import { DIFFICULTIES } from '../domain/bank.ts';

const name80 = z.string().trim().min(1).max(80);
const name120 = z.string().trim().min(1).max(120);

export const SaveSubjectInput = z.object({
  subjectId: Id.optional(),
  nameBn: name80,
  nameEn: name80,
  sortOrder: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
  goalIds: z.array(Id).max(50).default([]),
});
export type SaveSubjectInput = z.input<typeof SaveSubjectInput>;

export const SaveTopicInput = z.object({
  topicId: Id.optional(),
  subjectId: Id,
  parentTopicId: Id.nullable().optional(),
  nameBn: name120,
  nameEn: name120,
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type SaveTopicInput = z.input<typeof SaveTopicInput>;

export const BankListInput = z.object({
  subjectId: Id.optional(),
  topicId: Id.optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  status: z.enum(['draft', 'in_review', 'published', 'rejected', 'retired']).optional(),
  mine: z.boolean().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.number().int().min(1).max(10_000).default(1),
});
export type BankListInput = z.input<typeof BankListInput>;

export const SaveBankQuestionInput = z.object({
  questionId: Id.optional(),
  expectedVersion: z.number().int().min(1).optional(),
  topicId: Id,
  difficulty: z.enum(DIFFICULTIES),
  promptBn: z.string().max(2000),
  promptEn: z.string().max(2000),
  optionsBn: z.array(z.string().max(600)).max(4),
  optionsEn: z.array(z.string().max(600)).max(4),
  correctIndex: z.number().int(),
  explanationBn: z.string().max(2000).default(''),
  explanationEn: z.string().max(2000).default(''),
  sourceNote: z.string().max(240).default(''),
});
export type SaveBankQuestionInput = z.input<typeof SaveBankQuestionInput>;

export const ReviewBankInput = z.object({
  questionId: Id,
  expectedVersion: z.number().int().min(1),
  action: z.enum(['submit', 'approve', 'reject', 'retire', 'restore']),
  note: z.string().max(1000).optional(),
});
export type ReviewBankInput = z.input<typeof ReviewBankInput>;

export const BankQuestionRef = z.object({ questionId: Id });
export type BankQuestionRef = z.input<typeof BankQuestionRef>;

export const NoInput = z.object({});

// ----------------------------------------------------------------- exams

const BlueprintRowInput = z.object({
  topicId: Id,
  difficulty: z.enum(DIFFICULTIES).nullable(),
  count: z.number().int().min(1).max(100),
});

export const SaveExamInput = z.object({
  examId: Id.optional(),
  expectedVersion: z.number().int().min(1).optional(),
  kind: z.enum(['mock', 'live']),
  titleBn: z.string().trim().min(1).max(150),
  titleEn: z.string().trim().min(1).max(150),
  goalId: Id,
  durationMinutes: z.number().int().min(1).max(300),
  negativeBps: z.number().int().min(0).max(10_000),
  /** Live exams: Asia/Dhaka local start, "YYYY-MM-DDTHH:mm". */
  startsAtLocal: z.string().max(16).optional(),
  blueprint: z.array(BlueprintRowInput).min(1).max(30),
});
export type SaveExamInput = z.input<typeof SaveExamInput>;

export const ExamVersionRef = z.object({ examId: Id, expectedVersion: z.number().int().min(1) });
export type ExamVersionRef = z.input<typeof ExamVersionRef>;

export const ExamRef = z.object({ examId: Id });
export type ExamRef = z.input<typeof ExamRef>;

export const CreateCustomExamInput = z.object({
  topicIds: z.array(Id).min(1).max(10),
  difficulty: z.enum(DIFFICULTIES).optional(),
  count: z.number().int().min(5).max(100),
  durationMinutes: z.number().int().min(5).max(180),
  negativeBps: z.union([z.literal(0), z.literal(2500), z.literal(5000)]),
});
export type CreateCustomExamInput = z.input<typeof CreateCustomExamInput>;

export const AttemptRef = z.object({ attemptId: Id });
export type AttemptRef = z.input<typeof AttemptRef>;

export const SaveExamAnswerInput = z.object({
  attemptId: Id,
  questionId: Id,
  chosenIndex: z.number().int().min(0).max(3).nullable(),
});
export type SaveExamAnswerInput = z.input<typeof SaveExamAnswerInput>;

export const AttachExamInput = z.object({
  examId: Id,
  expectedVersion: z.number().int().min(1),
  courseId: Id.nullable(),
});
export type AttachExamInput = z.input<typeof AttachExamInput>;

export const ExploreInput = z.object({
  topicId: Id,
  difficulty: z.enum(DIFFICULTIES).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.number().int().min(1).max(10_000).default(1),
});
export type ExploreInput = z.input<typeof ExploreInput>;

/** US4.7: a past-paper CSV, as text (UTF-8; up to about 2 MB). */
export const ImportPastPapersInput = z.object({ csv: z.string().min(1).max(2_000_000) });
export type ImportPastPapersInput = z.input<typeof ImportPastPapersInput>;

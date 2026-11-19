// One Zod schema per product read and mutation, shared by the A12 / A9 / I1 forms and the server
// functions (team.md Validation). The schemas fix shapes and bounds; the rules that need data (the
// ceiling, the Goal, item eligibility, who may act, the question check) are the domain's. Prices are
// taka strings in Latin or Bangla digits, parsed exactly to poisha by pricing.ts (BR5.1).
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';
import { MAX_PRODUCT_PAGE } from '../data/products.repository.ts';
import { MAX_EXAM_QUESTIONS, MAX_PACK_QUESTION_SETS, MAX_PLAN_ITEMS } from '../domain/products.ts';

const Version = z.number().int().min(1);
/** Long enough for any taka string the grammar accepts; the grammar itself is BR5.1's. */
const Price = z.string().max(32);
/** The domain trims and checks the BR3.1 rules; the schema only bounds the size. */
const Title = z.string().max(300);
const Description = z.string().max(10_000);

export const ProductPageInput = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PRODUCT_PAGE).default(20),
});
export type ProductPageInput = z.input<typeof ProductPageInput>;

/** UC17 (BR10.2, BR10.11): create (no examPackageId) or edit the draft fields of a package. */
export const SaveExamPackageInput = z.object({
  examPackageId: Id.optional(),
  expectedVersion: Version.optional(),
  goalId: Id,
  titleBn: Title,
  titleEn: Title,
  descriptionBn: Description.optional(),
  descriptionEn: Description.optional(),
  price: Price,
  questionIds: z.array(Id).max(MAX_EXAM_QUESTIONS).default([]),
  timeLimitMinutes: z.number().int().nullable().default(null),
});
export type SaveExamPackageInput = z.input<typeof SaveExamPackageInput>;

export const ExamPackageTransitionInput = z.object({ examPackageId: Id, expectedVersion: Version });
export type ExamPackageTransitionInput = z.input<typeof ExamPackageTransitionInput>;

/** UC18 (BR10.1, BR10.5, BR10.11): create or edit a plan's draft names, price and items. */
export const SavePlanInput = z.object({
  planId: Id.optional(),
  expectedVersion: Version.optional(),
  goalId: Id,
  nameBn: Title,
  nameEn: Title,
  monthlyPrice: Price,
  courseIds: z.array(Id).max(MAX_PLAN_ITEMS).default([]),
  examPackageIds: z.array(Id).max(MAX_PLAN_ITEMS).default([]),
});
export type SavePlanInput = z.input<typeof SavePlanInput>;

export const PlanTransitionInput = z.object({ planId: Id, expectedVersion: Version });
export type PlanTransitionInput = z.input<typeof PlanTransitionInput>;

/** A9 item picker: the published courses and exam packages of the plan's Goal. */
export const PlanCandidatesInput = z.object({ goalId: Id });
export type PlanCandidatesInput = z.input<typeof PlanCandidatesInput>;

/** UC19 (BR10.9): the Lead creates or edits a pack of a published course. */
export const SavePracticePackInput = z.object({
  practicePackId: Id.optional(),
  expectedVersion: Version.optional(),
  courseId: Id,
  titleBn: Title,
  titleEn: Title,
  price: Price,
  questionSetIds: z.array(Id).max(MAX_PACK_QUESTION_SETS).default([]),
});
export type SavePracticePackInput = z.input<typeof SavePracticePackInput>;

export const PracticePackTransitionInput = z.object({
  practicePackId: Id,
  expectedVersion: Version,
});
export type PracticePackTransitionInput = z.input<typeof PracticePackTransitionInput>;

export const CoursePacksInput = z.object({ courseId: Id });
export type CoursePacksInput = z.input<typeof CoursePacksInput>;

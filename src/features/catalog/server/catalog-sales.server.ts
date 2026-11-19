// Reads other units need to sell and deliver Practice Packs, exam packages and plans: names for the
// receipt, a pack's mock tests, and a published exam package's frozen questions. In-process only.
import { Id } from '#src/lib/ids.ts';
import { getDb } from '#src/server/db.ts';
import { createProductRepository } from '../data/products.repository.ts';
import type { ProductRef } from './catalog-contract.server.ts';

const products = createProductRepository();

export type ProductDetails = {
  titleBn: string;
  titleEn: string;
  /** A Practice Pack's course. */
  courseId: string | null;
};

/** Names (and a pack's course) of a non-course product, or null when it does not exist. */
export async function productDetails(product: ProductRef): Promise<ProductDetails | null> {
  if (!Id.safeParse(product.id).success) return null;
  const db = getDb();
  switch (product.type) {
    case 'practice_pack': {
      const row = await products.getPack(db, product.id);
      return row ? { titleBn: row.titleBn, titleEn: row.titleEn, courseId: row.courseId } : null;
    }
    case 'exam_package': {
      const row = await products.getExam(db, product.id);
      return row ? { titleBn: row.titleBn, titleEn: row.titleEn, courseId: null } : null;
    }
    case 'subscription_plan': {
      const row = await products.getPlan(db, product.id);
      return row ? { titleBn: row.nameBn, titleEn: row.nameEn, courseId: null } : null;
    }
    default:
      return null;
  }
}

/** Published packs and their mock tests (the exam IDs their "question sets" name). */
export async function publishedPackContents(): Promise<
  Array<{ practicePackId: string; courseId: string; examIds: string[] }>
> {
  const rows = await products.listPublishedPackContents(getDb());
  return rows.map((r) => ({
    practicePackId: r.practicePackId,
    courseId: r.courseId,
    examIds: r.questionSetIds,
  }));
}

export type ExamPackageContent = {
  examPackageId: string;
  versionId: string;
  goalId: string;
  titleBn: string;
  titleEn: string;
  questionIds: string[];
  timeLimitMinutes: number;
};

/** A published exam package's current version: its frozen questions and time limit. */
export async function examPackageContent(
  examPackageId: string,
): Promise<ExamPackageContent | null> {
  if (!Id.safeParse(examPackageId).success) return null;
  const db = getDb();
  const row = await products.getExam(db, examPackageId);
  if (row?.status !== 'published' || !row.currentVersionId) return null;
  const version = await products.getExamVersion(db, row.currentVersionId);
  if (!version) return null;
  return {
    examPackageId: row.examPackageId,
    versionId: version.examPackageVersionId,
    goalId: row.goalId,
    titleBn: row.titleBn,
    titleEn: row.titleEn,
    questionIds: version.questionIds,
    timeLimitMinutes: version.timeLimitMinutes,
  };
}

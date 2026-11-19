// The A12, A9 and I1 product row shapes, shared by the product service and the screens. Type-only.
import type { ProductStatus } from '../domain/products.ts';

export type ExamPackageAdminRow = {
  examPackageId: string;
  goalId: string;
  titleBn: string;
  titleEn: string;
  descriptionBn: string | null;
  descriptionEn: string | null;
  listPricePoisha: number;
  status: ProductStatus;
  questionIds: string[];
  timeLimitMinutes: number | null;
  hasUnpublishedChanges: boolean;
  hasCurrentVersion: boolean;
  pinRank: number | null;
  version: number;
};

export type PlanAdminRow = {
  planId: string;
  goalId: string;
  nameBn: string;
  nameEn: string;
  monthlyPricePoisha: number | null;
  status: ProductStatus;
  courseIds: string[];
  examPackageIds: string[];
  hasUnpublishedChanges: boolean;
  hasCurrentVersion: boolean;
  pinRank: number | null;
  version: number;
};

export type PracticePackRowView = {
  practicePackId: string;
  courseId: string;
  titleBn: string;
  titleEn: string;
  listPricePoisha: number;
  questionSetIds: string[];
  status: ProductStatus;
  version: number;
};

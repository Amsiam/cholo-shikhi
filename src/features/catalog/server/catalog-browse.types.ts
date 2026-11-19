// The S3 and S4 read shapes (UC5, UC6), shared by the read module and the screens. Type-only.
import type { LessonDocument } from '../domain/lesson-document.ts';
import type { CatalogServedTab } from './catalog-browse.schema.ts';

export type CourseCard = {
  kind: 'course';
  courseId: string;
  titleBn: string;
  titleEn: string;
  listPricePoisha: number;
  accessDurationMonths: number;
  isPinned: boolean;
};

/** BR11.1: an exam package on the Exam packages tab (never expires, so no duration). */
export type ExamPackageCard = {
  kind: 'exam_package';
  examPackageId: string;
  titleBn: string;
  titleEn: string;
  listPricePoisha: number;
  isPinned: boolean;
};

/** BR11.2: a plan card at the top of the Courses tab, priced per month (current version). */
export type PlanCard = {
  kind: 'plan';
  planId: string;
  nameBn: string;
  nameEn: string;
  monthlyPricePoisha: number;
  isPinned: boolean;
};

export type CatalogCard = CourseCard | ExamPackageCard | PlanCard;

/** BR11.8: a published Practice Pack of a published course, a separate item on S4. */
export type PracticePackItem = {
  practicePackId: string;
  titleBn: string;
  titleEn: string;
  listPricePoisha: number;
};

export type CatalogPage = {
  goal: { goalId: string; segmentId: string };
  tab: CatalogServedTab;
  items: CatalogCard[];
  nextCursor: string | null;
  /** The tabs that have items for this Goal, for the empty-tab link (BR11.6). */
  tabsWithItems: CatalogServedTab[];
  /** BR11.3: the Bundles tab renders only while catalog.bundlesTab is on. */
  isBundlesTabEnabled: boolean;
};

export type CoursePage = {
  courseId: string;
  goal: { goalId: string; nameBn: string; nameEn: string };
  /** False when the course was opened by URL from another Goal (UC6 E1). */
  isCurrentGoal: boolean;
  titleBn: string;
  titleEn: string;
  descriptionBn: string | null;
  descriptionEn: string | null;
  listPricePoisha: number;
  accessDurationMonths: number;
  /** Images stay placeholders while catalog.imageUploads is off (BR11.9). */
  hasCoverImage: boolean;
  instructors: Array<{
    instructorId: string;
    role: 'lead' | 'co_instructor';
    displayName: string;
    sections: Array<{ sectionId: string; titleBn: string; titleEn: string }>;
  }>;
  outline: Array<{
    sectionId: string;
    titleBn: string;
    titleEn: string;
    lessons: Array<{
      lessonId: string;
      kind: 'video' | 'text' | 'quiz';
      titleBn: string | null;
      titleEn: string | null;
      /** US4.13: set on a streak-only bonus quiz (the streak days it needs). */
      streakBonusDays: number | null;
    }>;
  }>;
  /** Published Practice Packs of this course (BR11.8). */
  practicePacks: PracticePackItem[];
};

/** One finder page: a Goal's published courses matching the search, with the page links' total. */
export type CourseSearchPage = {
  goal: { goalId: string; nameBn: string; nameEn: string };
  query: string | null;
  items: CourseCard[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/** One live lesson for the enrolled Student's player. Bodies are validated lesson documents. */
export type PublishedLesson = {
  lessonId: string;
  /** The live lesson version: its quiz questions are the ones the Student answers. */
  lessonVersionId: string;
  sectionId: string;
  kind: 'video' | 'text' | 'quiz';
  titleBn: string | null;
  titleEn: string | null;
  bodyBn: LessonDocument | null;
  bodyEn: LessonDocument | null;
  youtubeVideoId: string | null;
  /** US4.13: set on a streak-only bonus quiz (the streak days it needs). */
  streakBonusDays: number | null;
};

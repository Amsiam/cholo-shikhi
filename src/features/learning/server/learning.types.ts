// The learning area's read shapes, shared by the service and the screens. Type-only.
import type { LessonDocument } from '#src/features/catalog/index.ts';
import type { CourseProgress } from '../domain/progress.ts';

export type Bilingual = { titleBn: string | null; titleEn: string | null };

/** A free trial's state (FR-DIST-1): days left, open lessons used, and whether it has run out. */
export type TrialView = {
  daysLeft: number;
  lessonsUsed: number;
  lessonLimit: number;
  isExpired: boolean;
};

export type MyCourse = {
  courseId: string;
  titleBn: string;
  titleEn: string;
  goal: { nameBn: string; nameEn: string };
  endsAt: string;
  progress: CourseProgress;
  /** Set for a free trial course; null for a paid enrolment. */
  trial: TrialView | null;
  /** When the Student last finished a lesson or took a quiz here (continue where you left off). */
  lastActiveAt: string | null;
  /** The next unfinished lesson, for the continue card. */
  nextLesson: {
    lessonId: string;
    kind: 'video' | 'text' | 'quiz';
    titleBn: string;
    titleEn: string;
  } | null;
};

export type LearningOutlineLesson = Bilingual & {
  lessonId: string;
  kind: 'video' | 'text' | 'quiz';
  isCompleted: boolean;
  /** Outside the free trial's open lessons (or the trial has run out). */
  isLocked: boolean;
  /** US4.13: a streak-only bonus quiz's streak in days, else null. */
  streakBonusDays: number | null;
  /** The bonus quiz is locked: the Student's streak is shorter than it needs. */
  isBonusLocked: boolean;
};

export type LearningCourse = {
  courseId: string;
  titleBn: string;
  titleEn: string;
  goal: { nameBn: string; nameEn: string };
  endsAt: string;
  /** Set when the Student is on a free trial: only the open lessons can be studied. */
  trial: TrialView | null;
  progress: CourseProgress;
  /** The course is complete and the Student has not yet answered (or skipped) the NPS question. */
  askNps: boolean;
  instructors: Array<{ instructorId: string; displayName: string; role: 'lead' | 'co_instructor' }>;
  sections: Array<{
    sectionId: string;
    titleBn: string;
    titleEn: string;
    lessons: LearningOutlineLesson[];
  }>;
};

/** A question as the Student sees it before submitting: no correct answer. */
export type QuizQuestionView = {
  questionId: string;
  position: number;
  promptBn: string;
  promptEn: string;
  optionsBn: string[];
  optionsEn: string[];
};

export type QuizResult = {
  score: number;
  total: number;
  submittedAt: string;
  answers: Array<{
    questionId: string;
    chosenIndex: number | null;
    correctIndex: number;
    isCorrect: boolean;
    explanationBn: string | null;
    explanationEn: string | null;
  }>;
};

export type LessonView = Bilingual & {
  courseId: string;
  courseTitleBn: string;
  courseTitleEn: string;
  lessonId: string;
  kind: 'video' | 'text' | 'quiz';
  sectionTitleBn: string;
  sectionTitleEn: string;
  /** 1-based position in the whole course, and the course's lesson count. */
  number: number;
  lessonCount: number;
  bodyBn: LessonDocument | null;
  bodyEn: LessonDocument | null;
  youtubeVideoId: string | null;
  isCompleted: boolean;
  previousLessonId: string | null;
  nextLessonId: string | null;
  questions: QuizQuestionView[];
  lastResult: QuizResult | null;
  progress: CourseProgress;
  /**
   * US3.12: for a video lesson, the Student's viewer badge, how often it moves, and whether the
   * one-time explanation is still to be shown; null for other lessons.
   */
  viewer: { badge: string; badgeSeconds: number; showNotice: boolean } | null;
  /** US4.13: set while a streak-only bonus quiz is locked (no questions are sent). */
  bonusLock: { needed: number; current: number } | null;
};

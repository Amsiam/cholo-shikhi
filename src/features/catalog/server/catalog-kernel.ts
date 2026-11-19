// The shared core of the Catalog services: the write wrapper (rate limit, one transaction, refusal
// rollback and the one refusal log line), the locked load with the caller's derived course role, and
// the repositories. createCatalog builds it once and hands it to the content and publish services, so
// every write follows the same lock order and refusal path (PD-209, BR6.10, BR12.2, NFR6.203).
import type { Actor } from '#src/features/identity-access/index.ts';
import type { AppError } from '#src/lib/errors.ts';
import type { Result } from '#src/lib/result.ts';
import type { TxHandle } from '#src/lib/tx.ts';
import type { Executor } from '#src/server/db.ts';
import type { BlockedDomainRepository } from '../data/blocked-domain.repository.ts';
import type { CourseRepository, CourseRow } from '../data/course.repository.ts';
import type { LessonRepository } from '../data/lesson.repository.ts';
import type { OwnershipRepository, PeriodRow } from '../data/ownership.repository.ts';
import type { SectionRepository, SectionRow } from '../data/section.repository.ts';
import type { CourseActor, CourseRole } from '../domain/course.ts';
import type { LinkValidator } from '../domain/link-validator.ts';
import type { CatalogDeps } from './catalog.server.ts';

export type Failure = AppError;

export type Loaded = {
  course: CourseRow;
  sections: SectionRow[];
  open: Map<string, PeriodRow>;
  role: CourseRole | null;
};

export type WriteContext = {
  actor: Actor;
  operation: string;
  courseId?: string;
  sectionId?: string;
};

export type CatalogKernel = {
  deps: CatalogDeps;
  now(): Date;
  courseActor(actor: Actor): CourseActor;
  links: LinkValidator;
  write<T>(
    context: WriteContext,
    correlationId: string,
    fn: (tx: TxHandle, exec: Executor) => Promise<Result<T, Failure>>,
  ): Promise<Result<T, Failure>>;
  load(
    exec: Executor,
    courseId: string,
    actor: CourseActor,
    lock: 'update' | 'share' | 'none',
  ): Promise<Result<Loaded, AppError<'NOT_FOUND'>>>;
  loadForLeadWrite(
    exec: Executor,
    courseId: string,
    actor: CourseActor,
    expectedVersion: number,
    beforeVersionCheck?: (course: CourseRow) => Result<void, Failure>,
  ): Promise<Result<Loaded, Failure>>;
  workingCopyFor(
    exec: Executor,
    section: SectionRow,
    expectedVersion: number,
  ): Promise<Result<{ sectionVersionId: string; version: number }, Failure>>;
  bumpCourse(exec: Executor, course: CourseRow): Promise<Result<number, Failure>>;
  /** OD-207: raises a moderation signal; a failure is logged and never changes the caller's answer. */
  signal(kind: string, raise: () => Promise<void> | undefined): Promise<void>;
  repos: {
    courses: CourseRepository;
    sections: SectionRepository;
    ownership: OwnershipRepository;
    lessons: LessonRepository;
    blocked: BlockedDomainRepository;
  };
};

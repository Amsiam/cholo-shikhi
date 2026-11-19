// Section content and review server functions (I1 lesson editor; NFR6.201). Every one uses
// roleFn(['instructor', 'admin']), which requires the two-step check for staff (U1 BR1.6); the
// course-level checks (Lead, Co-instructor, section owner, Admin) run in the service under the row
// locks (BR6.1–BR6.9, NFR6.202). No Catalog function is public.
import { createServerFn } from '@tanstack/react-start';
import { roleFn, typedInput } from '#src/server/fn.ts';
import {
  AddLessonInput,
  EditLessonInput,
  LessonRefInput,
  RemoveLessonInput,
  ReorderLessonsInput,
  ReturnSectionInput,
  ReviewTransitionInput,
  SaveQuizQuestionsInput,
  SaveTextLessonBodyInput,
  SectionRefInput,
  SetLessonVideoInput,
} from './catalog-content.schema.ts';
import { getCatalog } from './catalog-instance.server.ts';

const AUTHORING = ['instructor', 'admin'] as const;

export const getSectionForEditing = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof SectionRefInput>())
  .handler(
    roleFn(AUTHORING, SectionRefInput, async ({ actor, input }) =>
      getCatalog().getSectionForEditing(actor, input),
    ),
  );

export const addLesson = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof AddLessonInput>())
  .handler(
    roleFn(AUTHORING, AddLessonInput, async ({ actor, input, correlationId }) =>
      getCatalog().addLesson(actor, input, correlationId),
    ),
  );

export const editLesson = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof EditLessonInput>())
  .handler(
    roleFn(AUTHORING, EditLessonInput, async ({ actor, input, correlationId }) =>
      getCatalog().editLesson(actor, input, correlationId),
    ),
  );

export const saveTextLessonBody = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SaveTextLessonBodyInput>())
  .handler(
    roleFn(AUTHORING, SaveTextLessonBodyInput, async ({ actor, input, correlationId }) =>
      getCatalog().saveTextLessonBody(actor, input, correlationId),
    ),
  );

export const reorderLessons = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ReorderLessonsInput>())
  .handler(
    roleFn(AUTHORING, ReorderLessonsInput, async ({ actor, input, correlationId }) =>
      getCatalog().reorderLessons(actor, input, correlationId),
    ),
  );

export const removeLesson = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof RemoveLessonInput>())
  .handler(
    roleFn(AUTHORING, RemoveLessonInput, async ({ actor, input, correlationId }) =>
      getCatalog().removeLesson(actor, input, correlationId),
    ),
  );

export const submitSection = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ReviewTransitionInput>())
  .handler(
    roleFn(AUTHORING, ReviewTransitionInput, async ({ actor, input, correlationId }) =>
      getCatalog().submitSection(actor, input, correlationId),
    ),
  );

export const approveSection = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ReviewTransitionInput>())
  .handler(
    roleFn(AUTHORING, ReviewTransitionInput, async ({ actor, input, correlationId }) =>
      getCatalog().approveSection(actor, input, correlationId),
    ),
  );

export const selfApproveSection = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ReviewTransitionInput>())
  .handler(
    roleFn(AUTHORING, ReviewTransitionInput, async ({ actor, input, correlationId }) =>
      getCatalog().selfApproveSection(actor, input, correlationId),
    ),
  );

export const reopenSection = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ReviewTransitionInput>())
  .handler(
    roleFn(AUTHORING, ReviewTransitionInput, async ({ actor, input, correlationId }) =>
      getCatalog().reopenSection(actor, input, correlationId),
    ),
  );

export const returnSection = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ReturnSectionInput>())
  .handler(
    roleFn(AUTHORING, ReturnSectionInput, async ({ actor, input, correlationId }) =>
      getCatalog().returnSection(actor, input, correlationId),
    ),
  );

/** A video lesson's YouTube video on the working copy (section owner or Admin). */
export const setLessonVideo = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SetLessonVideoInput>())
  .handler(
    roleFn(AUTHORING, SetLessonVideoInput, async ({ actor, input, correlationId }) =>
      getCatalog().setLessonVideo(actor, input, correlationId),
    ),
  );

/** A quiz lesson's questions for the editor, with their correct answers (course staff only). */
export const getQuizForEditing = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof LessonRefInput>())
  .handler(
    roleFn(AUTHORING, LessonRefInput, async ({ actor, input }) =>
      getCatalog().getQuizForEditing(actor, input),
    ),
  );

/** Replaces a quiz lesson's questions on the working copy (section owner or Admin). */
export const saveQuizQuestions = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SaveQuizQuestionsInput>())
  .handler(
    roleFn(AUTHORING, SaveQuizQuestionsInput, async ({ actor, input, correlationId }) =>
      getCatalog().saveQuizQuestions(actor, input, correlationId),
    ),
  );

// Catalog core server functions (I1 instructor builder; NFR6.201). Every one uses
// roleFn(['instructor', 'admin']), which requires the two-step check for staff (U1 BR1.6); the
// course-level checks (Lead, Co-instructor, section owner, Admin) run in the service under the row
// lock (BR6.1–BR6.9, NFR6.202). changeLead is the exception: roleFn('admin') only (BR4.7). No Catalog
// function is public.
import { createServerFn } from '@tanstack/react-start';
import { roleFn, typedInput } from '#src/server/fn.ts';
import {
  AddSectionInput,
  AssignSectionInput,
  ChangeLeadInput,
  CourseRefInput,
  CreateCourseInput,
  EditSectionTitleInput,
  PageInput,
  RemoveCoInstructorInput,
  ReorderSectionsInput,
  SectionStructureInput,
  SetAccessDurationInput,
  SetCoursePriceInput,
} from './catalog.schema.ts';
import { getCatalog } from './catalog-instance.server.ts';

const AUTHORING = ['instructor', 'admin'] as const;

export const createCourse = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof CreateCourseInput>())
  .handler(
    roleFn(AUTHORING, CreateCourseInput, async ({ actor, input, correlationId }) =>
      getCatalog().createCourse(actor, input, correlationId),
    ),
  );

export const listMyCourses = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof PageInput>())
  .handler(
    roleFn(AUTHORING, PageInput, async ({ actor, input }) =>
      getCatalog().listMyCourses(actor, input),
    ),
  );

export const getCourseForEditing = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof CourseRefInput>())
  .handler(
    roleFn(AUTHORING, CourseRefInput, async ({ actor, input }) =>
      getCatalog().getCourseForEditing(actor, input.courseId),
    ),
  );

export const setCoursePrice = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SetCoursePriceInput>())
  .handler(
    roleFn(AUTHORING, SetCoursePriceInput, async ({ actor, input, correlationId }) =>
      getCatalog().setCoursePrice(actor, input, correlationId),
    ),
  );

export const setAccessDuration = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SetAccessDurationInput>())
  .handler(
    roleFn(AUTHORING, SetAccessDurationInput, async ({ actor, input, correlationId }) =>
      getCatalog().setAccessDuration(actor, input, correlationId),
    ),
  );

export const assignSection = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof AssignSectionInput>())
  .handler(
    roleFn(AUTHORING, AssignSectionInput, async ({ actor, input, correlationId }) =>
      getCatalog().assignSection(actor, input, correlationId),
    ),
  );

export const removeCoInstructor = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof RemoveCoInstructorInput>())
  .handler(
    roleFn(AUTHORING, RemoveCoInstructorInput, async ({ actor, input, correlationId }) =>
      getCatalog().removeCoInstructor(actor, input, correlationId),
    ),
  );

/** BR4.7: only an Admin changes a course's Lead (step-up required by the builder). */
export const changeLead = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ChangeLeadInput>())
  .handler(
    roleFn('admin', ChangeLeadInput, async ({ actor, input, correlationId }) =>
      getCatalog().changeLead(actor, input, correlationId),
    ),
  );

export const editSectionTitle = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof EditSectionTitleInput>())
  .handler(
    roleFn(AUTHORING, EditSectionTitleInput, async ({ actor, input, correlationId }) =>
      getCatalog().editSectionTitle(actor, input, correlationId),
    ),
  );

export const addSection = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof AddSectionInput>())
  .handler(
    roleFn(AUTHORING, AddSectionInput, async ({ actor, input, correlationId }) =>
      getCatalog().addSection(actor, input, correlationId),
    ),
  );

export const reorderSections = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ReorderSectionsInput>())
  .handler(
    roleFn(AUTHORING, ReorderSectionsInput, async ({ actor, input, correlationId }) =>
      getCatalog().reorderSections(actor, input, correlationId),
    ),
  );

export const removeSection = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SectionStructureInput>())
  .handler(
    roleFn(AUTHORING, SectionStructureInput, async ({ actor, input, correlationId }) =>
      getCatalog().removeSection(actor, input, correlationId),
    ),
  );

export const cancelSectionRemoval = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SectionStructureInput>())
  .handler(
    roleFn(AUTHORING, SectionStructureInput, async ({ actor, input, correlationId }) =>
      getCatalog().cancelSectionRemoval(actor, input, correlationId),
    ),
  );

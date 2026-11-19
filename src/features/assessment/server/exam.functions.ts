// Exam builder server functions (staff). Instructors manage their own exams; Admins manage all.
import { createServerFn } from '@tanstack/react-start';
import { roleFn, typedInput } from '#src/server/fn.ts';
import { AttachExamInput, ExamRef, ExamVersionRef, NoInput, SaveExamInput } from './bank.schema.ts';
import {
  attachExamToCourse,
  drawExamQuestions,
  getStaffExam,
  listStaffExams,
  publishExam,
  retireExam,
  saveExam,
} from './exam.server.ts';

const STAFF = ['instructor', 'admin'] as const;

export const listExamsForStaff = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn(STAFF, NoInput, async ({ actor }) => listStaffExams(actor)));

export const getExamForStaff = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof ExamRef>())
  .handler(roleFn(STAFF, ExamRef, async ({ actor, input }) => getStaffExam(actor, input)));

export const saveExamDraft = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SaveExamInput>())
  .handler(roleFn(STAFF, SaveExamInput, async ({ actor, input }) => saveExam(actor, input)));

export const drawExamQuestionSet = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ExamVersionRef>())
  .handler(
    roleFn(STAFF, ExamVersionRef, async ({ actor, input }) => drawExamQuestions(actor, input)),
  );

export const publishExamForStudents = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ExamVersionRef>())
  .handler(roleFn(STAFF, ExamVersionRef, async ({ actor, input }) => publishExam(actor, input)));

export const retireExamForStudents = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ExamVersionRef>())
  .handler(roleFn(STAFF, ExamVersionRef, async ({ actor, input }) => retireExam(actor, input)));

export const attachExamToMyCourse = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof AttachExamInput>())
  .handler(
    roleFn(STAFF, AttachExamInput, async ({ actor, input }) => attachExamToCourse(actor, input)),
  );

// A7/A8 HR server functions: Finance or Admin with two-step sign-in (re-checked in the service).
import { createServerFn } from '@tanstack/react-start';
import { roleFn, typedInput } from '#src/server/fn.ts';
import {
  FindInstructorInput,
  InstructorRefInput,
  NoInput,
  RecordLeaveInput,
  SavePolicyInput,
  SaveRecordInput,
} from './hr.schema.ts';
import {
  findInstructorHr,
  hrOverview,
  instructorHr,
  recordLeave,
  savePolicy,
  saveRecord,
} from './hr.server.ts';

const FINANCE = ['admin', 'finance'] as const;

export const listHrInstructors = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn(FINANCE, NoInput, async ({ actor }) => hrOverview(actor)));

export const findHrInstructor = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof FindInstructorInput>())
  .handler(
    roleFn(FINANCE, FindInstructorInput, async ({ actor, input }) =>
      findInstructorHr(actor, input),
    ),
  );

export const getInstructorHr = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof InstructorRefInput>())
  .handler(
    roleFn(FINANCE, InstructorRefInput, async ({ actor, input }) => instructorHr(actor, input)),
  );

export const savePayPolicyVersion = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SavePolicyInput>())
  .handler(
    roleFn(FINANCE, SavePolicyInput, async ({ actor, input, correlationId }) =>
      savePolicy(actor, input, correlationId),
    ),
  );

export const saveEmployeeRecord = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SaveRecordInput>())
  .handler(
    roleFn(FINANCE, SaveRecordInput, async ({ actor, input, correlationId }) =>
      saveRecord(actor, input, correlationId),
    ),
  );

export const recordInstructorLeave = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof RecordLeaveInput>())
  .handler(
    roleFn(FINANCE, RecordLeaveInput, async ({ actor, input, correlationId }) =>
      recordLeave(actor, input, correlationId),
    ),
  );

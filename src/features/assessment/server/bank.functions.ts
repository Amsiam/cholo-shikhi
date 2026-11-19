// Question bank server functions. Authoring needs an Instructor or Admin with two-step sign-in;
// the taxonomy is Admin-only; review actions are checked per role in the service.
import { createServerFn } from '@tanstack/react-start';
import { roleFn, typedInput } from '#src/server/fn.ts';
import {
  BankListInput,
  BankQuestionRef,
  ImportPastPapersInput,
  NoInput,
  ReviewBankInput,
  SaveBankQuestionInput,
  SaveSubjectInput,
  SaveTopicInput,
} from './bank.schema.ts';
import {
  getBankQuestion,
  getTaxonomy,
  listBank,
  reviewBankQuestion,
  saveBankQuestion,
  saveSubject,
  saveTopic,
} from './bank.server.ts';
import { importPastPapers } from './past-paper.server.ts';

const STAFF = ['instructor', 'admin'] as const;

export const getQuestionTaxonomy = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn(STAFF, NoInput, async () => getTaxonomy()));

export const saveQuestionSubject = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SaveSubjectInput>())
  .handler(roleFn(['admin'], SaveSubjectInput, async ({ input }) => saveSubject(input)));

export const saveQuestionTopic = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SaveTopicInput>())
  .handler(roleFn(['admin'], SaveTopicInput, async ({ input }) => saveTopic(input)));

export const listBankQuestions = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof BankListInput>())
  .handler(roleFn(STAFF, BankListInput, async ({ actor, input }) => listBank(actor, input)));

export const getBankQuestionForEditing = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof BankQuestionRef>())
  .handler(
    roleFn(STAFF, BankQuestionRef, async ({ actor, input }) => getBankQuestion(actor, input)),
  );

export const saveBankQuestionDraft = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SaveBankQuestionInput>())
  .handler(
    roleFn(STAFF, SaveBankQuestionInput, async ({ actor, input }) =>
      saveBankQuestion(actor, input),
    ),
  );

export const reviewBankQuestionAction = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ReviewBankInput>())
  .handler(
    roleFn(STAFF, ReviewBankInput, async ({ actor, input }) => reviewBankQuestion(actor, input)),
  );

/** US4.7 (A12): import past-paper questions from a CSV (Admin with two-step sign-in). */
export const importPastPaperQuestions = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ImportPastPapersInput>())
  .handler(
    roleFn('admin', ImportPastPapersInput, async ({ actor, input, correlationId }) =>
      importPastPapers(actor, input, correlationId),
    ),
  );

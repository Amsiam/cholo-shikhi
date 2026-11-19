// The composition root's one-time wiring between units that may not import each other (ADR-020):
// Assessment answers Catalog's question-reference port. Called by the server-function builders, so
// it runs before any server function, once per process.
import { checkQuestionReferences } from '#src/features/assessment/server/question-check.server.ts';
import { registerQuestionReferenceCheck } from '#src/features/catalog/server/question-check.server.ts';

let isComposed = false;

export function ensureComposition(): void {
  if (isComposed) return;
  isComposed = true;
  try {
    registerQuestionReferenceCheck(checkQuestionReferences);
  } catch (e) {
    // Tests register their own stub first; a second registration is refused and that is fine.
    if (!(e instanceof Error) || !e.message.includes('already registered')) throw e;
  }
}

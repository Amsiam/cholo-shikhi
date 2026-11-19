// The SectionVersion review machine (rules.md BR8.3–BR8.9, BR9.3, BR9.7; functional-spec §3.2).
// Plain TypeScript. Every transition the server applies goes through transitionReview, and every
// applied transition writes one append-only SectionReview entry (BR8.7).
import type { AppError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { invalidState, validationFailed } from './course.ts';

export type ReviewState =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'published'
  | 'superseded'
  | 'discarded';
export type WorkingState = 'draft' | 'in_review' | 'approved';
export type ReviewEvent =
  | 'submit'
  | 'approve'
  | 'return'
  | 'selfApprove'
  | 'reopen'
  | 'adminApprove'
  | 'reset'
  | 'publish'
  | 'supersede'
  | 'discard';

export type ReviewAction =
  | 'submitted'
  | 'approved'
  | 'returned'
  | 'self_approved'
  | 'admin_approved'
  | 'reopened'
  | 'reset_by_reassignment'
  | 'published'
  | 'discarded';

const TABLE: Readonly<Record<ReviewEvent, Partial<Record<ReviewState, ReviewState>>>> = {
  submit: { draft: 'in_review' },
  approve: { in_review: 'approved' },
  return: { in_review: 'draft' },
  selfApprove: { draft: 'approved' },
  reopen: { approved: 'draft' },
  adminApprove: { draft: 'approved', in_review: 'approved' },
  reset: { in_review: 'draft' },
  publish: { approved: 'published' },
  supersede: { published: 'superseded' },
  discard: { draft: 'discarded', in_review: 'discarded', approved: 'discarded' },
};

/** The SectionReview action each event records (BR8.7); supersede is not a review step. */
export const REVIEW_ACTION_OF: Readonly<Record<Exclude<ReviewEvent, 'supersede'>, ReviewAction>> = {
  submit: 'submitted',
  approve: 'approved',
  return: 'returned',
  selfApprove: 'self_approved',
  reopen: 'reopened',
  adminApprove: 'admin_approved',
  reset: 'reset_by_reassignment',
  publish: 'published',
  discard: 'discarded',
};

/** §3.2: the next review state, or INVALID_STATE for a transition outside the table. */
export function transitionReview(
  state: ReviewState,
  event: ReviewEvent,
): Result<ReviewState, AppError<'INVALID_STATE'>> {
  const next = TABLE[event][state];
  return next ? ok(next) : err(invalidState('invalidTransition'));
}

/** BR8.2, BR8.8: only a draft working copy accepts an edit. */
export function checkWorkingCopyEditable(
  state: ReviewState,
): Result<void, AppError<'INVALID_STATE'>> {
  return state === 'draft' ? ok(undefined) : err(invalidState('workingCopyReadOnly'));
}

export const RETURN_COMMENT_MAX = 2000;

/** BR8.5: a return needs a comment of 1–2,000 characters after trimming. */
export function validateReturnComment(
  comment: string,
): Result<string, AppError<'VALIDATION_FAILED'>> {
  const trimmed = comment.trim();
  if (trimmed.length === 0) {
    return err(validationFailed({ comment: ['errors.catalog.returnCommentRequired'] }));
  }
  if ([...trimmed].length > RETURN_COMMENT_MAX) {
    return err(validationFailed({ comment: ['errors.catalog.returnCommentTooLong'] }));
  }
  return ok(trimmed);
}

export type ReviewActor = { isLead: boolean; isOwner: boolean; isAdmin: boolean };

/**
 * Who may fire each human event (BR6.8, BR8.3–BR8.6, BR8.8): the owner (or an Admin) submits and
 * reopens; the Lead (or an Admin) approves and returns; only the Lead who owns the section
 * self-approves. A refusal is FORBIDDEN notLead or notSectionOwner, or INVALID_STATE when the Lead
 * asks to self-approve a section someone else owns (the normal chain applies, BR8.6).
 */
export function decideReviewEvent(
  event: 'submit' | 'approve' | 'return' | 'selfApprove' | 'reopen',
  actor: ReviewActor,
): Result<void, AppError<'FORBIDDEN' | 'INVALID_STATE'>> {
  const notLead: AppError<'FORBIDDEN'> = { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notLead' };
  const notOwner: AppError<'FORBIDDEN'> = {
    code: 'FORBIDDEN',
    i18nKey: 'errors.catalog.notSectionOwner',
  };
  switch (event) {
    case 'submit':
    case 'reopen':
      return actor.isOwner || actor.isAdmin ? ok(undefined) : err(notOwner);
    case 'approve':
    case 'return':
      return actor.isLead || actor.isAdmin ? ok(undefined) : err(notLead);
    case 'selfApprove':
      if (!actor.isLead) return err(notLead);
      return actor.isOwner ? ok(undefined) : err(invalidState('invalidTransition'));
  }
}

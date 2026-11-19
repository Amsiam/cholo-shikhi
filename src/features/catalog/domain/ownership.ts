// Section ownership (rules.md BR6.4–BR6.7; FR7.7): dated, non-overlapping, gap-free periods, the
// effect of a reassignment on work in progress, and the owner of each section at an instant.
// Plain TypeScript. Instants are UTC ISO strings, compared as epoch milliseconds.
import type { AppError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { invalidState, validationFailed } from './course.ts';

export type OwnershipReason =
  | 'default_lead'
  | 'assigned'
  | 'reassigned'
  | 'co_instructor_removed'
  | 'lead_changed';

export type Period = {
  sectionId: string;
  instructorId: string;
  validFrom: string;
  validTo: string | null;
  reason: OwnershipReason;
};

export type OwnershipChange =
  | { kind: 'noop' }
  | { kind: 'change'; closeAt: string | null; open: Omit<Period, 'validTo'> & { validTo: null } };

const ms = (iso: string) => Date.parse(iso);

/**
 * BR6.5: an ownership change closes the open period and opens the next one at the same instant.
 * Assigning the current owner again changes nothing. `at` never precedes the open period's start.
 */
export function planOwnershipChange(
  open: Period | null,
  change: { sectionId: string; newOwnerId: string; at: string; reason: OwnershipReason },
): OwnershipChange {
  if (open !== null && open.instructorId === change.newOwnerId) return { kind: 'noop' };
  const at = open !== null && ms(change.at) < ms(open.validFrom) ? open.validFrom : change.at;
  return {
    kind: 'change',
    closeAt: open === null ? null : at,
    open: {
      sectionId: change.sectionId,
      instructorId: change.newOwnerId,
      validFrom: at,
      validTo: null,
      reason: change.reason,
    },
  };
}

/** The reason an assignment records: moving a section away from the Lead is `assigned`. */
export function assignmentReason(
  currentOwnerId: string | null,
  leadId: string | null,
): OwnershipReason {
  return currentOwnerId === null || currentOwnerId === leadId ? 'assigned' : 'reassigned';
}

export type LeadChangePlan = { kind: 'noop' } | { kind: 'change'; move: string[]; open: string[] };

/**
 * BR4.7: an Admin's change of a course's Lead. The new Lead must hold the Instructor role. Every live
 * section the old Lead owns moves to the new Lead (`move`: close and reopen, reason lead_changed,
 * BR6.5); a live section nobody owns, which happens only while the course has no Lead, opens for the
 * new Lead (`open`, BR6.4). A Co-instructor's sections and removed sections never change.
 */
export function planLeadChange(input: {
  currentLeadId: string | null;
  newLeadId: string;
  isNewLeadInstructor: boolean;
  sections: ReadonlyArray<{ sectionId: string; ownerId: string | null; isRemoved: boolean }>;
}): Result<LeadChangePlan, AppError<'VALIDATION_FAILED'>> {
  if (!input.isNewLeadInstructor) {
    return err(validationFailed({ newLeadId: ['errors.catalog.leadNotInstructor'] }));
  }
  if (input.currentLeadId === input.newLeadId) return ok({ kind: 'noop' });
  const live = input.sections.filter((section) => !section.isRemoved);
  const move =
    input.currentLeadId === null
      ? []
      : live.filter((s) => s.ownerId === input.currentLeadId).map((s) => s.sectionId);
  const open = live.filter((s) => s.ownerId === null).map((s) => s.sectionId);
  return ok({ kind: 'change', move, open });
}

/**
 * BR6.2, BR6.3, BR6.4: what assignSection needs before it may change anything. The section must
 * have an open period (a course with no Lead has none yet) and the assignee must be an Instructor.
 */
export function checkAssignment(input: {
  hasOpenPeriod: boolean;
  isAssigneeInstructor: boolean;
}): Result<void, AppError<'INVALID_STATE' | 'VALIDATION_FAILED'>> {
  if (!input.isAssigneeInstructor) {
    return err(validationFailed({ assigneeId: ['errors.catalog.assigneeNotInstructor'] }));
  }
  if (!input.hasOpenPeriod) return err(invalidState('sectionHasNoOwner'));
  return ok(undefined);
}

export type ReviewState = 'draft' | 'in_review' | 'approved';

/** BR6.6: a copy in review goes back to draft for the new owner; draft and approved are kept. */
export function workingCopyAfterReassignment(state: ReviewState): {
  state: ReviewState;
  isReset: boolean;
} {
  return state === 'in_review' ? { state: 'draft', isReset: true } : { state, isReset: false };
}

export type SectionLifetime = { sectionId: string; createdAt: string; removedAt: string | null };

/**
 * BR6.7: for each section that existed and was not removed at `at`, the instructor whose period
 * contains `at` ([validFrom, validTo)). Sections with no such period are left out. Sorted by
 * section ID so the answer is deterministic.
 */
export function ownershipSnapshot(
  sections: readonly SectionLifetime[],
  periods: readonly Period[],
  at: string,
): Array<{ sectionId: string; instructorId: string }> {
  const t = ms(at);
  const result: Array<{ sectionId: string; instructorId: string }> = [];
  for (const section of [...sections].sort((a, b) => a.sectionId.localeCompare(b.sectionId))) {
    const existed = ms(section.createdAt) <= t;
    const notYetRemoved = section.removedAt === null || t < ms(section.removedAt);
    if (!existed || !notYetRemoved) continue;
    const owner = periods.find(
      (p) =>
        p.sectionId === section.sectionId &&
        ms(p.validFrom) <= t &&
        (p.validTo === null || t < ms(p.validTo)),
    );
    if (owner) result.push({ sectionId: section.sectionId, instructorId: owner.instructorId });
  }
  return result;
}

/** Applies a change to a period list: the open period closes and the new one is appended. */
export function applyOwnershipChange(
  periods: readonly Period[],
  change: OwnershipChange,
): Period[] {
  if (change.kind === 'noop') return [...periods];
  const closed = periods.map((p) =>
    p.sectionId === change.open.sectionId && p.validTo === null && change.closeAt !== null
      ? { ...p, validTo: change.closeAt }
      : p,
  );
  return [...closed, change.open];
}

/** RD-215 / BR6.4 invariant: one section's periods never overlap and leave no gap. */
export function isContiguous(periods: readonly Period[]): boolean {
  const sorted = [...periods].sort((a, b) => ms(a.validFrom) - ms(b.validFrom));
  return sorted.every((p, i) => {
    const next = sorted[i + 1];
    if (!next) return true;
    return p.validTo !== null && ms(p.validTo) === ms(next.validFrom);
  });
}

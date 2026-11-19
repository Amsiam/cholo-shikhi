// [LT] Step 15: ownership periods (BR6.4–BR6.7). Plain inputs, no database. fast-check properties:
// any sequence of assignments yields non-overlapping, gap-free periods per section, and the
// snapshot at any instant after creation names exactly one owner. Fixed seed.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyOwnershipChange,
  assignmentReason,
  checkAssignment,
  isContiguous,
  ownershipSnapshot,
  type Period,
  planLeadChange,
  planOwnershipChange,
  workingCopyAfterReassignment,
} from './ownership.ts';

const SEED = 61116;
const S = 'section-a';
const T0 = '2026-11-01T00:00:00.000Z';
const T1 = '2026-11-05T00:00:00.000Z';
const T2 = '2026-11-09T00:00:00.000Z';

const leadPeriod: Period = {
  sectionId: S,
  instructorId: 'lead',
  validFrom: T0,
  validTo: null,
  reason: 'default_lead',
};

describe('planOwnershipChange (BR6.5)', () => {
  it('closes the open period and opens the next one at the same instant', () => {
    expect(
      planOwnershipChange(leadPeriod, {
        sectionId: S,
        newOwnerId: 'tasnim',
        at: T1,
        reason: 'assigned',
      }),
    ).toEqual({
      kind: 'change',
      closeAt: T1,
      open: {
        sectionId: S,
        instructorId: 'tasnim',
        validFrom: T1,
        validTo: null,
        reason: 'assigned',
      },
    });
  });

  it('changes nothing when the new owner already owns the section', () => {
    expect(
      planOwnershipChange(leadPeriod, {
        sectionId: S,
        newOwnerId: 'lead',
        at: T1,
        reason: 'assigned',
      }),
    ).toEqual({ kind: 'noop' });
  });

  it('opens a first period without closing anything (a Lead set on a course with none)', () => {
    const change = planOwnershipChange(null, {
      sectionId: S,
      newOwnerId: 'lead',
      at: T0,
      reason: 'default_lead',
    });
    expect(change).toMatchObject({ kind: 'change', closeAt: null, open: { validFrom: T0 } });
  });

  it('never closes a period before it started, even with a clock that ran backwards', () => {
    const change = planOwnershipChange(
      { ...leadPeriod, validFrom: T2 },
      { sectionId: S, newOwnerId: 'tasnim', at: T1, reason: 'assigned' },
    );
    expect(change).toMatchObject({ closeAt: T2, open: { validFrom: T2 } });
  });
});

describe('assignmentReason, checkAssignment and work in progress (BR6.2, BR6.3, BR6.6)', () => {
  it('records "assigned" when the section leaves the Lead and "reassigned" otherwise', () => {
    expect(assignmentReason('lead', 'lead')).toBe('assigned');
    expect(assignmentReason(null, 'lead')).toBe('assigned');
    expect(assignmentReason('tasnim', 'lead')).toBe('reassigned');
  });

  it('refuses an assignee without the Instructor role on the assignee field', () => {
    expect(checkAssignment({ hasOpenPeriod: true, isAssigneeInstructor: false })).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: { assigneeId: ['errors.catalog.assigneeNotInstructor'] },
      },
    });
  });

  it('refuses a section with no owner yet (a course without a Lead)', () => {
    expect(checkAssignment({ hasOpenPeriod: false, isAssigneeInstructor: true })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.sectionHasNoOwner' },
    });
    expect(checkAssignment({ hasOpenPeriod: true, isAssigneeInstructor: true }).ok).toBe(true);
  });

  it('sends a copy in review back to draft and keeps draft and approved copies', () => {
    expect(workingCopyAfterReassignment('in_review')).toEqual({ state: 'draft', isReset: true });
    expect(workingCopyAfterReassignment('draft')).toEqual({ state: 'draft', isReset: false });
    expect(workingCopyAfterReassignment('approved')).toEqual({ state: 'approved', isReset: false });
  });
});

describe('ownershipSnapshot (BR6.7)', () => {
  const periods: Period[] = [
    { ...leadPeriod, validTo: T1 },
    { sectionId: S, instructorId: 'tasnim', validFrom: T1, validTo: null, reason: 'assigned' },
    {
      sectionId: 'section-b',
      instructorId: 'lead',
      validFrom: T0,
      validTo: null,
      reason: 'default_lead',
    },
  ];
  const sections = [
    { sectionId: S, createdAt: T0, removedAt: null },
    { sectionId: 'section-b', createdAt: T0, removedAt: T2 },
    { sectionId: 'section-c', createdAt: T0, removedAt: null },
  ];

  it('names the owner whose half-open period contains the instant', () => {
    expect(ownershipSnapshot(sections, periods, '2026-11-04T23:59:59.999Z')).toEqual([
      { sectionId: S, instructorId: 'lead' },
      { sectionId: 'section-b', instructorId: 'lead' },
    ]);
    expect(ownershipSnapshot(sections, periods, T1)).toContainEqual({
      sectionId: S,
      instructorId: 'tasnim',
    });
  });

  it('leaves out sections created later, removed by then, or with no period', () => {
    expect(ownershipSnapshot(sections, periods, '2026-10-01T00:00:00Z')).toEqual([]);
    const afterRemoval = ownershipSnapshot(sections, periods, T2);
    expect(afterRemoval.map((r) => r.sectionId)).toEqual([S]);
  });

  it('is deterministic whatever the input order', () => {
    expect(ownershipSnapshot([...sections].reverse(), [...periods].reverse(), T1)).toEqual(
      ownershipSnapshot(sections, periods, T1),
    );
  });
});

describe('properties', () => {
  const owners = fc.constantFrom('lead', 'tasnim', 'rafi', 'mitu');
  const steps = fc.array(fc.tuple(owners, fc.integer({ min: 0, max: 72 * 3600 * 1000 })), {
    maxLength: 30,
  });

  function replay(sequence: Array<[string, number]>) {
    let periods: Period[] = [leadPeriod];
    let now = Date.parse(T0);
    for (const [owner, gap] of sequence) {
      now += gap;
      const open = periods.find((p) => p.validTo === null) ?? null;
      const change = planOwnershipChange(open, {
        sectionId: S,
        newOwnerId: owner,
        at: new Date(now).toISOString(),
        reason: assignmentReason(open?.instructorId ?? null, 'lead'),
      });
      periods = applyOwnershipChange(periods, change);
    }
    return { periods, end: now };
  }

  it('any sequence of assignments yields non-overlapping, gap-free periods with one open', () => {
    fc.assert(
      fc.property(steps, (sequence) => {
        const { periods } = replay(sequence);
        return isContiguous(periods) && periods.filter((p) => p.validTo === null).length === 1;
      }),
      { seed: SEED, numRuns: 500 },
    );
  });

  it('the snapshot at any instant after creation names exactly one owner', () => {
    fc.assert(
      fc.property(
        steps,
        fc.integer({ min: 0, max: 100 * 72 * 3600 * 1000 }),
        (sequence, offset) => {
          const { periods } = replay(sequence);
          const at = new Date(Date.parse(T0) + offset).toISOString();
          const snap = ownershipSnapshot(
            [{ sectionId: S, createdAt: T0, removedAt: null }],
            periods,
            at,
          );
          return snap.length === 1;
        },
      ),
      { seed: SEED, numRuns: 500 },
    );
  });

  it('isContiguous detects a gap and an overlap', () => {
    const gap: Period[] = [
      { ...leadPeriod, validTo: T1 },
      { ...leadPeriod, instructorId: 'tasnim', validFrom: T2 },
    ];
    const overlap: Period[] = [
      { ...leadPeriod, validTo: T2 },
      { ...leadPeriod, instructorId: 'tasnim', validFrom: T1 },
    ];
    const openThenMore: Period[] = [leadPeriod, { ...leadPeriod, validFrom: T1 }];
    expect(isContiguous(gap)).toBe(false);
    expect(isContiguous(overlap)).toBe(false);
    expect(isContiguous(openThenMore)).toBe(false);
    expect(applyOwnershipChange(gap, { kind: 'noop' })).toEqual(gap);
  });
});

// [TF] BR4.7 (R-02): what an Admin's changeLead moves. Test-first, before the implementation.
describe('planLeadChange (BR4.7)', () => {
  const OLD = 'lead-old';
  const NEW = 'lead-new';
  const CO = 'co-instructor';
  const sections = [
    { sectionId: 's1', ownerId: OLD, isRemoved: false },
    { sectionId: 's2', ownerId: CO, isRemoved: false },
    { sectionId: 's3', ownerId: OLD, isRemoved: true },
    { sectionId: 's4', ownerId: OLD, isRemoved: false },
  ];

  it('refuses a new Lead without the Instructor role with VALIDATION_FAILED on newLeadId', () => {
    expect(
      planLeadChange({ currentLeadId: OLD, newLeadId: NEW, isNewLeadInstructor: false, sections }),
    ).toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        i18nKey: 'errors.common.VALIDATION_FAILED',
        fieldErrors: { newLeadId: ['errors.catalog.leadNotInstructor'] },
      },
    });
  });

  it('moves every live section the old Lead owned, and nothing a Co-instructor owns or that is removed', () => {
    expect(
      planLeadChange({ currentLeadId: OLD, newLeadId: NEW, isNewLeadInstructor: true, sections }),
    ).toEqual({ ok: true, value: { kind: 'change', move: ['s1', 's4'], open: [] } });
  });

  it('is a no-op when the new Lead is already the Lead', () => {
    expect(
      planLeadChange({ currentLeadId: OLD, newLeadId: OLD, isNewLeadInstructor: true, sections }),
    ).toEqual({ ok: true, value: { kind: 'noop' } });
  });

  it('sets a first Lead on a course without one: unowned live sections open for the new Lead (BR4.1, BR6.4)', () => {
    expect(
      planLeadChange({
        currentLeadId: null,
        newLeadId: NEW,
        isNewLeadInstructor: true,
        sections: [
          { sectionId: 'a', ownerId: null, isRemoved: false },
          { sectionId: 'b', ownerId: null, isRemoved: true },
        ],
      }),
    ).toEqual({ ok: true, value: { kind: 'change', move: [], open: ['a'] } });
  });

  it("makes a Co-instructor the Lead: their sections stay theirs and the old Lead's move to them", () => {
    expect(
      planLeadChange({ currentLeadId: OLD, newLeadId: CO, isNewLeadInstructor: true, sections }),
    ).toEqual({ ok: true, value: { kind: 'change', move: ['s1', 's4'], open: [] } });
  });

  it('property: never moves a section the old Lead did not own, and never a removed one', () => {
    const owner = fc.constantFrom(OLD, NEW, CO, null);
    fc.assert(
      fc.property(
        fc.array(fc.record({ ownerId: owner, isRemoved: fc.boolean() }), { maxLength: 12 }),
        (rows) => {
          const input = rows.map((r, i) => ({ sectionId: `x${i}`, ...r }));
          const plan = planLeadChange({
            currentLeadId: OLD,
            newLeadId: NEW,
            isNewLeadInstructor: true,
            sections: input,
          });
          if (!plan.ok || plan.value.kind !== 'change') return false;
          const byId = new Map(input.map((r) => [r.sectionId, r]));
          return (
            plan.value.move.every(
              (id) => byId.get(id)?.ownerId === OLD && !byId.get(id)?.isRemoved,
            ) &&
            plan.value.open.every(
              (id) => byId.get(id)?.ownerId === null && !byId.get(id)?.isRemoved,
            )
          );
        },
      ),
      { seed: SEED },
    );
  });
});

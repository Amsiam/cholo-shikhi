// [LT] Step 15: course roles, Lead-only and owner-only decisions, titles, version tokens, the
// duration lock and the course state machine (BR3.1, BR4.3, BR4.8, BR5.6, BR5.7, BR6.1, BR6.8,
// BR6.9, BR12.1; functional-spec §3.1). fast-check: the machine never reaches an illegal state.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type CourseEvent,
  type CourseStatus,
  canManageCourse,
  checkCourseEditable,
  checkDurationEditable,
  checkVersion,
  decideCourseRead,
  decideDurationLock,
  decideLeadAction,
  decideSectionEdit,
  deriveCourseRole,
  transitionCourse,
  validateTitles,
} from './course.ts';

const lead = { userId: 'lead', isAdmin: false };
const co = { userId: 'tasnim', isAdmin: false };
const admin = { userId: 'boss', isAdmin: true };
const outsider = { userId: 'rafi', isAdmin: false };
const course = { leadInstructorId: 'lead', openOwnerIds: ['lead', 'tasnim'] };

describe('deriveCourseRole (BR6.1)', () => {
  it('derives lead, co_instructor, admin or none', () => {
    expect(deriveCourseRole(course, lead)).toBe('lead');
    expect(deriveCourseRole(course, co)).toBe('co_instructor');
    expect(deriveCourseRole(course, admin)).toBe('admin');
    expect(deriveCourseRole(course, outsider)).toBeNull();
  });

  it('gives no Lead role on a course without a Lead', () => {
    expect(deriveCourseRole({ leadInstructorId: null, openOwnerIds: [] }, lead)).toBeNull();
  });

  it('a former owner (no open period) has no role (NFR6.202)', () => {
    expect(deriveCourseRole({ leadInstructorId: 'lead', openOwnerIds: ['lead'] }, co)).toBeNull();
  });
});

describe('access decisions (BR4.4, BR6.2, BR6.8, BR6.9)', () => {
  it('lets staff and Admins read and answers not-found to everyone else', () => {
    expect(decideCourseRead('co_instructor')).toEqual({ ok: true, value: 'co_instructor' });
    expect(decideCourseRead(null)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('Lead-only actions: the Lead and Admins pass, a Co-instructor gets notLead, an outsider not-found', () => {
    expect(decideLeadAction('lead', lead).ok).toBe(true);
    expect(decideLeadAction('admin', admin).ok).toBe(true);
    // An Admin who also co-instructs keeps the Admin authority.
    expect(decideLeadAction('co_instructor', { ...co, isAdmin: true }).ok).toBe(true);
    expect(decideLeadAction('co_instructor', co)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notLead' },
    });
    expect(decideLeadAction(null, outsider)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(canManageCourse('co_instructor', co)).toBe(false);
  });

  it('section edits: the owner and Admins pass; other staff get notSectionOwner; outsiders not-found', () => {
    expect(decideSectionEdit('co_instructor', co, 'tasnim').ok).toBe(true);
    expect(decideSectionEdit('admin', admin, 'tasnim').ok).toBe(true);
    expect(decideSectionEdit('lead', lead, 'tasnim')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', i18nKey: 'errors.catalog.notSectionOwner' },
    });
    expect(decideSectionEdit('co_instructor', co, null)).toMatchObject({
      error: { i18nKey: 'errors.catalog.notSectionOwner' },
    });
    expect(decideSectionEdit(null, outsider, 'tasnim')).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('validateTitles (BR3.1)', () => {
  it('trims and accepts both titles', () => {
    expect(validateTitles({ titleBn: ' গণিত ', titleEn: ' Maths ' })).toEqual({
      ok: true,
      value: { titleBn: 'গণিত', titleEn: 'Maths' },
    });
  });

  it('refuses an empty or blank language and an over-long title, per field', () => {
    expect(
      validateTitles({ titleBn: '   ', titleEn: 'x'.repeat(151) }, 'sections.0.'),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        fieldErrors: {
          'sections.0.titleBn': ['errors.catalog.titleRequired'],
          'sections.0.titleEn': ['errors.catalog.titleTooLong'],
        },
      },
    });
  });
});

describe('version tokens, editability and the duration lock (BR12.1, BR5.6, BR5.7, BR8.10)', () => {
  it('refuses a stale or missing version with the current version in details', () => {
    expect(checkVersion(3, 3).ok).toBe(true);
    expect(checkVersion(3, 2)).toMatchObject({
      ok: false,
      error: {
        code: 'CONFLICT',
        i18nKey: 'errors.catalog.staleVersion',
        details: { currentVersion: 3 },
      },
    });
    expect(checkVersion(3, undefined).ok).toBe(false);
  });

  it('refuses edits of retired and hidden courses', () => {
    for (const status of ['retired', 'hidden'] as const) {
      expect(checkCourseEditable(status)).toMatchObject({
        error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.courseNotEditable' },
      });
    }
    for (const status of ['draft', 'published', 'unpublished'] as const) {
      expect(checkCourseEditable(status).ok).toBe(true);
    }
  });

  it('refuses a duration change once locked', () => {
    expect(checkDurationEditable(null).ok).toBe(true);
    expect(checkDurationEditable('2026-11-01T00:00:00Z')).toMatchObject({
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.durationLocked' },
    });
  });

  it('locks once, then answers the same lock time (idempotent, CR-4)', () => {
    const now = '2026-11-16T10:00:00.000Z';
    expect(decideDurationLock(undefined, now)).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(
      decideDurationLock({ accessDurationMonths: null, durationLockedAt: null }, now),
    ).toMatchObject({
      error: { code: 'INVALID_STATE', i18nKey: 'errors.catalog.durationNotSet' },
    });
    expect(decideDurationLock({ accessDurationMonths: 6, durationLockedAt: null }, now)).toEqual({
      ok: true,
      value: { accessDurationMonths: 6, lockedAt: now, isNewLock: true },
    });
    expect(
      decideDurationLock(
        { accessDurationMonths: 6, durationLockedAt: '2026-11-01T00:00:00.000Z' },
        now,
      ),
    ).toEqual({
      ok: true,
      value: { accessDurationMonths: 6, lockedAt: '2026-11-01T00:00:00.000Z', isNewLock: false },
    });
  });
});

describe('transitionCourse (§3.1, BR4.3, BR4.8, BR12.5)', () => {
  it.each([
    ['draft', 'publish', 'published'],
    ['published', 'publish', 'published'],
    ['unpublished', 'publish', 'published'],
    ['published', 'unpublish', 'unpublished'],
    ['published', 'retire', 'retired'],
    ['unpublished', 'retire', 'retired'],
    ['published', 'hide', 'hidden'],
    ['retired', 'hide', 'hidden'],
  ] as const)('%s --%s--> %s', (from, event, to) => {
    expect(transitionCourse(from, event)).toEqual({ ok: true, value: to });
  });

  it.each([
    ['retired', 'publish'],
    ['draft', 'hide'],
    ['draft', 'unpublish'],
    ['hidden', 'publish'],
    ['published', 'restore'],
  ] as const)('refuses %s --%s--> with INVALID_STATE', (from, event) => {
    expect(transitionCourse(from, event)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE' },
    });
  });

  it('restores a hidden course to the status it had before', () => {
    expect(transitionCourse('hidden', 'restore', { statusBeforeHidden: 'retired' })).toEqual({
      ok: true,
      value: 'retired',
    });
    expect(transitionCourse('hidden', 'restore').ok).toBe(false);
  });

  it('refuses to unpublish or retire the free-trial course (BR4.8)', () => {
    for (const event of ['unpublish', 'retire'] as const) {
      expect(transitionCourse('published', event, { isTrialCourse: true })).toMatchObject({
        ok: false,
        error: { code: 'CONFLICT', i18nKey: 'errors.catalog.isTrialCourse' },
      });
    }
    expect(transitionCourse('published', 'publish', { isTrialCourse: true }).ok).toBe(true);
  });

  it('property: no event sequence reaches an illegal state or republishes a retired course', () => {
    const LEGAL: Record<CourseStatus, readonly CourseStatus[]> = {
      draft: ['published'],
      published: ['published', 'unpublished', 'retired', 'hidden'],
      unpublished: ['published', 'retired', 'hidden'],
      retired: ['hidden'],
      hidden: ['published', 'unpublished', 'retired'],
    };
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom<CourseEvent>('publish', 'unpublish', 'retire', 'hide', 'restore'),
          {
            maxLength: 40,
          },
        ),
        (events) => {
          let status: CourseStatus = 'draft';
          type Hideable = 'published' | 'unpublished' | 'retired';
          let before: Hideable | null = null;
          for (const event of events) {
            const next = transitionCourse(status, event, { statusBeforeHidden: before });
            if (!next.ok) continue;
            if (!LEGAL[status].includes(next.value)) return false;
            if (status === 'retired' && next.value === 'published') return false;
            before = next.value === 'hidden' ? (status as Hideable) : null;
            status = next.value;
          }
          return true;
        },
      ),
      { seed: 61116, numRuns: 500 },
    );
  });
});

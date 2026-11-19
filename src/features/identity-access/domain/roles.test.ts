// BR4.2–BR4.8 role rules.
import { describe, expect, it } from 'vitest';
import type { Actor } from './actor.schema.ts';
import { canManageRoles, checkAssign, checkRevoke } from './roles.ts';

const admin: Actor = {
  userId: '00000000-0000-4000-8000-000000000001',
  roles: ['student', 'admin'],
  locale: 'en',
  hasStepUp: true,
};
const ready = {
  target: { exists: true, isEmailVerified: true, status: 'active' },
  isAlreadyHeld: false,
};

describe('role rules', () => {
  it('requires Admin with step-up (BR4.2)', () => {
    expect(canManageRoles(admin)).toBe(true);
    expect(canManageRoles({ ...admin, hasStepUp: false })).toBe(false);
    expect(canManageRoles({ ...admin, roles: ['student', 'finance'] })).toBe(false);
    expect(checkAssign({ ...admin, hasStepUp: false }, { role: 'finance' }, ready)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });
  it('assigns only to verified, active accounts (BR4.3)', () => {
    expect(
      checkAssign(
        admin,
        { role: 'finance' },
        { ...ready, target: { exists: true, isEmailVerified: false, status: 'unverified' } },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE' },
    });
    expect(
      checkAssign(
        admin,
        { role: 'finance' },
        { ...ready, target: { exists: false, isEmailVerified: false, status: '' } },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });
  it('needs an instructor type for Instructor only (BR4.4)', () => {
    expect(checkAssign(admin, { role: 'instructor' }, ready)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(checkAssign(admin, { role: 'admin', instructorType: 'employee' }, ready)).toMatchObject({
      ok: false,
    });
    expect(checkAssign(admin, { role: 'instructor', instructorType: 'contractor' }, ready)).toEqual(
      { ok: true, value: undefined },
    );
  });
  it('refuses a role that is already held (BR4.8)', () => {
    expect(
      checkAssign(admin, { role: 'finance' }, { ...ready, isAlreadyHeld: true }),
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  });
  it('refuses removing the last Admin (BR4.6) and unknown assignments', () => {
    expect(
      checkRevoke(admin, { role: 'admin' }, { isHeld: true, otherActiveAdmins: 0 }),
    ).toMatchObject({
      ok: false,
      error: { code: 'LAST_ADMIN', i18nKey: 'errors.identity.LAST_ADMIN' },
    });
    expect(checkRevoke(admin, { role: 'admin' }, { isHeld: true, otherActiveAdmins: 1 }).ok).toBe(
      true,
    );
    expect(
      checkRevoke(admin, { role: 'finance' }, { isHeld: false, otherActiveAdmins: 3 }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(
      checkRevoke(
        { ...admin, roles: ['student'] },
        { role: 'finance' },
        { isHeld: true, otherActiveAdmins: 3 },
      ),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  });
});

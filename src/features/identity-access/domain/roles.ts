// Role rules (BR4.1–BR4.9) as pure functions over facts loaded by the service.
import type { AppError } from '#src/lib/errors.ts';
import { appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Actor, InstructorType, StaffRole } from './actor.schema.ts';

export function canManageRoles(actor: Actor): boolean {
  return actor.roles.includes('admin') && actor.hasStepUp;
}

export type AssignFacts = {
  target: { exists: boolean; isEmailVerified: boolean; status: string };
  isAlreadyHeld: boolean;
};

export function checkAssign(
  actor: Actor,
  input: { role: StaffRole; instructorType?: InstructorType | undefined },
  facts: AssignFacts,
): Result<void, AppError> {
  if (!canManageRoles(actor)) return err(appError('FORBIDDEN'));
  if (!facts.target.exists) return err(appError('NOT_FOUND'));
  if (!facts.target.isEmailVerified || facts.target.status !== 'active') {
    return err(
      appError('INVALID_STATE', { details: { reason: 'account_not_verified_or_active' } }),
    );
  }
  if (input.role === 'instructor' && !input.instructorType) {
    return err(
      appError('VALIDATION_FAILED', {
        fieldErrors: { instructorType: ['errors.validation.required'] },
      }),
    );
  }
  if (input.role !== 'instructor' && input.instructorType) {
    return err(
      appError('VALIDATION_FAILED', {
        fieldErrors: { instructorType: ['errors.validation.not_allowed'] },
      }),
    );
  }
  if (facts.isAlreadyHeld) return err(appError('CONFLICT'));
  return ok(undefined);
}

export function checkRevoke(
  actor: Actor,
  input: { role: StaffRole },
  facts: { isHeld: boolean; otherActiveAdmins: number },
): Result<void, AppError> {
  if (!canManageRoles(actor)) return err(appError('FORBIDDEN'));
  if (!facts.isHeld) return err(appError('NOT_FOUND'));
  if (input.role === 'admin' && facts.otherActiveAdmins === 0) {
    return err(appError('LAST_ADMIN', { namespace: 'identity' }));
  }
  return ok(undefined);
}

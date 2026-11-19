// Contract 3 public surface of IdentityAccess. Other units import only from here.

export { authedFn, publicFn, roleFn } from '#src/server/fn.ts';
export { AccountCreatedV1 } from './domain/account-created.schema.ts';
export { Actor, InstructorType, JobActor, Role } from './domain/actor.schema.ts';
export { getIdentity } from './server/identity-instance.server.ts';
export { phoneOf } from './server/profile.server.ts';
export {
  isAccountSuspended,
  reinstateAccount,
  suspendAccount,
} from './server/suspension.server.ts';

// TrustOps public surface for other units: the holds an open fraud flag places. Server-only.
export { isVaultItemHeld } from './domain/fraud.ts';
export {
  isReferralQuarantined,
  shieldIneligible,
  vaultHeldUpTo,
} from './server/fraud-holds.server.ts';

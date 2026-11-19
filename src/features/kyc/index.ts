// KYC public surface (contract 17). Server-only, in-process functions.
export { SavePayoutAccountInput, SubmitKycInput } from './server/kyc.schema.ts';
export {
  flagForReverification,
  getMyKyc,
  getVerificationStatus,
  type MyKyc,
  savePayoutAccount,
  submitKyc,
} from './server/kyc.server.ts';

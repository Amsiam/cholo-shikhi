// Marketing public surface for other units (Commerce's checkout). Server-only, in-process functions.
export type { PromoError } from './domain/pricing.ts';
export {
  type ActiveBundle,
  activeBundle,
  claimPromoUse,
  type PromoClaim,
  releasePromoUse,
} from './server/marketing.server.ts';

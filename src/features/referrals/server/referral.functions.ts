// Referral server functions (S18 Me → Refer and the /r/$code link). The Refer page and opening
// one's own link mark the browser as the referrer's own device (AC8.6.2); a visitor's link code is
// kept in a cookie until they sign in, when the app shell claims it.
import { createServerFn } from '@tanstack/react-start';
import { getIdentity } from '#src/features/identity-access/index.ts';
import { SavePayoutAccountInput, SubmitKycInput } from '#src/features/kyc/index.ts';
import { ok } from '#src/lib/result.ts';
import { authedFn, publicFn, roleFn, setServerFnCookie, typedInput } from '#src/server/fn.ts';
import { DecideWithdrawalInput, NoInput, ReferralCodeInput } from './referral.schema.ts';
import {
  type ClaimOutcome,
  claimReferral,
  isOwnCode,
  myReferral,
  PENDING_REFERRAL_COOKIE,
  SELF_REFERRAL_COOKIE,
} from './referral.server.ts';
import {
  decideWithdrawal,
  declareAdult,
  myReferralPayout,
  referralAdmin,
  requestWithdrawal,
  saveReferrerPayoutAccount,
  submitReferrerKyc,
} from './withdrawal.server.ts';

const YEAR = 365 * 24 * 60 * 60;
const MONTH = 30 * 24 * 60 * 60;
const cookie = (maxAge: number) => ({
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  maxAge,
});

export function requestCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export const getMyReferral = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(
    authedFn(NoInput, async ({ actor }) => {
      const r = await myReferral(actor);
      if (r.ok) setServerFnCookie(SELF_REFERRAL_COOKIE, r.value.code, cookie(YEAR));
      return r;
    }),
  );

/**
 * Explicitly public: anyone may open a referral link. The owner's own browser is marked; a
 * signed-in friend is attributed at once; a visitor's code waits in a cookie until they sign in.
 */
export const openReferralLink = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ReferralCodeInput>())
  .handler(
    publicFn(ReferralCodeInput, async ({ input, request }) => {
      // Public builders carry no actor; a signed-in visitor is read from the session here.
      const session = await getIdentity().getActor(request);
      const actor = session.ok ? session.value : null;
      if (!actor) {
        setServerFnCookie(PENDING_REFERRAL_COOKIE, input.code, cookie(MONTH));
        return ok({ outcome: 'pending' as ClaimOutcome });
      }
      if (await isOwnCode(actor.userId, input.code)) {
        setServerFnCookie(SELF_REFERRAL_COOKIE, input.code, cookie(YEAR));
        return ok({ outcome: 'own_code' as ClaimOutcome });
      }
      return claimReferral(actor, input, requestCookie(request, SELF_REFERRAL_COOKIE));
    }),
  );

/** S18 payout part: adult declaration, KYC, threshold, why not payable, withdrawals. */
export const getMyReferralPayout = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => myReferralPayout(actor)));

export const declareReferrerAdult = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof NoInput>())
  .handler(
    authedFn(NoInput, async ({ actor, correlationId }) => declareAdult(actor, correlationId)),
  );

export const submitMyReferrerKyc = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SubmitKycInput>())
  .handler(authedFn(SubmitKycInput, async ({ actor, input }) => submitReferrerKyc(actor, input)));

export const saveMyReferrerPayoutAccount = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SavePayoutAccountInput>())
  .handler(
    authedFn(SavePayoutAccountInput, async ({ actor, input, correlationId }) =>
      saveReferrerPayoutAccount(actor, input, correlationId),
    ),
  );

export const requestReferralWithdrawal = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => requestWithdrawal(actor)));

/** A1: referral settings and payouts, for the owner-operator (Admin with two-step sign-in). */
export const getReferralAdmin = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn('admin', NoInput, async ({ actor }) => referralAdmin(actor)));

export const decideReferralWithdrawal = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof DecideWithdrawalInput>())
  .handler(
    roleFn('admin', DecideWithdrawalInput, async ({ actor, input, correlationId }) =>
      decideWithdrawal(actor, input, correlationId),
    ),
  );

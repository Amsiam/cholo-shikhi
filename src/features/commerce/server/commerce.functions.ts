// Checkout server functions. Every one needs a signed-in user and only touches that user's own
// payments; the fake gateway answers FEATURE_DISABLED wherever it is not allowed (always in
// production).
import { createServerFn } from '@tanstack/react-start';
import { ok } from '#src/lib/result.ts';
import { authedFn, publicFn, roleFn, typedInput } from '#src/server/fn.ts';
import {
  bundleOffer,
  getBundleOrder,
  settleFakeBundleOrder,
  startBundleCheckout,
} from './bundle.server.ts';
import {
  BundleOfferInput,
  BundleOrderRef,
  DecideRefundInput,
  DecideSwitchInput,
  NoInput,
  PaymentRefInput,
  ProductCheckoutInput,
  ProductOrderRef,
  RefundQueueInput,
  RequestRefundInput,
  RequestSwitchInput,
  SettleBundleOrderInput,
  SettleFakePaymentInput,
  SettleProductOrderInput,
  StartCheckoutInput,
  SwitchOptionsInput,
} from './commerce.schema.ts';
import {
  enrolmentStatus,
  getCheckout,
  getMyPurchase,
  listMyPurchases,
  settleFakePayment,
  startCheckout,
} from './commerce.server.ts';
import {
  entitlementsOf,
  getProductOrder,
  listMyOrders,
  settleFakeProductOrder,
  startProductCheckout,
} from './product.server.ts';
import { decideRefund, refundQueue, requestRefund } from './refund.server.ts';
import { decideSwitch, requestSwitch, switchOptions, switchQueue } from './switch.server.ts';
import {
  clearTrialCourse,
  listTrialCourses,
  setTrialCourse,
  startTrial,
  trialStatusFor,
} from './trial.server.ts';

export const startCourseCheckout = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof StartCheckoutInput>())
  .handler(authedFn(StartCheckoutInput, async ({ actor, input }) => startCheckout(actor, input)));

export const getMyCheckout = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof PaymentRefInput>())
  .handler(authedFn(PaymentRefInput, async ({ actor, input }) => getCheckout(actor, input)));

export const settleMyFakePayment = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SettleFakePaymentInput>())
  .handler(
    authedFn(SettleFakePaymentInput, async ({ actor, input }) => settleFakePayment(actor, input)),
  );

/** Whether the caller holds an active enrolment in the course (S4's Buy / Continue switch). */
export const getMyEnrolmentStatus = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof StartCheckoutInput>())
  .handler(
    authedFn(StartCheckoutInput, async ({ actor, input }) =>
      ok(await enrolmentStatus(actor.userId, input.courseId)),
    ),
  );

/** The caller's own payments and access periods (purchase history). */
export const getMyPurchases = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => listMyPurchases(actor)));

/** One receipt of the caller's own. */
export const getMyReceipt = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof PaymentRefInput>())
  .handler(authedFn(PaymentRefInput, async ({ actor, input }) => getMyPurchase(actor, input)));

// Free trial (FR-DIST-1): Students start their own; Admins designate the trial course per segment.
export const startMyTrial = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof StartCheckoutInput>())
  .handler(authedFn(StartCheckoutInput, async ({ actor, input }) => startTrial(actor, input)));

export const getMyTrialStatus = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof StartCheckoutInput>())
  .handler(
    authedFn(StartCheckoutInput, async ({ actor, input }) =>
      ok(await trialStatusFor(actor.userId, input.courseId)),
    ),
  );

export const listTrialCourseOffers = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn(['admin'], NoInput, async () => listTrialCourses()));

export const setSegmentTrialCourse = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof StartCheckoutInput>())
  .handler(
    roleFn(['admin'], StartCheckoutInput, async ({ actor, input }) => setTrialCourse(actor, input)),
  );

export const clearSegmentTrialCourse = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof StartCheckoutInput>())
  .handler(roleFn(['admin'], StartCheckoutInput, async ({ input }) => clearTrialCourse(input)));

// Refunds (US2.26, US2.27): the Student asks; an Admin decides.
export const requestMyRefund = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof RequestRefundInput>())
  .handler(authedFn(RequestRefundInput, async ({ actor, input }) => requestRefund(actor, input)));

export const listRefundRequests = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof RefundQueueInput>())
  .handler(roleFn(['admin'], RefundQueueInput, async ({ input }) => refundQueue(input)));

export const decideRefundRequest = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof DecideRefundInput>())
  .handler(
    roleFn(['admin'], DecideRefundInput, async ({ actor, input }) => decideRefund(actor, input)),
  );

// Practice Packs, exam packages and subscription plans.
export const startProductOrder = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof ProductCheckoutInput>())
  .handler(
    authedFn(ProductCheckoutInput, async ({ actor, input }) => startProductCheckout(actor, input)),
  );

export const getMyProductOrder = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof ProductOrderRef>())
  .handler(authedFn(ProductOrderRef, async ({ actor, input }) => getProductOrder(actor, input)));

export const settleMyFakeProductOrder = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SettleProductOrderInput>())
  .handler(
    authedFn(SettleProductOrderInput, async ({ actor, input }) =>
      settleFakeProductOrder(actor, input),
    ),
  );

export const getMyProductOrders = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => ok(await listMyOrders(actor))));

export const getMyEntitlements = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => ok(await entitlementsOf(actor.userId))));

/** US2.17 (S4): the switch block for a course the Student does not own. */
export const getMySwitchOptions = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof SwitchOptionsInput>())
  .handler(authedFn(SwitchOptionsInput, async ({ actor, input }) => switchOptions(actor, input)));

export const requestMyCourseSwitch = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof RequestSwitchInput>())
  .handler(authedFn(RequestSwitchInput, async ({ actor, input }) => requestSwitch(actor, input)));

/** US2.18 (A2): the switch queue and its decisions (Admin with two-step sign-in). */
export const listSwitchRequests = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn('admin', NoInput, async ({ actor }) => switchQueue(actor)));

export const decideSwitchRequest = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof DecideSwitchInput>())
  .handler(
    roleFn('admin', DecideSwitchInput, async ({ actor, input, correlationId }) =>
      decideSwitch(actor, input, correlationId),
    ),
  );

// US8.5 bundles. The bundle page is explicitly public, like the catalog's bundle list.
export const getBundleOffer = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof BundleOfferInput>())
  .handler(publicFn(BundleOfferInput, async ({ input }) => bundleOffer(input)));

export const startBundleOrder = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof BundleOfferInput>())
  .handler(
    authedFn(BundleOfferInput, async ({ actor, input }) => startBundleCheckout(actor, input)),
  );

export const getMyBundleOrder = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof BundleOrderRef>())
  .handler(authedFn(BundleOrderRef, async ({ actor, input }) => getBundleOrder(actor, input)));

export const settleMyFakeBundleOrder = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SettleBundleOrderInput>())
  .handler(
    authedFn(SettleBundleOrderInput, async ({ actor, input }) =>
      settleFakeBundleOrder(actor, input),
    ),
  );

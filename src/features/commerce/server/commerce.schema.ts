// One Zod schema per commerce read and write, shared by the screens and the server functions.
import { z } from 'zod';
import { Id } from '#src/lib/ids.ts';

export const StartCheckoutInput = z.object({
  courseId: Id,
  /** US8.3: an optional promo code; the discounted price is what the gateway is asked for. */
  promoCode: z.string().trim().min(1).max(40).optional(),
});
export type StartCheckoutInput = z.input<typeof StartCheckoutInput>;

export const PaymentRefInput = z.object({ paymentId: Id });
export type PaymentRefInput = z.input<typeof PaymentRefInput>;

export const SettleFakePaymentInput = z.object({
  paymentId: Id,
  outcome: z.enum(['succeed', 'fail']),
});
export type SettleFakePaymentInput = z.input<typeof SettleFakePaymentInput>;

export const NoInput = z.object({});

export const SegmentRefInput = z.object({ segmentId: Id });
export type SegmentRefInput = z.input<typeof SegmentRefInput>;

export const RequestRefundInput = z.object({
  paymentId: Id,
  reason: z.string().trim().min(10).max(1000),
});
export type RequestRefundInput = z.input<typeof RequestRefundInput>;

export const RefundQueueInput = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  page: z.number().int().min(1).max(10_000).default(1),
});
export type RefundQueueInput = z.input<typeof RefundQueueInput>;

export const DecideRefundInput = z.object({
  refundId: Id,
  decision: z.enum(['approve', 'reject']),
  policy: z.enum(['full', 'unused', 'partial']).optional(),
  partialPoisha: z.number().int().min(1).optional(),
  note: z.string().max(1000).optional(),
});
export type DecideRefundInput = z.input<typeof DecideRefundInput>;

export const ProductCheckoutInput = z.object({
  productType: z.enum(['practice_pack', 'exam_package', 'subscription_plan']),
  productId: Id,
});
export type ProductCheckoutInput = z.input<typeof ProductCheckoutInput>;

export const ProductOrderRef = z.object({ orderId: Id });
export type ProductOrderRef = z.input<typeof ProductOrderRef>;

export const SettleProductOrderInput = z.object({
  orderId: Id,
  outcome: z.enum(['succeed', 'fail']),
});
export type SettleProductOrderInput = z.input<typeof SettleProductOrderInput>;

/** US2.17: ask to switch a paid course for another. */
export const RequestSwitchInput = z.object({ fromCourseId: Id, toCourseId: Id });
export type RequestSwitchInput = z.input<typeof RequestSwitchInput>;
export const SwitchOptionsInput = z.object({ courseId: Id });
export type SwitchOptionsInput = z.input<typeof SwitchOptionsInput>;
/** US2.18: approve with a refund policy, or deny with a reason. */
export const DecideSwitchInput = z.object({
  switchId: Id,
  decision: z.enum(['approve', 'deny']),
  policy: z.enum(['full', 'unused']).optional(),
  reason: z.string().max(1000).optional(),
});
export type DecideSwitchInput = z.input<typeof DecideSwitchInput>;

/** US8.5: a bundle's page and its checkout. */
export const BundleOfferInput = z.object({ bundleId: Id });
export type BundleOfferInput = z.input<typeof BundleOfferInput>;

export const BundleOrderRef = z.object({ orderId: Id });
export type BundleOrderRef = z.input<typeof BundleOrderRef>;

export const SettleBundleOrderInput = z.object({
  orderId: Id,
  outcome: z.enum(['succeed', 'fail']),
});
export type SettleBundleOrderInput = z.input<typeof SettleBundleOrderInput>;

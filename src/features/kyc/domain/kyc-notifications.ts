// Notification types the KYC feature sends (contract 4). Payment category: always delivered, the
// Student cannot switch them off. Params never carry an NID, an account number or a reason text.
import { defineNotificationType } from '#src/features/notifications/domain/notification-types.ts';
import type { MessageKey } from '#src/lib/i18n/index.ts';

export const KYC_TYPES = {
  kycVerified: 'notify.kyc.verified',
  kycRejected: 'notify.kyc.rejected',
  accountChanged: 'notify.kyc.accountChanged',
  accountVerified: 'notify.kyc.accountVerified',
  accountRejected: 'notify.kyc.accountRejected',
} as const;

const type = (typeKey: string, key: string) =>
  defineNotificationType({
    typeKey,
    category: 'payment',
    defaultChannels: ['in_app', 'email'],
    titleKey: `notify.kyc.${key}.title` as MessageKey,
    bodyKey: `notify.kyc.${key}.body` as MessageKey,
  });

export const KYC_NOTIFICATION_TYPES = [
  type(KYC_TYPES.kycVerified, 'verified'),
  type(KYC_TYPES.kycRejected, 'rejected'),
  type(KYC_TYPES.accountChanged, 'accountChanged'),
  type(KYC_TYPES.accountVerified, 'accountVerified'),
  type(KYC_TYPES.accountRejected, 'accountRejected'),
] as const;

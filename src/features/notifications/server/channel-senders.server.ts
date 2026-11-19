// Channel ports. Push and SMS are built behind switches that are off at launch (TS-09, BR12.4,
// BR12.20); no real provider is wired. The email port lives in email-sender.server.ts.
export type PushSender = { send(endpoint: string, payload: string): Promise<void> };
export type SmsSender = {
  send(input: { recipientUserId: string; text: string }): Promise<{ providerMessageId: string }>;
};

export class ChannelUnavailableError extends Error {
  constructor(channel: string) {
    super(`${channel} provider is not configured`);
    this.name = 'ChannelUnavailableError';
  }
}

/** Default push adapter: no provider (web push not approved; residency question R-01 open). */
export const unavailablePushSender: PushSender = {
  async send() {
    throw new ChannelUnavailableError('push');
  },
};

/** Default SMS adapter: no provider until SMS goes live. */
export const unavailableSmsSender: SmsSender = {
  async send() {
    throw new ChannelUnavailableError('sms');
  },
};

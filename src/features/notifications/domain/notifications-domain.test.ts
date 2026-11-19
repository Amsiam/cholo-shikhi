// [LT] channel routing, rendering and type rules.
import { describe, expect, it } from 'vitest';
import { resolveChannels } from './channels.ts';
import { defineNotificationType, U1_NOTIFICATION_TYPES } from './notification-types.ts';
import { displayParams, pushPayload, renderNotification } from './render.ts';

const base = {
  requested: ['in_app', 'email'] as const,
  isSmsEnabled: false,
  isPushEnabled: false,
  isLocked: false,
  preferences: {},
};

describe('resolveChannels (BR12.3)', () => {
  it('falls back from SMS to in-app, push and email while SMS is off; push is then gated', () => {
    expect(resolveChannels({ ...base, requested: ['sms'] })).toEqual(['in_app', 'email']);
    expect(resolveChannels({ ...base, requested: ['sms'], isPushEnabled: true })).toEqual([
      'in_app',
      'push',
      'email',
    ]);
    expect(resolveChannels({ ...base, requested: ['sms'], isSmsEnabled: true })).toEqual(['sms']);
  });
  it('applies preferences, and switching in-app off also switches push off (BR12.9)', () => {
    expect(
      resolveChannels({
        ...base,
        requested: ['in_app', 'push', 'email'],
        isPushEnabled: true,
        preferences: { in_app: false },
      }),
    ).toEqual(['email']);
    expect(resolveChannels({ ...base, preferences: { email: false } })).toEqual(['in_app']);
  });
  it('ignores preferences for locked security and payment types (BR12.8)', () => {
    expect(
      resolveChannels({ ...base, isLocked: true, preferences: { in_app: false, email: false } }),
    ).toEqual(['in_app', 'email']);
  });
  it('may resolve to no channel, which records the notice as suppressed (BR12.19)', () => {
    expect(resolveChannels({ ...base, preferences: { in_app: false, email: false } })).toEqual([]);
  });
});

describe('types', () => {
  it('locks exactly security and payment types', () => {
    expect(U1_NOTIFICATION_TYPES.map((t) => t.isLocked)).toEqual([false, true]);
    expect(() =>
      defineNotificationType({
        typeKey: 'bad',
        category: 'account',
        defaultChannels: ['in_app'],
        titleKey: 'notify.account.welcome.title',
        bodyKey: 'notify.account.welcome.body',
      }),
    ).toThrow();
    expect(() =>
      defineNotificationType({
        typeKey: 'notify.x',
        category: 'account',
        defaultChannels: [],
        titleKey: 'notify.account.welcome.title',
        bodyKey: 'notify.account.welcome.body',
      }),
    ).toThrow();
  });
});

describe('rendering', () => {
  it('formats money in the language and masks account fragments to the last 4', () => {
    expect(displayParams({ amountPoisha: 150000, accountLast4: '0011223344556789' }, 'bn')).toEqual(
      { amountPoisha: '৳১,৫০০.০০', accountLast4: '••••6789' },
    );
    expect(displayParams({ flag: true, n: 3 }, 'en')).toEqual({ flag: 'true', n: 3 });
    expect(displayParams({ amountPoisha: 1.5 }, 'en')).toEqual({ amountPoisha: '' });
  });
  it('renders the title and body in the requested language', () => {
    const [welcome] = U1_NOTIFICATION_TYPES;
    expect(renderNotification(welcome, {}, 'en').title).toBe('Welcome to Cholo Shikhi');
    expect(renderNotification(welcome, {}, 'bn').title).toBe('চলো শিখি-তে স্বাগতম');
  });
  it('builds a generic push payload only', () => {
    expect(JSON.parse(pushPayload('en'))).toEqual({ title: 'You have a new notification' });
  });
});

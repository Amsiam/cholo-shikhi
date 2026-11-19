// App-shell server functions: the root loader's shell state, the language switch, the staff two-step
// screen and the local dev mailbox. Two-step calls are public builders whose handlers require a session
// in the matching pending state (the identity service checks it), because staff are not yet "active".
import { createServerFn } from '@tanstack/react-start';
import {
  RecoveryCodeInput,
  TwoFactorCodeInput,
} from '#src/features/identity-access/server/auth.schema.ts';
import { getIdentity } from '#src/features/identity-access/server/identity-instance.server.ts';
import { readDevMailbox } from '#src/features/notifications/server/email-sender.server.ts';
import { getNotifications } from '#src/features/notifications/server/notifications-instance.server.ts';
import { U1_SETTINGS } from '#src/features/platform/domain/u1-settings.ts';
import { getFlags } from '#src/features/platform/server/flags-instance.server.ts';
import { getSettings } from '#src/features/platform/server/settings-instance.server.ts';
import {
  claimReferral,
  PENDING_REFERRAL_COOKIE,
  SELF_REFERRAL_COOKIE,
} from '#src/features/referrals/index.ts';
import { getEnv } from '#src/lib/env.ts';
import { appError } from '#src/lib/errors.ts';
import { isLocale, resolveDeviceLocale } from '#src/lib/i18n/locale.ts';
import { err, ok } from '#src/lib/result.ts';
import { publicFn, setServerFnCookie, typedInput } from '#src/server/fn.ts';
import { LanguageInput, NoInput } from './shell.schema.ts';

const LOCALE_COOKIE = 'cs_locale';

/** Reads one cookie from the request (the device's saved language). */
function requestCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export type ShellState = {
  locale: 'bn' | 'en';
  isSignedIn: boolean;
  sessionState: string;
  roles: string[];
  hasStepUp: boolean;
  unread: number;
  /** The signed-in user's own display name ('' when signed out or unset), for the dashboard greeting. */
  displayName: string;
  installPrompt: { isFlagOn: boolean; minVisits: number; dismissDays: number };
};

export const getShellState = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(
    publicFn(NoInput, async ({ request }) => {
      const identity = getIdentity();
      const actor = await identity.getActor(request);
      const sessionState = actor.ok ? 'active' : await identity.sessionState(request);
      // US8.6: a referral link opened before signing in is claimed once the visitor is signed in.
      const pendingReferral = requestCookie(request, PENDING_REFERRAL_COOKIE);
      if (actor.ok && pendingReferral) {
        try {
          await claimReferral(
            actor.value,
            { code: pendingReferral },
            requestCookie(request, SELF_REFERRAL_COOKIE),
          );
        } finally {
          setServerFnCookie(PENDING_REFERRAL_COOKIE, '', {
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: 0,
          });
        }
      }
      // BR6.2/BR6.3: the account language when signed in, otherwise the device's saved language.
      const deviceLocale = resolveDeviceLocale(
        request.headers.get('accept-language'),
        requestCookie(request, LOCALE_COOKIE),
      );
      const settings = getSettings();
      const [minVisits, dismissDays] = await Promise.all([
        settings.get(U1_SETTINGS.installPromptMinVisits),
        settings.get(U1_SETTINGS.installPromptDismissDays),
      ]);
      const state: ShellState = {
        locale: actor.ok ? actor.value.locale : deviceLocale,
        isSignedIn: actor.ok,
        sessionState,
        roles: actor.ok ? actor.value.roles : [],
        hasStepUp: actor.ok && actor.value.hasStepUp,
        unread: actor.ok ? await getNotifications().unreadCount(actor.value) : 0,
        displayName: actor.ok
          ? ((await identity.displayNamesOf([actor.value.userId]))[actor.value.userId] ?? '')
          : '',
        installPrompt: {
          isFlagOn: await getFlags().isEnabled(
            'appshell.installPrompt',
            actor.ok ? { userId: actor.value.userId } : {},
          ),
          minVisits: minVisits.ok ? minVisits.value.value : 2,
          dismissDays: dismissDays.ok ? dismissDays.value.value : 7,
        },
      };
      return ok(state);
    }),
  );

/** BR6.1: saves the choice to the account when signed in, and to the device either way. */
export const setLanguage = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof LanguageInput>())
  .handler(
    publicFn(LanguageInput, async ({ input, request }) => {
      const identity = getIdentity();
      const actor = await identity.getActor(request);
      if (actor.ok) {
        const saved = await identity.setLocale(request, input.locale);
        if (!saved.ok) return saved;
      }
      setServerFnCookie(LOCALE_COOKIE, input.locale, {
        path: '/',
        sameSite: 'lax',
        secure: true,
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 365,
      });
      return ok({ locale: isLocale(input.locale) ? input.locale : 'bn' });
    }),
  );

export const getTwoStepState = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(
    publicFn(NoInput, async ({ request }) =>
      ok({ state: await getIdentity().sessionState(request) }),
    ),
  );

export const startTwoStepEnrolment = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof NoInput>())
  .handler(
    publicFn(NoInput, async ({ request }) => {
      const result = await getIdentity().twoFactor.beginEnrolment(request);
      // The secret leaves the server only here, at enrolment (BR5.8).
      return result.ok
        ? ok({ setupKeyGroups: result.value.setupKeyGroups, otpauthUri: result.value.otpauthUri })
        : result;
    }),
  );

export const confirmTwoStepEnrolment = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof TwoFactorCodeInput>())
  .handler(
    publicFn(TwoFactorCodeInput, async ({ request, input }) =>
      getIdentity().twoFactor.confirmEnrolment(request, input.code),
    ),
  );

export const verifyTwoStepCode = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof TwoFactorCodeInput>())
  .handler(
    publicFn(TwoFactorCodeInput, async ({ request, input }) =>
      getIdentity().twoFactor.challenge(request, input.code),
    ),
  );

export const redeemTwoStepRecoveryCode = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof RecoveryCodeInput>())
  .handler(
    publicFn(RecoveryCodeInput, async ({ request, input }) =>
      getIdentity().twoFactor.useRecoveryCode(request, input.code),
    ),
  );

/** Local development only: the stub email adapter's mailbox. NOT_FOUND whenever NODE_ENV is not development. */
export const getDevMailbox = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(
    publicFn(NoInput, async () => {
      if (getEnv().NODE_ENV !== 'development') return err(appError('NOT_FOUND'));
      return ok(
        readDevMailbox()
          .slice(0, 50)
          .map((m) => ({
            id: m.id,
            to: m.to,
            kind: m.kind,
            subject: m.subject,
            link: m.link,
            sentAt: m.sentAt,
          })),
      );
    }),
  );

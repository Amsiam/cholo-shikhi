import { createFileRoute, getRouteApi, Link, redirect, useRouter } from '@tanstack/react-router';
import { Bell, ChevronRight, Languages, Target } from 'lucide-react';
import { getShellState, setLanguage } from '#src/features/app-shell/server/shell.functions.ts';
import { LanguageSwitcher } from '#src/features/app-shell/ui/LanguageSwitcher.tsx';
import {
  getMyProfileDetails,
  saveMyProfile,
} from '#src/features/identity-access/server/profile.functions.ts';
import type { Profile } from '#src/features/identity-access/server/profile.server.ts';
import { ChangePasswordForm, ProfileForm } from '#src/features/identity-access/ui/ProfileForms.tsx';
import { SignOutButton } from '#src/features/identity-access/ui/SignOutButton.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

const root = getRouteApi('__root__');

// S12 Me: language setting and sign-out (within 2 taps of Home, AC1.4.1).
export const Route = createFileRoute('/me')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async () => {
    const profile = await getMyProfileDetails({ data: {} });
    return profile.ok ? (profile.value as Profile) : null;
  },
  component: MePage,
});

function MePage() {
  const { t } = useI18n();
  const router = useRouter();
  root.useLoaderData();
  const profile = Route.useLoaderData();
  const row =
    'flex min-h-14 items-center gap-3 px-5 font-medium text-ink hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50';
  return (
    <section className="flex max-w-2xl flex-col gap-6" data-testid="me-page">
      <h1>{t('dashboard.nav.settings')}</h1>
      {profile ? (
        <ProfileForm
          // Remount after a save so the fields show the stored (normalised) values.
          key={`${profile.name}|${profile.phone ?? ''}`}
          profile={profile}
          onSave={async (input) => {
            const r = await saveMyProfile({ data: input });
            if (r.ok) await router.invalidate();
            return r.ok ? { ok: true } : { ok: false, ...r.error };
          }}
        />
      ) : null}
      <ChangePasswordForm
        onChange={async (input) => {
          const response = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
            credentials: 'same-origin',
          });
          if (response.ok) return { ok: true };
          const body = (await response.json().catch(() => null)) as {
            i18nKey?: string;
            fieldErrors?: Record<string, string[]>;
          } | null;
          return {
            ok: false,
            i18nKey: body?.i18nKey ?? 'errors.profile.passwordWrong',
            ...(body?.fieldErrors ? { fieldErrors: body.fieldErrors } : {}),
          };
        }}
      />
      <section
        aria-labelledby="me-language-title"
        className="flex flex-col gap-3 border border-primary/15 bg-background p-5"
      >
        <h2 id="me-language-title" className="flex items-center gap-2 text-lg">
          <Languages aria-hidden="true" className="size-5 text-primary" />
          {t('shell.language.label')}
        </h2>
        <LanguageSwitcher
          onChange={async (locale) => {
            await setLanguage({ data: { locale } });
            await router.invalidate();
          }}
        />
      </section>
      <nav
        aria-label={t('me.shortcuts')}
        className="flex flex-col divide-y divide-primary/10 border border-primary/15 bg-background"
      >
        <Link className={row} to="/me/goal" data-testid="me-goal">
          <Target aria-hidden="true" className="size-5 text-primary" />
          <span className="flex-1">{t('me.goal.link')}</span>
          <ChevronRight aria-hidden="true" className="size-5 text-ink-muted" />
        </Link>
        <Link className={row} to="/notifications" data-testid="me-notifications">
          <Bell aria-hidden="true" className="size-5 text-primary" />
          <span className="flex-1">{t('shell.nav.notifications')}</span>
          <ChevronRight aria-hidden="true" className="size-5 text-ink-muted" />
        </Link>
      </nav>
      <div>
        <SignOutButton
          onSignedOut={async () => {
            await router.invalidate();
            await router.navigate({ to: '/sign-in' });
          }}
        />
      </div>
    </section>
  );
}

import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import { RotateCw } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import type { ShellState } from '#src/features/app-shell/server/shell.functions.ts';
import { getShellState, setLanguage } from '#src/features/app-shell/server/shell.functions.ts';
import { AppHeader } from '#src/features/app-shell/ui/AppHeader.tsx';
import { InstallPrompt, OfflineBanner, UpdateBanner } from '#src/features/app-shell/ui/Banners.tsx';
import {
  ErrorScreen,
  errorPrimaryAction,
  errorSecondaryAction,
} from '#src/features/app-shell/ui/ErrorScreen.tsx';
import { StudentShell } from '#src/features/dashboard/ui/StudentShell.tsx';
import { htmlLang } from '#src/lib/i18n/format.ts';
import { I18nProvider, useI18n } from '#src/lib/i18n/react.tsx';
import stylesUrl from '../styles.css?url';

export const Route = createRootRoute({
  loader: async () => {
    const result = await getShellState();
    if (!result.ok) throw new Error(result.error.code);
    return result.value;
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#007370' },
      { title: 'Cholo Shikhi' },
    ],
    links: [
      { rel: 'stylesheet', href: stylesUrl },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
    ],
  }),
  shellComponent: RootShell,
  component: AppLayout,
  errorComponent: RootError,
  notFoundComponent: NotFound,
});

function RootShell({ children }: { children: ReactNode }) {
  // Read from router state: the shell also renders when the root loader failed.
  const shell = useRouterState({
    select: (s) =>
      s.matches.find((m) => m.routeId === '__root__')?.loaderData as ShellState | undefined,
  });
  const locale = shell?.locale ?? 'bn';
  // Set once the whole tree has hydrated (the root's effect runs after every child's), so e2e
  // journeys can wait until event handlers are attached before they interact with the page.
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true';
  }, []);
  return (
    <html lang={htmlLang(locale)}>
      <head>
        <HeadContent />
      </head>
      <body>
        <I18nProvider locale={locale}>{children}</I18nProvider>
        <Scripts />
      </body>
    </html>
  );
}

function AppLayout() {
  const shell = Route.useLoaderData();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The signed-out landing page, the auth pages, the catalog and the course page run full width;
  // every other page keeps the narrow column.
  const isFullWidth =
    pathname === '/' ||
    pathname === '/sign-in' ||
    pathname === '/sign-up' ||
    pathname === '/catalog' ||
    pathname.startsWith('/courses/') ||
    pathname === '/learn' ||
    pathname.startsWith('/learn/') ||
    pathname.startsWith('/checkout/') ||
    /^\/instructor\/courses\/[^/]+(\/sections\/[^/]+|\/stats)?$/.test(pathname) ||
    pathname === '/instructor/earnings' ||
    pathname === '/vault' ||
    pathname === '/practice' ||
    pathname === '/exams' ||
    pathname === '/questions' ||
    pathname === '/store' ||
    pathname === '/live' ||
    pathname.startsWith('/live/') ||
    pathname === '/live-host' ||
    pathname.startsWith('/live-host/') ||
    pathname === '/me/results' ||
    pathname === '/battles' ||
    pathname.startsWith('/battles/') ||
    pathname === '/battle-host' ||
    pathname.startsWith('/exams/') ||
    pathname === '/exam-builder' ||
    pathname.startsWith('/exam-builder/') ||
    pathname === '/bank' ||
    pathname === '/admin/topics' ||
    /^\/admin\/staff\/[^/]+$/.test(pathname) ||
    pathname === '/admin/finance' ||
    pathname === '/admin/refunds';
  // Signed-in Student pages sit inside the Student panel (sidebar on wide screens, drawer on
  // phones). Staff, two-step and dev screens keep the plain layout.
  // Every signed-in page sits in the panel (sidebar on wide screens, drawer on phones); only the
  // two-step and dev screens keep the plain layout.
  const isBarePath = ['/two-step', '/dev'].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const isShellPage = shell.isSignedIn && !isBarePath;
  const content = isFullWidth ? (
    <Outlet />
  ) : (
    <div className="page-frame min-h-[calc(100dvh-3.5rem)] bg-paper text-ink">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <Outlet />
      </div>
    </div>
  );
  return (
    <>
      <UpdateBanner />
      <OfflineBanner />
      {/* Signed-in panel pages draw their own top bar inside the shell (one bar, aligned to the
          sidebar); public, two-step and dev pages keep the plain header. */}
      {isShellPage ? null : (
        <AppHeader
          isSignedIn={shell.isSignedIn}
          isAdmin={shell.roles.includes('admin')}
          unread={shell.unread}
          onLanguageChange={async (locale) => {
            await setLanguage({ data: { locale } });
            await router.invalidate();
          }}
        />
      )}
      <main id="main" className="w-full">
        {isShellPage ? (
          <StudentShell unread={shell.unread} roles={shell.roles} displayName={shell.displayName}>
            {content}
          </StudentShell>
        ) : (
          content
        )}
      </main>
      <InstallPrompt {...shell.installPrompt} />
    </>
  );
}

// Renders in place of the whole layout (a failed root loader leaves no header), so it draws its
// own wordmark bar. Retrying re-runs the loaders, then clears the error boundary.
function RootError(props: { error: unknown; reset: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const message = props.error instanceof Error ? props.error.message : String(props.error);
  return (
    <main id="main" className="w-full">
      <ErrorScreen
        kind="error"
        standalone
        testId="root-error"
        title={t('shell.error.title')}
        body={t('shell.error.body')}
        actions={
          <>
            <button
              type="button"
              className={errorPrimaryAction}
              data-testid="root-error-retry"
              onClick={async () => {
                await router.invalidate();
                props.reset();
              }}
            >
              <RotateCw aria-hidden="true" className="size-4" strokeWidth={2.5} />
              {t('shell.error.retry')}
            </button>
            <a href="/" className={errorSecondaryAction}>
              {t('errorPage.home')}
            </a>
          </>
        }
        footer={
          import.meta.env.DEV && message ? (
            <details className="text-sm text-ink-muted">
              <summary className="tap-target cursor-pointer font-medium">
                {t('errorPage.details')}
              </summary>
              <pre className="mt-2 overflow-x-auto bg-paper p-3 text-xs whitespace-pre-wrap">
                {message}
              </pre>
            </details>
          ) : null
        }
      />
    </main>
  );
}

function NotFound() {
  const { t } = useI18n();
  return (
    <ErrorScreen
      kind="notFound"
      testId="not-found"
      title={t('shell.notFound')}
      body={t('shell.notFound.body')}
      actions={
        <>
          <Link to="/" className={errorPrimaryAction}>
            {t('errorPage.home')}
          </Link>
          <Link to="/catalog" search={{}} className={errorSecondaryAction}>
            {t('errorPage.catalog')}
          </Link>
        </>
      }
    />
  );
}

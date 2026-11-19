// AppShell header: navigation, LanguageSwitcher when signed out, NotificationBell when signed in.
import { Link } from '@tanstack/react-router';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { LanguageSwitcher } from './LanguageSwitcher.tsx';
import { NotificationBell } from './NotificationBell.tsx';

export function AppHeader(props: {
  isSignedIn: boolean;
  isAdmin: boolean;
  unread: number;
  onLanguageChange: (locale: 'bn' | 'en') => void | Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <header className="flex min-h-14 flex-wrap items-center justify-between gap-x-2 border-b border-primary/15 bg-background px-2 py-1.5 sm:px-4">
      <nav className="flex items-center gap-1" aria-label={t('shell.nav.home')}>
        <Link
          to="/"
          className="inline-flex min-h-11 items-center gap-2.5 rounded-sm px-2 text-lg font-extrabold tracking-tight text-ink hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          data-testid="nav-home"
        >
          <span aria-hidden="true" className="size-4 rounded-full border-2 border-omr bg-ink" />
          {t('app.name')}
        </Link>
        <Link
          to="/catalog"
          search={{}}
          className="inline-flex min-h-11 items-center rounded-sm px-2 font-medium hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&.active]:text-primary"
          data-testid="nav-courses"
        >
          {t('shell.nav.courses')}
        </Link>
        {props.isSignedIn ? (
          <Link
            to="/me"
            className="inline-flex min-h-11 items-center rounded-sm px-2 font-medium hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&.active]:text-primary"
            data-testid="nav-me"
          >
            {t('shell.nav.me')}
          </Link>
        ) : null}
        {props.isAdmin ? (
          <Link
            to="/admin"
            className="inline-flex min-h-11 items-center rounded-sm px-2 font-medium hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&.active]:text-primary"
            data-testid="nav-admin"
          >
            {t('shell.nav.admin')}
          </Link>
        ) : null}
      </nav>
      <div className="flex items-center gap-2">
        {props.isSignedIn ? (
          <NotificationBell unread={props.unread} />
        ) : (
          <>
            <LanguageSwitcher onChange={props.onLanguageChange} />
            <Link
              to="/sign-in"
              className="inline-flex min-h-11 items-center rounded-sm px-2 font-medium hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&.active]:text-primary text-primary"
              data-testid="nav-sign-in"
            >
              {t('shell.nav.signIn')}
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

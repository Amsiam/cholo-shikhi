// OfflineBanner (R-STATES), UpdateBanner (BR17.5) and InstallPrompt (BR17.1–BR17.3).
import { useEffect, useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { shouldShowInstallPrompt } from '../domain/install-prompt.ts';

export function OfflineBanner() {
  const { t } = useI18n();
  const [isOffline, setIsOffline] = useState(false);
  useEffect(() => {
    const update = () => setIsOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  if (!isOffline) return null;
  return (
    <p
      role="status"
      className="bg-ink px-4 py-2 text-sm text-ink-foreground"
      data-testid="offline-banner"
    >
      {t('shell.offline')}
    </p>
  );
}

/** The new version waits until the user taps Update; the app never reloads itself (BR17.5). */
export function UpdateBanner() {
  const { t } = useI18n();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let isReloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (isReloading) return;
      isReloading = true;
      window.location.reload();
    });
    void navigator.serviceWorker.register('/sw.js').then((registration) => {
      if (registration.waiting) setWaiting(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller)
            setWaiting(worker);
        });
      });
    });
  }, []);
  if (!waiting) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-2 bg-muted px-4 py-2"
      data-testid="update-banner"
    >
      <span>{t('shell.update.available')}</span>
      <Button
        size="sm"
        data-testid="update-banner-apply"
        onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}
      >
        {t('shell.update.action')}
      </Button>
    </div>
  );
}

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };
const VISITS_KEY = 'cs.visits';
const DISMISSED_KEY = 'cs.installDismissedAt';
const SHOWN_KEY = 'cs.installShown';

export function InstallPrompt(props: {
  isFlagOn: boolean;
  minVisits: number;
  dismissDays: number;
}) {
  const { t } = useI18n();
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => {
    const visits = Number(localStorage.getItem(VISITS_KEY) ?? '0') + 1;
    localStorage.setItem(VISITS_KEY, String(visits));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      const facts = {
        isFlagOn: props.isFlagOn,
        isPromptAvailable: true,
        visits,
        minVisits: props.minVisits,
        dismissedAt: localStorage.getItem(DISMISSED_KEY),
        hasShown: localStorage.getItem(SHOWN_KEY) === '1',
        dismissDays: props.dismissDays,
        now: new Date().toISOString(),
      };
      if (shouldShowInstallPrompt(facts)) {
        setEvent(e as BeforeInstallPromptEvent);
        setIsVisible(true);
        localStorage.setItem(SHOWN_KEY, '1');
      }
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, [props.isFlagOn, props.minVisits, props.dismissDays]);
  if (!isVisible || !event) return null;
  return (
    <div
      role="dialog"
      aria-labelledby="install-prompt-text"
      className="flex items-center justify-between gap-2 border-t px-4 py-3"
      data-testid="install-prompt"
    >
      <span id="install-prompt-text">{t('shell.install.text')}</span>
      <div className="flex gap-2">
        <Button
          size="sm"
          data-testid="install-prompt-accept"
          onClick={async () => {
            await event.prompt();
            setIsVisible(false);
          }}
        >
          {t('shell.install.action')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-testid="install-prompt-dismiss"
          onClick={() => {
            localStorage.setItem(DISMISSED_KEY, new Date().toISOString());
            setIsVisible(false);
          }}
        >
          {t('shell.install.dismiss')}
        </Button>
      </div>
    </div>
  );
}

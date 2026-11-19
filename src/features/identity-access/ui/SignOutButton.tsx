// UC6 sign-out: ends this device's session, then clears this user's caches before showing S11 (BR3.11).

import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';

export async function clearDeviceCaches(): Promise<void> {
  if (typeof caches !== 'undefined') {
    for (const key of await caches.keys()) await caches.delete(key);
  }
}

export function SignOutButton(props: { onSignedOut: () => void | Promise<void> }) {
  const { t } = useI18n();
  return (
    <Button
      variant="outline"
      data-testid="me-sign-out"
      onClick={async () => {
        await fetch('/api/auth/sign-out', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
          credentials: 'same-origin',
        });
        await clearDeviceCaches();
        await props.onSignedOut();
      }}
    >
      {t('auth.signOut')}
    </Button>
  );
}

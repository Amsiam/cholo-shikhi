import { createFileRoute, notFound } from '@tanstack/react-router';
import { getDevMailbox } from '#src/features/app-shell/server/shell.functions.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';

// Local development only: what the stub email adapter "sent". The server function refuses in production.
export const Route = createFileRoute('/dev/mailbox')({
  loader: async () => {
    const result = await getDevMailbox();
    if (!result.ok) throw notFound();
    return result.value;
  },
  component: DevMailbox,
});

function DevMailbox() {
  const { t, formatDateTime } = useI18n();
  const messages = Route.useLoaderData();
  return (
    <section className="grid gap-4" data-testid="dev-mailbox-page">
      <h1 className="text-2xl font-semibold">{t('dev.mailbox.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('dev.mailbox.intro')}</p>
      {messages.length === 0 ? (
        <p data-testid="dev-mailbox-empty">{t('dev.mailbox.empty')}</p>
      ) : null}
      <ul className="divide-y">
        {messages.map((m) => (
          <li
            key={m.id}
            className="py-3"
            data-testid="dev-mailbox-item"
            data-to={m.to}
            data-kind={m.kind}
          >
            <p className="font-medium">{m.subject}</p>
            <p className="text-sm">{m.to}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(m.sentAt)}</p>
            <a href={m.link} className="underline" data-testid="dev-mailbox-link">
              {t('dev.mailbox.open')}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

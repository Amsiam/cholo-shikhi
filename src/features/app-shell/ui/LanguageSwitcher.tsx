// LanguageSwitcher (BR6.1–BR6.3): one language at a time; the choice is saved and the page re-renders.

import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';

export function LanguageSwitcher(props: {
  onChange: (locale: 'bn' | 'en') => void | Promise<void>;
}) {
  const { t, locale } = useI18n();
  return (
    <fieldset className="flex items-center gap-1" data-testid="language-switcher">
      <legend className="sr-only">{t('shell.language.label')}</legend>
      {(['bn', 'en'] as const).map((option) => (
        <Button
          key={option}
          type="button"
          className="px-3"
          variant={option === locale ? 'default' : 'ghost'}
          aria-pressed={option === locale}
          lang={option}
          data-testid={`language-switcher-${option}`}
          onClick={() => props.onChange(option)}
        >
          {t(option === 'bn' ? 'shell.language.bn' : 'shell.language.en')}
        </Button>
      ))}
    </fieldset>
  );
}

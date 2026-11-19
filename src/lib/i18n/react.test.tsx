// [LT] I18nProvider re-renders labels and numbers in one language at a time (BR6.1).
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider, useI18n } from './react.tsx';

function Probe() {
  const { t, formatInteger, locale } = useI18n();
  return (
    <p data-testid="probe-text" lang={locale}>
      {t('app.name')} {formatInteger(25)}
    </p>
  );
}

describe('I18nProvider', () => {
  it('renders Bangla only in bn', () => {
    render(
      <I18nProvider locale="bn">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('probe-text').textContent).toBe('চলো শিখি ২৫');
  });
  it('renders English only in en', () => {
    render(
      <I18nProvider locale="en">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('probe-text').textContent).toBe('Cholo Shikhi 25');
    expect(screen.getByTestId('probe-text').getAttribute('lang')).toBe('en');
  });
});

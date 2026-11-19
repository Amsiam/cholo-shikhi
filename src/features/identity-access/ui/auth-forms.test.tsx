// [LT] + AC1.2.4 / AC1.1.3 at the UI layer: auth forms with React Testing Library.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import { ResetPasswordForm } from './ResetForms.tsx';
import { SignInForm } from './SignInForm.tsx';
import { SignUpForm } from './SignUpForm.tsx';

function ui(node: React.ReactNode, locale: 'bn' | 'en' = 'en') {
  return render(<I18nProvider locale={locale}>{node}</I18nProvider>);
}
function respond(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}
function setOnline(isOnline: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => isOnline });
}
afterEach(() => {
  vi.unstubAllGlobals();
  setOnline(true);
});

describe('SignInForm', () => {
  it('AC1.2.4 Given I am offline, When I submit, Then I see "You\'re offline", never the incorrect-password message', async () => {
    setOnline(false);
    const fetchSpy = respond(401, {});
    vi.stubGlobal('fetch', fetchSpy);
    ui(<SignInForm onSignedIn={vi.fn()} />);
    fireEvent.change(screen.getByTestId('sign-in-email'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByTestId('sign-in-password'), {
      target: { value: 'whatever-password' },
    });
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    expect((await screen.findByTestId('sign-in-form-error')).textContent).toMatch(/offline/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('AC1.2.2 shows the generic incorrect message from the server', async () => {
    vi.stubGlobal(
      'fetch',
      respond(401, {
        code: 'INVALID_EMAIL_OR_PASSWORD',
        i18nKey: 'errors.identity.INVALID_EMAIL_OR_PASSWORD',
      }),
    );
    ui(<SignInForm onSignedIn={vi.fn()} />);
    fireEvent.change(screen.getByTestId('sign-in-email'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByTestId('sign-in-password'), {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    expect((await screen.findByTestId('sign-in-form-error')).textContent).toBe(
      'Email or password is incorrect.',
    );
  });

  it('calls onSignedIn with the next route on success', async () => {
    vi.stubGlobal('fetch', respond(200, { status: 'signed_in', next: '/two-step' }));
    const onSignedIn = vi.fn();
    ui(<SignInForm onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByTestId('sign-in-email'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByTestId('sign-in-password'), {
      target: { value: 'right-password-1' },
    });
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith('/two-step'));
  });

  it('requires both fields before calling the server', async () => {
    const fetchSpy = respond(200, {});
    vi.stubGlobal('fetch', fetchSpy);
    ui(<SignInForm onSignedIn={vi.fn()} />);
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    expect(await screen.findByTestId('sign-in-email-error')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps an unknown server error to the generic message, never raw text', async () => {
    vi.stubGlobal('fetch', respond(500, { message: 'relation does not exist' }));
    ui(<SignInForm onSignedIn={vi.fn()} />);
    fireEvent.change(screen.getByTestId('sign-in-email'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByTestId('sign-in-password'), {
      target: { value: 'pw-123456789012' },
    });
    fireEvent.click(screen.getByTestId('sign-in-submit'));
    expect((await screen.findByTestId('sign-in-form-error')).textContent).toBe(
      'Something went wrong. Try again.',
    );
  });
});

describe('SignUpForm', () => {
  it('AC1.1.3 shows a field error for an 11-character password and does not call the server', async () => {
    const fetchSpy = respond(200, {});
    vi.stubGlobal('fetch', fetchSpy);
    ui(<SignUpForm />);
    fireEvent.change(screen.getByTestId('sign-up-email'), {
      target: { value: 'new@example.test' },
    });
    fireEvent.change(screen.getByTestId('sign-up-password'), { target: { value: 'Abcdefgh12!' } });
    fireEvent.click(screen.getByTestId('sign-up-submit'));
    expect((await screen.findByTestId('sign-up-password-error')).textContent).toBe(
      'Use 12 to 128 characters.',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('AC1.1.4 shows the neutral "check your email" message after a 200', async () => {
    vi.stubGlobal('fetch', respond(200, { status: 'check_email' }));
    ui(<SignUpForm />);
    fireEvent.change(screen.getByTestId('sign-up-email'), {
      target: { value: 'new@example.test' },
    });
    fireEvent.change(screen.getByTestId('sign-up-password'), { target: { value: 'Abcdefgh123!' } });
    fireEvent.click(screen.getByTestId('sign-up-submit'));
    expect((await screen.findByTestId('sign-up-check-email')).textContent).toMatch(
      /Check your email/,
    );
  });

  it('shows a live password length hint in Bangla digits', () => {
    ui(<SignUpForm />, 'bn');
    fireEvent.change(screen.getByTestId('sign-up-password'), { target: { value: 'abc' } });
    expect(screen.getByText('৩টি অক্ষর (কমপক্ষে ১২টি)')).toBeTruthy();
  });

  it('rejects an invalid email with a field error', async () => {
    vi.stubGlobal('fetch', respond(200, {}));
    ui(<SignUpForm />);
    fireEvent.change(screen.getByTestId('sign-up-email'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByTestId('sign-up-password'), { target: { value: 'Abcdefgh123!' } });
    fireEvent.click(screen.getByTestId('sign-up-submit'));
    expect(await screen.findByTestId('sign-up-email-error')).toBeTruthy();
  });
});

describe('ResetPasswordForm', () => {
  it('AC1.3.2 shows "link expired" for a used link', async () => {
    vi.stubGlobal(
      'fetch',
      respond(400, { code: 'LINK_EXPIRED', i18nKey: 'errors.identity.LINK_EXPIRED' }),
    );
    ui(<ResetPasswordForm token="used-token-0123456789" />);
    fireEvent.change(screen.getByTestId('reset-password-new'), {
      target: { value: 'Brand-new-password-1' },
    });
    fireEvent.click(screen.getByTestId('reset-password-submit'));
    expect((await screen.findByTestId('reset-password-error')).textContent).toMatch(/expired/);
  });
});

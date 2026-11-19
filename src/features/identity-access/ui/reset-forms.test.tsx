// [LT] reset request (AC1.3.3 neutral answer) and verification resend (AC1.17.3) forms.
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import { ResendVerificationForm, ResetPasswordForm, ResetRequestForm } from './ResetForms.tsx';
import { clearDeviceCaches, SignOutButton } from './SignOutButton.tsx';

const ui = (node: React.ReactNode) => render(<I18nProvider locale="en">{node}</I18nProvider>);
const respond = (status: number, body: unknown) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
afterEach(() => vi.unstubAllGlobals());

describe('ResetRequestForm', () => {
  it('AC1.3.3 shows the same confirmation whatever the server knows', async () => {
    vi.stubGlobal('fetch', respond(200, { status: 'check_email' }));
    ui(<ResetRequestForm />);
    fireEvent.change(screen.getByTestId('reset-request-email'), {
      target: { value: 'any@example.test' },
    });
    fireEvent.click(screen.getByTestId('reset-request-submit'));
    expect((await screen.findByTestId('reset-request-sent')).textContent).toMatch(
      /If an account exists/,
    );
  });
  it('validates the email before calling the server', async () => {
    const fetchSpy = respond(200, {});
    vi.stubGlobal('fetch', fetchSpy);
    ui(<ResetRequestForm />);
    fireEvent.click(screen.getByTestId('reset-request-submit'));
    expect(await screen.findByTestId('reset-request-email-error')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('shows "try again later" when rate-limited', async () => {
    vi.stubGlobal(
      'fetch',
      respond(429, { code: 'RATE_LIMITED', i18nKey: 'errors.common.RATE_LIMITED' }),
    );
    ui(<ResetRequestForm />);
    fireEvent.change(screen.getByTestId('reset-request-email'), {
      target: { value: 'any@example.test' },
    });
    fireEvent.click(screen.getByTestId('reset-request-submit'));
    expect(await screen.findByText('Too many attempts. Try again later.')).toBeTruthy();
  });
});

describe('ResetPasswordForm', () => {
  it('confirms a changed password', async () => {
    vi.stubGlobal('fetch', respond(200, { status: 'password_changed' }));
    ui(<ResetPasswordForm token="token-0123456789abcdef" />);
    fireEvent.change(screen.getByTestId('reset-password-new'), {
      target: { value: 'Brand-new-password-1' },
    });
    fireEvent.click(screen.getByTestId('reset-password-submit'));
    expect(await screen.findByTestId('reset-password-done')).toBeTruthy();
  });
  it('refuses a short new password locally', async () => {
    const fetchSpy = respond(200, {});
    vi.stubGlobal('fetch', fetchSpy);
    ui(<ResetPasswordForm token="token-0123456789abcdef" />);
    fireEvent.change(screen.getByTestId('reset-password-new'), { target: { value: 'short' } });
    fireEvent.click(screen.getByTestId('reset-password-submit'));
    expect((await screen.findByTestId('reset-password-new-error')).textContent).toBe(
      'Use 12 to 128 characters.',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('ResendVerificationForm', () => {
  it('AC1.17.3 sends a new link and answers neutrally', async () => {
    const fetchSpy = respond(200, { status: 'check_email' });
    vi.stubGlobal('fetch', fetchSpy);
    ui(<ResendVerificationForm />);
    fireEvent.change(screen.getByTestId('verify-resend-email'), {
      target: { value: 'any@example.test' },
    });
    fireEvent.click(screen.getByTestId('verify-resend-submit'));
    expect(await screen.findByTestId('verify-resent')).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/identity/resend-verification',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('SignOutButton (BR3.11)', () => {
  it('ends the session, clears cached pages, then hands over to sign-in', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      keys: async () => ['cs-static-v1', 'pages'],
      delete: async (k: string) => deleted.push(k),
    });
    const fetchSpy = respond(200, { status: 'signed_out' });
    vi.stubGlobal('fetch', fetchSpy);
    const onSignedOut = vi.fn();
    ui(<SignOutButton onSignedOut={onSignedOut} />);
    fireEvent.click(screen.getByTestId('me-sign-out'));
    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/sign-out',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(deleted).toEqual(['cs-static-v1', 'pages']);
  });
  it('does nothing harmful where the Cache API is missing', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(clearDeviceCaches()).resolves.toBeUndefined();
  });
});

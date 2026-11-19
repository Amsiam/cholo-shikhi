// [LT] X1 two-step screen: grouped manual key (AC1.7.3), recovery codes shown once, recovery mode.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import { type TwoStepActions, TwoStepPanel } from './TwoStepPanel.tsx';

const actions = (): TwoStepActions => ({
  startEnrolment: vi.fn(async () => ({
    ok: true as const,
    value: { setupKeyGroups: ['ABCD', 'EFGH', 'IJ'], otpauthUri: 'otpauth://x' },
  })),
  confirmEnrolment: vi.fn(async () => ({
    ok: true as const,
    value: { recoveryCodes: ['AAAA-BBBB-CCCC', 'DDDD-EEEE-FFFF'] },
  })),
  verifyCode: vi.fn(async () => ({
    ok: false as const,
    error: { i18nKey: 'errors.identity.INVALID_CODE' },
  })),
  redeemRecoveryCode: vi.fn(async () => ({ ok: true as const, value: undefined })),
});
const ui = (node: React.ReactNode) => render(<I18nProvider locale="en">{node}</I18nProvider>);

describe('TwoStepPanel', () => {
  it('AC1.7.3 shows the setup key in groups of 4, then the recovery codes once confirmed', async () => {
    const a = actions();
    const onDone = vi.fn();
    ui(<TwoStepPanel state="pending_enrolment" actions={a} onDone={onDone} />);
    fireEvent.click(screen.getByTestId('two-step-start'));
    expect((await screen.findByTestId('two-step-setup-key')).textContent).toBe('ABCD EFGH IJ');
    fireEvent.change(screen.getByTestId('two-step-code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('two-step-confirm'));
    expect((await screen.findByTestId('two-step-recovery-codes')).textContent).toContain(
      'AAAA-BBBB-CCCC',
    );
    fireEvent.click(screen.getByTestId('two-step-recovery-saved'));
    expect(onDone).toHaveBeenCalled();
  });

  it('shows an invalid-code error on the challenge and switches to recovery-code mode', async () => {
    const a = actions();
    const onDone = vi.fn();
    ui(<TwoStepPanel state="pending_challenge" actions={a} onDone={onDone} />);
    fireEvent.change(screen.getByTestId('two-step-challenge-code'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByTestId('two-step-verify'));
    expect((await screen.findByTestId('two-step-challenge-code-error')).textContent).toBe(
      'That code is not valid.',
    );
    fireEvent.click(screen.getByTestId('two-step-recovery-toggle'));
    fireEvent.change(screen.getByTestId('two-step-challenge-code'), {
      target: { value: 'AAAA-BBBB-CCCC' },
    });
    fireEvent.click(screen.getByTestId('two-step-verify'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(a.redeemRecoveryCode).toHaveBeenCalledWith({ data: { code: 'AAAA-BBBB-CCCC' } });
  });

  it('tells a session with nothing pending to sign in first', () => {
    ui(<TwoStepPanel state="none" actions={actions()} onDone={vi.fn()} />);
    expect(screen.getByTestId('two-step-not-pending')).toBeTruthy();
  });
});

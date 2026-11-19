// The switch for the payout rules whose golden examples are still a draft (attribution money,
// payroll salary lines, hybrid lines). The flag is off by default; with it on, nothing those rules
// produce may reach a committed cycle until the human approves the draft golden set
// (../domain/golden/drafts/drafts.ts explains how).
import { flags } from '#src/features/platform/index.ts';
import { isDraftGoldenApproved } from '../domain/golden/drafts/drafts.ts';
import { PAYOUT_FLAGS } from '../domain/payout-settings.ts';

let draftGate: () => boolean = isDraftGoldenApproved;
/** Tests stand in for the human's approval of the draft golden set. */
export function setDraftGoldenGateForTests(gate: () => boolean) {
  draftGate = gate;
}

export type NewRulesState = {
  /** The payouts.payrollAndAttribution flag. */
  isOn: boolean;
  /** The human approved the draft golden set. */
  isApproved: boolean;
};

export async function newRulesState(): Promise<NewRulesState> {
  return {
    isOn: await flags().isEnabled(PAYOUT_FLAGS.payrollAndAttribution),
    isApproved: draftGate(),
  };
}

/** The new rules may move money only when the flag is on and the drafts are approved. */
export const mayApplyNewRules = (s: NewRulesState) => s.isOn && s.isApproved;

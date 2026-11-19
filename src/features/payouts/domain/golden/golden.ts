// The golden payout examples (US7.23; team.md "Money correctness"). The cases file is AI-drafted;
// its expected values belong to the human. The manifest records the cases file's SHA-256 and the
// human's approval. CI fails when the file changes without a matching manifest, and payouts can
// only be recorded as paid once the human has approved the current file.
import { createHash } from 'node:crypto';
import { assembleCycle } from '../cycle.ts';
import cases from './golden-cases.json' with { type: 'json' };
import manifest from './golden-manifest.json' with { type: 'json' };

export type GoldenCase = (typeof cases.cases)[number];

/** The SHA-256 of the cases exactly as committed (canonical JSON, so formatting cannot hide a change). */
export function goldenCasesHash(): string {
  return createHash('sha256').update(JSON.stringify(cases)).digest('hex');
}

export function goldenManifest() {
  return manifest;
}

type Manifest = {
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  sha256: string;
};

/** A manifest approves a cases file only if a person approved it, when, and for this exact hash. */
export function manifestApproves(m: Manifest, casesHash: string): boolean {
  return m.status === 'approved' && !!m.approvedBy && !!m.approvedAt && m.sha256 === casesHash;
}

/** True only when the human approved this exact set of cases. */
export function isGoldenApproved(): boolean {
  return manifestApproves(manifest as Manifest, goldenCasesHash());
}

export function goldenCases(): GoldenCase[] {
  return cases.cases;
}

/** Runs one case's cycles in order, carrying each instructor's carryOut into the next cycle. */
export function runGoldenCase(c: GoldenCase) {
  const carry = new Map<string, number>();
  return c.cycles.map((cycle) => {
    const result = assembleCycle({
      month: cycle.month,
      instructors: cycle.instructors.map((x) => ({
        instructorId: x.instructorId,
        earned: x.earned,
        carryIn: carry.get(x.instructorId) ?? 0,
        isVerified: x.isVerified,
      })),
    });
    for (const x of cycle.instructors) carry.set(x.instructorId, 0);
    for (const line of result.lines) carry.set(line.instructorId, line.carryOut);
    return {
      month: cycle.month,
      actual: Object.fromEntries(
        result.lines.map((l) => [
          l.instructorId,
          { payout: l.payout, carryOut: l.carryOut, state: l.state },
        ]),
      ),
      expected: cycle.expected,
    };
  });
}

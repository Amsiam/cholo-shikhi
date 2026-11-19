// Golden sale-split examples: worked cases with their exact expected amounts (team.md "Money
// correctness"). THE HUMAN OWNS THIS FILE. No AI agent may change a case or an expected value
// without the human's explicit approval (project.md Forbidden).
//
// STATUS: PROPOSED 2026-11-18. Awaiting the human's approval.
//
// Amounts are poisha (100 poisha = ৳1). Instructor IDs are short labels; the rule orders by ID.
export type GoldenSaleSplit = {
  name: string;
  amount: number;
  shareBps: number;
  sections: Array<{ sectionId: string; instructorId: string }>;
  expect: { platform: number; instructors: Record<string, number>; unassigned: number };
};

const owned = (...owners: string[]) =>
  owners.map((instructorId, i) => ({ sectionId: `s${i + 1}`, instructorId }));

export const GOLDEN_SALE_SPLITS: readonly GoldenSaleSplit[] = [
  {
    name: '৳1,800 course, one instructor owns all 3 sections',
    amount: 180_000,
    shareBps: 7000,
    sections: owned('A', 'A', 'A'),
    expect: { platform: 54_000, instructors: { A: 126_000 }, unassigned: 0 },
  },
  {
    name: 'PRD example: 4 sections, Lead owns 1, Co-instructor owns 3',
    amount: 200_000,
    shareBps: 7000,
    sections: owned('lead', 'co', 'co', 'co'),
    expect: { platform: 60_000, instructors: { lead: 35_000, co: 105_000 }, unassigned: 0 },
  },
  {
    name: '৳1,000 split three ways: the pool does not divide evenly',
    amount: 100_000,
    shareBps: 7000,
    sections: owned('A', 'B', 'C'),
    // Pool 70 000 / 3 = 23 333 r1: the one leftover poisha goes to the lowest ID (all remainders equal).
    expect: { platform: 30_000, instructors: { A: 23_334, B: 23_333, C: 23_333 }, unassigned: 0 },
  },
  {
    name: 'Odd amount: the percentage fraction goes to the platform',
    amount: 99_999,
    shareBps: 7000,
    sections: owned('A'),
    // 99 999 × 0.7 = 69 999.3 → pool 69 999, platform 30 000.
    expect: { platform: 30_000, instructors: { A: 69_999 }, unassigned: 0 },
  },
  {
    name: 'Largest remainder wins the leftover poisha',
    amount: 1_001,
    shareBps: 7000,
    sections: owned('A', 'B', 'B'),
    // Pool 700. A: 700/3 = 233 r1. B: 1400/3 = 466 r2. Leftover 1 → B (larger remainder).
    expect: { platform: 301, instructors: { A: 233, B: 467 }, unassigned: 0 },
  },
  {
    name: 'No section has an owner: the pool is held as unassigned',
    amount: 150_000,
    shareBps: 7000,
    sections: [],
    expect: { platform: 45_000, instructors: {}, unassigned: 105_000 },
  },
  {
    name: 'Smallest sale: 1 poisha',
    amount: 1,
    shareBps: 7000,
    sections: owned('A'),
    expect: { platform: 1, instructors: { A: 0 }, unassigned: 0 },
  },
];

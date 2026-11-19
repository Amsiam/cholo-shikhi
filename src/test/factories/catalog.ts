// Synthetic Goals and Catalog data (team.md Test data; unit-test-instructions "Synthetic data").
// Every name and title is invented, in bn_BD (Bangla script) and en pairs. Fixed seeds keep runs
// reproducible. Prices are integer poisha only; price inputs are taka strings in Latin or Bangla
// digits. These builders return plain input values: the feature code under test writes them.
import { randomUUID } from 'node:crypto';
import { toBanglaDigits } from '#src/lib/money.ts';
import { createRng } from './synthetic.ts';

export type Bilingual = { nameBn: string; nameEn: string };

const SEGMENT_NAMES: ReadonlyArray<readonly [string, string, 'academic' | 'job_aspirant', string]> =
  [
    ['ষষ্ঠ-অষ্টম শ্রেণি', 'Class 6-8', 'academic', 'class_6_8'],
    ['এসএসসি', 'SSC', 'academic', 'ssc'],
    ['এইচএসসি', 'HSC', 'academic', 'hsc'],
    ['বিসিএস', 'BCS', 'job_aspirant', 'bcs'],
    ['ব্যাংক', 'Bank', 'job_aspirant', 'bank'],
  ];

const GOAL_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['বিসিএস প্রিলিমিনারি', 'BCS Preliminary'],
  ['বিসিএস লিখিত', 'BCS Written'],
  ['ব্যাংক এসও', 'Bank SO'],
  ['এইচএসসি বিজ্ঞান', 'HSC Science'],
  ['এসএসসি মানবিক', 'SSC Humanities'],
  ['অষ্টম শ্রেণি গণিত', 'Class 8 Maths'],
];

const TITLE_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['গণিত', 'Maths'],
  ['বাংলা', 'Bangla'],
  ['ইংরেজি', 'English'],
  ['সাধারণ জ্ঞান', 'General Knowledge'],
  ['বিজ্ঞান', 'Science'],
  ['মানসিক দক্ষতা', 'Mental Ability'],
];

let sequence = 0;

function next(seed: number | undefined) {
  sequence += 1;
  return { rng: createRng(seed ?? 1000 + sequence), n: sequence };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pick() called with an empty list');
  return item;
}

/** A unique suffix so case-insensitive name uniqueness never collides between factory calls. */
function suffix(n: number): { bn: string; en: string } {
  return { bn: toBanglaDigits(String(n)), en: String(n) };
}

export type SegmentInput = Bilingual & {
  segmentType: 'academic' | 'job_aspirant';
  battleBand: string;
  sortOrder: number;
};

export function buildSegmentInput(
  overrides: Partial<SegmentInput> = {},
  seed?: number,
): SegmentInput {
  const { rng, n } = next(seed);
  const [bnName, enName, segmentType, band] = pick(rng, SEGMENT_NAMES);
  const s = suffix(n);
  return {
    nameBn: `${bnName} ${s.bn}`,
    nameEn: `${enName} ${s.en}`,
    segmentType,
    battleBand: `${band}_${n}`,
    sortOrder: n % 10,
    ...overrides,
  };
}

export type GoalInput = Bilingual & {
  segmentId: string;
  status: 'inactive' | 'active';
  sortOrder: number;
};

export function buildGoalInput(
  segmentId: string,
  overrides: Partial<GoalInput> = {},
  seed?: number,
): GoalInput {
  const { rng, n } = next(seed);
  const [bnName, enName] = pick(rng, GOAL_NAMES);
  const s = suffix(n);
  return {
    segmentId,
    nameBn: `${bnName} ${s.bn}`,
    nameEn: `${enName} ${s.en}`,
    status: 'active',
    sortOrder: n % 10,
    ...overrides,
  };
}

export type SelectionInput = { userId: string; goalId: string; segmentId: string };

export function buildSelectionInput(goalId: string, segmentId: string): SelectionInput {
  return { userId: randomUUID(), goalId, segmentId };
}

/** "Bilingual-one" title: sometimes one language is left empty to exercise the `lang` fallback. */
export function buildTitle(
  seed?: number,
  options: { allowOneEmpty?: boolean } = {},
): { titleBn: string; titleEn: string } {
  const { rng, n } = next(seed);
  const [bn, en] = pick(rng, TITLE_WORDS);
  const s = suffix(n);
  const title = { titleBn: `${bn} ${s.bn}`, titleEn: `${en} ${s.en}` };
  if (!options.allowOneEmpty) return title;
  const roll = rng();
  if (roll < 0.25) return { ...title, titleBn: '' };
  if (roll < 0.5) return { ...title, titleEn: '' };
  return title;
}

/** An integer-poisha price between min and max inclusive (whole taka steps keep it readable). */
export function buildPricePoisha(seed?: number, minTaka = 100, maxTaka = 20_000): number {
  const { rng } = next(seed);
  const taka = minTaka + Math.floor(rng() * (maxTaka - minTaka + 1));
  return taka * 100;
}

/** A taka string as an Admin or Lead would type it, in Latin or Bangla digits. */
export function buildTakaInput(poisha: number, digits: 'latin' | 'bangla' = 'latin'): string {
  if (!Number.isSafeInteger(poisha) || poisha < 0) throw new RangeError('poisha must be >= 0');
  const whole = Math.trunc(poisha / 100);
  const fraction = String(poisha % 100).padStart(2, '0');
  const text = fraction === '00' ? String(whole) : `${whole}.${fraction}`;
  return digits === 'bangla' ? toBanglaDigits(text) : text;
}

export type CourseInput = {
  goalId: string;
  titleBn: string;
  titleEn: string;
  pricePoisha: number;
  accessDurationMonths: 4 | 6 | 12;
};

export function buildCourseInput(goalId: string, seed?: number): CourseInput {
  const { rng } = next(seed);
  return {
    goalId,
    ...buildTitle(seed),
    pricePoisha: buildPricePoisha(seed),
    accessDurationMonths: pick(rng, [4, 6, 12] as const),
  };
}

export type SectionInput = { courseId: string; titleBn: string; titleEn: string; position: number };

export function buildSectionInput(courseId: string, position: number, seed?: number): SectionInput {
  return { courseId, ...buildTitle(seed), position };
}

export type OwnershipPeriodInput = {
  sectionId: string;
  instructorId: string;
  validFrom: string;
  validTo: string | null;
};

export function buildOwnershipPeriod(
  sectionId: string,
  instructorId: string,
  validFrom: string,
  validTo: string | null = null,
): OwnershipPeriodInput {
  return { sectionId, instructorId, validFrom, validTo };
}

export type LessonInput = {
  sectionId: string;
  kind: 'video' | 'text' | 'quiz';
  titleBn: string;
  titleEn: string;
  position: number;
};

export function buildLessonInput(sectionId: string, position: number, seed?: number): LessonInput {
  const { rng } = next(seed);
  return {
    sectionId,
    kind: pick(rng, ['video', 'text', 'quiz'] as const),
    ...buildTitle(seed, { allowOneEmpty: true }),
    position,
  };
}

export type ExamPackageInput = {
  goalId: string;
  titleBn: string;
  titleEn: string;
  pricePoisha: number;
  questionCount: number;
  timeLimitMinutes: number;
};

export function buildExamPackageInput(goalId: string, seed?: number): ExamPackageInput {
  const { rng } = next(seed);
  return {
    goalId,
    ...buildTitle(seed),
    pricePoisha: buildPricePoisha(seed, 50, 2_000),
    questionCount: 10 + Math.floor(rng() * 190),
    timeLimitMinutes: 10 + Math.floor(rng() * 170),
  };
}

export type PlanInput = {
  goalId: string;
  nameBn: string;
  nameEn: string;
  monthlyPricePoisha: number;
};

export function buildPlanInput(goalId: string, seed?: number): PlanInput {
  const title = buildTitle(seed);
  return {
    goalId,
    nameBn: title.titleBn,
    nameEn: title.titleEn,
    monthlyPricePoisha: buildPricePoisha(seed, 100, 3_000),
  };
}

export type PracticePackInput = {
  courseId: string;
  titleBn: string;
  titleEn: string;
  pricePoisha: number;
  questionSetCount: number;
};

export function buildPracticePackInput(courseId: string, seed?: number): PracticePackInput {
  const { rng } = next(seed);
  return {
    courseId,
    ...buildTitle(seed),
    pricePoisha: buildPricePoisha(seed, 50, 1_500),
    questionSetCount: 1 + Math.floor(rng() * 50),
  };
}

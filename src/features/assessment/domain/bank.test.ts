// [LT] Question bank rules: validation and the review cycle.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  blendedCorrectRate,
  canEdit,
  effectiveDifficulty,
  initialStatus,
  nextStatus,
  validateBankQuestion,
} from './bank.ts';

const good = {
  promptBn: ' প্রশ্ন ',
  promptEn: 'Question?',
  optionsBn: ['ক', 'খ', 'গ', 'ঘ'],
  optionsEn: ['A', 'B', 'C', 'D'],
  correctIndex: 2,
  explanationBn: ' ',
  explanationEn: 'Because.',
  sourceNote: 'BCS 41',
};
const admin = { isAdmin: true, userId: 'a' };
const author = { isAdmin: false, userId: 'u' };
const other = { isAdmin: false, userId: 'x' };

describe('validateBankQuestion', () => {
  it('trims and turns blank optional text into none', () => {
    const r = validateBankQuestion(good);
    expect(r.ok && r.value).toMatchObject({
      promptBn: 'প্রশ্ন',
      explanationBn: null,
      sourceNote: 'BCS 41',
    });
  });
  it('names each problem', () => {
    const r = validateBankQuestion({
      ...good,
      promptEn: '',
      optionsBn: ['ক', 'ক', 'গ', ''],
      correctIndex: 5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.error.fieldErrors ?? {}).sort()).toEqual(
        ['correctIndex', 'optionsBn', 'optionsBn.3', 'promptEn'].sort(),
      );
  });
});

describe('review cycle', () => {
  it('Admins publish directly; Instructors start a draft', () => {
    expect(initialStatus(admin)).toBe('published');
    expect(initialStatus(author)).toBe('draft');
  });
  it('the author submits; only an Admin approves, rejects, retires or restores', () => {
    expect(nextStatus('draft', 'submit', 'u', author)).toBe('in_review');
    expect(nextStatus('draft', 'submit', 'u', other)).toBeNull();
    expect(nextStatus('in_review', 'approve', 'u', author)).toBeNull();
    expect(nextStatus('in_review', 'approve', 'u', admin)).toBe('published');
    expect(nextStatus('in_review', 'reject', 'u', admin)).toBe('rejected');
    expect(nextStatus('rejected', 'submit', 'u', author)).toBe('in_review');
    expect(nextStatus('published', 'retire', 'u', admin)).toBe('retired');
    expect(nextStatus('retired', 'restore', 'u', admin)).toBe('published');
    expect(nextStatus('published', 'approve', 'u', admin)).toBeNull();
  });
  it('authors edit only drafts and rejected questions; Admins edit anything not retired', () => {
    expect(canEdit('draft', 'u', author)).toBe(true);
    expect(canEdit('in_review', 'u', author)).toBe(false);
    expect(canEdit('published', 'u', author)).toBe(false);
    expect(canEdit('draft', 'u', other)).toBe(false);
    expect(canEdit('published', 'u', admin)).toBe(true);
    expect(canEdit('retired', 'u', admin)).toBe(false);
  });
});

describe('adaptive difficulty', () => {
  it('starts at the teacher difficulty', () => {
    for (const d of ['easy', 'medium', 'hard'] as const)
      expect(effectiveDifficulty(d, 0, 0)).toBe(d);
  });
  it('a few answers do not move it', () => {
    expect(effectiveDifficulty('medium', 3, 0)).toBe('medium');
    expect(effectiveDifficulty('medium', 3, 3)).toBe('medium');
  });
  it('real results win with enough first attempts', () => {
    expect(effectiveDifficulty('easy', 100, 30)).toBe('hard');
    expect(effectiveDifficulty('hard', 100, 90)).toBe('easy');
    expect(effectiveDifficulty('medium', 80, 48)).toBe('medium');
  });
  it('stays within 0..1', () => {
    fc.assert(
      fc.property(
        fc.nat(10_000),
        fc.nat(10_000),
        fc.constantFrom('easy', 'medium', 'hard' as const),
        (a, c, d) => {
          const r = blendedCorrectRate(d, a, Math.min(a, c));
          return r >= 0 && r <= 1;
        },
      ),
    );
  });
});

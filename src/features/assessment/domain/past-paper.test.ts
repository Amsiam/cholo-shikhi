// [LT] US4.7: checking past-paper rows (rights, taxonomy, question rules) and their fingerprints.
import { describe, expect, it } from 'vitest';
import {
  fingerprintOf,
  missingColumns,
  PAST_PAPER_COLUMNS,
  parsePastPaperRow,
  topicLookupKey,
} from './past-paper.ts';

const topics = new Map([[topicLookupKey('Bangladesh Affairs', 'Liberation War'), 'topic-1']]);
const row = (over: Record<string, string> = {}) => ({
  subject_en: 'Bangladesh affairs',
  topic_en: ' Liberation war ',
  difficulty: 'easy',
  prompt_bn: 'মুক্তিযুদ্ধ কত সালে?',
  prompt_en: 'When was the Liberation War?',
  option1_bn: '১৯৭১',
  option2_bn: '১৯৫২',
  option3_bn: '১৯৬৯',
  option4_bn: '১৯৯০',
  option1_en: '1971',
  option2_en: '1952',
  option3_en: '1969',
  option4_en: '1990',
  correct: '1',
  explanation_bn: '',
  explanation_en: '',
  source: 'BCS 44 preliminary (2022)',
  rights: 'public_domain',
  ...over,
});

describe('parsePastPaperRow', () => {
  it('accepts a complete row, matching the taxonomy case-insensitively', () => {
    const r = parsePastPaperRow(row(), topics);
    expect(r.ok && r.value).toMatchObject({
      topicId: 'topic-1',
      difficulty: 'easy',
      rightsStatus: 'public_domain',
      question: { correctIndex: 0, sourceNote: 'BCS 44 preliminary (2022)' },
    });
  });
  it('rejects a row with no rights status or an unknown topic, listing every reason', () => {
    expect(parsePastPaperRow(row({ rights: '', topic_en: 'Nope' }), topics)).toEqual({
      ok: false,
      reasons: ['rightsMissing', 'taxonomy'],
    });
    expect(parsePastPaperRow(row({ rights: 'copyrighted' }), topics)).toMatchObject({
      reasons: ['rightsInvalid'],
    });
  });
  it('rejects bad questions: missing source, wrong answer number, duplicate options', () => {
    expect(
      parsePastPaperRow(row({ source: '', correct: '5', option2_en: '1971' }), topics),
    ).toEqual({ ok: false, reasons: ['sourceMissing', 'options', 'correct'] });
  });
  it('fingerprints ignore case, spacing and Unicode form', () => {
    const a = { promptBn: 'ক', promptEn: 'When  was it?', optionsBn: ['১'], optionsEn: ['A'] };
    const b = { promptBn: ' ক ', promptEn: 'when was IT?', optionsBn: ['১'], optionsEn: ['a'] };
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
    expect(fingerprintOf(a)).not.toBe(fingerprintOf({ ...b, optionsEn: ['b'] }));
  });
  it('names the columns a header lacks', () => {
    expect(missingColumns([...PAST_PAPER_COLUMNS])).toEqual([]);
    expect(missingColumns(['prompt_en'])).toContain('rights');
  });
});

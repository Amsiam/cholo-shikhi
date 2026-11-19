// [LT] lesson media: YouTube link parsing and MCQ validation.
import { describe, expect, it } from 'vitest';
import {
  parseYoutubeVideoId,
  type QuizQuestionDraft,
  validateQuizQuestions,
} from './lesson-media.ts';

describe('parseYoutubeVideoId', () => {
  it.each([
    ['RGqj9z65P3Y', 'RGqj9z65P3Y'],
    ['  RGqj9z65P3Y  ', 'RGqj9z65P3Y'],
    ['https://www.youtube.com/watch?v=RGqj9z65P3Y', 'RGqj9z65P3Y'],
    ['https://www.youtube.com/watch?v=RGqj9z65P3Y&t=42s&list=PLx', 'RGqj9z65P3Y'],
    ['youtube.com/watch?v=RGqj9z65P3Y', 'RGqj9z65P3Y'],
    ['https://m.youtube.com/watch?v=RGqj9z65P3Y', 'RGqj9z65P3Y'],
    ['https://youtu.be/RGqj9z65P3Y', 'RGqj9z65P3Y'],
    ['https://youtu.be/RGqj9z65P3Y?si=abc', 'RGqj9z65P3Y'],
    ['https://www.youtube.com/embed/RGqj9z65P3Y', 'RGqj9z65P3Y'],
    ['https://www.youtube-nocookie.com/embed/RGqj9z65P3Y?rel=0', 'RGqj9z65P3Y'],
    ['https://www.youtube.com/shorts/RGqj9z65P3Y', 'RGqj9z65P3Y'],
    ['https://www.youtube.com/live/RGqj9z65P3Y', 'RGqj9z65P3Y'],
  ])('reads %s', (input, id) => {
    expect(parseYoutubeVideoId(input)).toBe(id);
  });

  it.each([
    [''],
    ['not a video'],
    ['RGqj9z65P3'],
    ['https://example.com/watch?v=RGqj9z65P3Y'],
    ['https://youtube.com.evil.example/watch?v=RGqj9z65P3Y'],
    ['https://www.youtube.com/playlist?list=PLSQl0a2vh4HCiFE95STYVxTZ6Ep402vfa'],
    ['https://www.youtube.com/watch?v=bad<id>'],
    ['javascript:alert(1)'],
  ])('refuses %s', (input) => {
    expect(parseYoutubeVideoId(input)).toBeNull();
  });
});

const good = (over: Partial<QuizQuestionDraft> = {}): QuizQuestionDraft => ({
  promptBn: ' প্রশ্ন ',
  promptEn: ' What is 2 + 2? ',
  optionsBn: ['৩', '৪', '৫', '৬'],
  optionsEn: ['3', '4', '5', '6'],
  correctIndex: 1,
  explanationBn: '  ',
  explanationEn: 'Four.',
  ...over,
});

describe('validateQuizQuestions', () => {
  it('trims text and turns a blank explanation into none', () => {
    const result = validateQuizQuestions([good()]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]).toMatchObject({
        promptEn: 'What is 2 + 2?',
        explanationBn: null,
        explanationEn: 'Four.',
      });
    }
  });

  it('needs at least one and at most 50 questions', () => {
    expect(validateQuizQuestions([])).toMatchObject({
      ok: false,
      error: { fieldErrors: { questions: ['errors.catalog.quiz.none'] } },
    });
    expect(validateQuizQuestions(Array.from({ length: 51 }, () => good()))).toMatchObject({
      ok: false,
      error: { fieldErrors: { questions: ['errors.catalog.quiz.tooMany'] } },
    });
  });

  it('names the exact field of each problem', () => {
    const result = validateQuizQuestions([
      good(),
      good({
        promptEn: '  ',
        optionsBn: ['ক', '', 'গ', 'ঘ'],
        optionsEn: ['a', 'A', 'c', 'd'],
        correctIndex: 4,
      }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.fieldErrors).toMatchObject({
        'questions.1.promptEn': ['errors.catalog.quiz.promptRequired'],
        'questions.1.optionsBn.1': ['errors.catalog.quiz.optionRequired'],
        'questions.1.optionsEn': ['errors.catalog.quiz.optionsDistinct'],
        'questions.1.correctIndex': ['errors.catalog.quiz.correctRequired'],
      });
      expect(
        Object.keys(result.error.fieldErrors ?? {}).some((k) => k.startsWith('questions.0')),
      ).toBe(false);
    }
  });

  it('refuses a question without exactly four options', () => {
    const result = validateQuizQuestions([good({ optionsEn: ['1', '2', '3'] })]);
    expect(result).toMatchObject({
      ok: false,
      error: { fieldErrors: { 'questions.0.optionsEn': ['errors.catalog.quiz.fourOptions'] } },
    });
  });
});

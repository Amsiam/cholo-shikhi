// Video and quiz content for lessons: YouTube link parsing and MCQ validation. Plain TypeScript:
// no framework, DB or env access.
import type { AppError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { validationFailed } from './course.ts';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
]);

/**
 * The YouTube video ID in what an instructor pasted: a bare 11-character ID, or a youtube.com
 * watch / embed / shorts / live link, a youtu.be link, or a youtube-nocookie embed link. Anything
 * else (another site, a playlist without a video, a malformed ID) answers null.
 */
export function parseYoutubeVideoId(input: string): string | null {
  const text = input.trim();
  if (VIDEO_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const candidate =
    url.hostname.toLowerCase() === 'youtu.be'
      ? url.pathname.split('/')[1]
      : url.pathname === '/watch'
        ? url.searchParams.get('v')
        : (/^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname)?.[1] ?? null);
  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

export const QUIZ_MAX_QUESTIONS = 50;
export const QUIZ_PROMPT_MAX = 1000;
export const QUIZ_OPTION_MAX = 300;
export const QUIZ_EXPLANATION_MAX = 1000;

export type QuizQuestionDraft = {
  promptBn: string;
  promptEn: string;
  optionsBn: readonly string[];
  optionsEn: readonly string[];
  correctIndex: number;
  explanationBn: string | null;
  explanationEn: string | null;
};

export type CleanQuizQuestion = {
  promptBn: string;
  promptEn: string;
  optionsBn: string[];
  optionsEn: string[];
  correctIndex: number;
  explanationBn: string | null;
  explanationEn: string | null;
};

const clean = (s: string) => s.trim();
const optional = (s: string | null) => {
  const t = s?.trim() ?? '';
  return t.length > 0 ? t : null;
};

/**
 * A quiz needs 1–50 questions; each has a prompt and four non-empty, distinct options in both
 * languages, exactly one correct option, and an optional explanation per language. Refusals name
 * the field (`questions.<i>.<field>`) so the form can show them in place.
 */
export function validateQuizQuestions(
  questions: readonly QuizQuestionDraft[],
): Result<CleanQuizQuestion[], AppError<'VALIDATION_FAILED'>> {
  const fieldErrors: Record<string, string[]> = {};
  const add = (key: string, code: string) => {
    fieldErrors[key] = [...(fieldErrors[key] ?? []), `errors.catalog.quiz.${code}`];
  };
  if (questions.length === 0) add('questions', 'none');
  if (questions.length > QUIZ_MAX_QUESTIONS) add('questions', 'tooMany');
  const out = questions.map((q, i) => {
    const at = `questions.${i}`;
    for (const lang of ['Bn', 'En'] as const) {
      const prompt = clean(q[`prompt${lang}`]);
      if (prompt.length === 0) add(`${at}.prompt${lang}`, 'promptRequired');
      if (prompt.length > QUIZ_PROMPT_MAX) add(`${at}.prompt${lang}`, 'tooLong');
      const options = q[`options${lang}`].map(clean);
      if (options.length !== 4) add(`${at}.options${lang}`, 'fourOptions');
      options.forEach((o, j) => {
        if (o.length === 0) add(`${at}.options${lang}.${j}`, 'optionRequired');
        if (o.length > QUIZ_OPTION_MAX) add(`${at}.options${lang}.${j}`, 'tooLong');
      });
      if (new Set(options.map((o) => o.toLowerCase())).size !== options.length)
        add(`${at}.options${lang}`, 'optionsDistinct');
      const explanation = optional(q[`explanation${lang}`]);
      if (explanation && explanation.length > QUIZ_EXPLANATION_MAX)
        add(`${at}.explanation${lang}`, 'tooLong');
    }
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3)
      add(`${at}.correctIndex`, 'correctRequired');
    return {
      promptBn: clean(q.promptBn),
      promptEn: clean(q.promptEn),
      optionsBn: q.optionsBn.map(clean),
      optionsEn: q.optionsEn.map(clean),
      correctIndex: q.correctIndex,
      explanationBn: optional(q.explanationBn),
      explanationEn: optional(q.explanationEn),
    };
  });
  return Object.keys(fieldErrors).length > 0 ? err(validationFailed(fieldErrors)) : ok(out);
}

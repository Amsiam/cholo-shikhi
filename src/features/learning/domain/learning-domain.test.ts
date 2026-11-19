// [LT] learning domain: course progress, lesson navigation and MCQ grading.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { courseProgress, lessonNeighbours } from './progress.ts';
import { gradeQuiz } from './quiz.ts';

describe('courseProgress', () => {
  const lessons = ['a', 'b', 'c', 'd'];
  it('counts completed lessons and points at the first unfinished one', () => {
    expect(courseProgress(lessons, new Set(['a', 'c']))).toEqual({
      completed: 2,
      total: 4,
      percent: 50,
      nextLessonId: 'b',
    });
  });
  it('is 100 with no next lesson when all are done', () => {
    expect(courseProgress(lessons, new Set(lessons))).toMatchObject({
      percent: 100,
      nextLessonId: null,
    });
  });
  it('ignores completions of lessons no longer in the course', () => {
    expect(courseProgress(lessons, new Set(['gone']))).toMatchObject({
      completed: 0,
      nextLessonId: 'a',
    });
  });
  it('handles an empty course', () => {
    expect(courseProgress([], new Set())).toEqual({
      completed: 0,
      total: 0,
      percent: 0,
      nextLessonId: null,
    });
  });
  it('rounds down, so 2 of 3 is 66', () => {
    expect(courseProgress(['a', 'b', 'c'], new Set(['a', 'b'])).percent).toBe(66);
  });
});

describe('lessonNeighbours', () => {
  it('finds the previous and next lesson', () => {
    expect(lessonNeighbours(['a', 'b', 'c'], 'b')).toEqual({
      previousLessonId: 'a',
      nextLessonId: 'c',
    });
  });
  it('has no previous at the start and no next at the end', () => {
    expect(lessonNeighbours(['a', 'b'], 'a').previousLessonId).toBeNull();
    expect(lessonNeighbours(['a', 'b'], 'b').nextLessonId).toBeNull();
  });
  it('answers nothing for an unknown lesson', () => {
    expect(lessonNeighbours(['a'], 'x')).toEqual({ previousLessonId: null, nextLessonId: null });
  });
});

describe('gradeQuiz', () => {
  const questions = [
    { questionId: 'q1', correctIndex: 1 },
    { questionId: 'q2', correctIndex: 3 },
    { questionId: 'q3', correctIndex: 0 },
  ];
  it('scores correct answers and marks wrong and skipped ones', () => {
    const grade = gradeQuiz(questions, [
      { questionId: 'q1', chosenIndex: 1 },
      { questionId: 'q2', chosenIndex: 0 },
    ]);
    expect(grade.score).toBe(1);
    expect(grade.total).toBe(3);
    expect(grade.answers.map((a) => a.isCorrect)).toEqual([true, false, false]);
    expect(grade.answers[2]?.chosenIndex).toBeNull();
  });
  it('ignores unknown questions and duplicate answers', () => {
    const grade = gradeQuiz(questions, [
      { questionId: 'q1', chosenIndex: 0 },
      { questionId: 'q1', chosenIndex: 1 },
      { questionId: 'nope', chosenIndex: 1 },
    ]);
    expect(grade.score).toBe(0);
  });
  it('treats an out-of-range choice as wrong', () => {
    expect(
      gradeQuiz(questions, [{ questionId: 'q3', chosenIndex: 7 }]).answers[2]?.chosenIndex,
    ).toBeNull();
  });
  it('never scores above the number of questions, whatever is submitted', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            questionId: fc.constantFrom('q1', 'q2', 'q3', 'x'),
            chosenIndex: fc.option(fc.integer({ min: -2, max: 6 }), { nil: null }),
          }),
        ),
        (submitted) => {
          const grade = gradeQuiz(questions, submitted);
          return grade.score >= 0 && grade.score <= grade.total && grade.answers.length === 3;
        },
      ),
    );
  });
});

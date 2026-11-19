// [LT] US9.7: the takedown state machine, the reason rule, and reading a course from a link.
import { describe, expect, it } from 'vitest';
import { courseIdFrom, isReason, nextTakedownState } from './takedown.ts';

describe('nextTakedownState', () => {
  it('open → honoured or rejected; honoured → reversed; nothing else', () => {
    expect(nextTakedownState('open', 'honour')).toBe('honoured');
    expect(nextTakedownState('open', 'reject')).toBe('rejected');
    expect(nextTakedownState('honoured', 'reverse')).toBe('reversed');
    expect(nextTakedownState('open', 'reverse')).toBeNull();
    expect(nextTakedownState('rejected', 'honour')).toBeNull();
    expect(nextTakedownState('reversed', 'reverse')).toBeNull();
    expect(nextTakedownState('honoured', 'honour')).toBeNull();
  });
});

describe('isReason / courseIdFrom', () => {
  it('needs at least 10 real characters', () => {
    expect(isReason('   short  ')).toBe(false);
    expect(isReason(undefined)).toBe(false);
    expect(isReason('Licence shown by the instructor.')).toBe(true);
  });
  it('reads a course ID from a link or the bare ID', () => {
    const id = '0F9A5B2E-6D1C-4B8E-9A7F-000000000001';
    expect(courseIdFrom(`https://example.test/courses/${id}?x=1`)).toBe(id.toLowerCase());
    expect(courseIdFrom('no id here')).toBeNull();
  });
});

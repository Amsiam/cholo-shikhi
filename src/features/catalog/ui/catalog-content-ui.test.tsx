// [LT] Step 28: I1 builder part 2 with React Testing Library (US3.17, US3.9, US3.10, US3.8, US3.0;
// NFR6.208, NFR6.211, NFR7.201): the lesson list and editor, the text-lesson editor whose preview
// goes through the one renderer (the XSS corpus included), the review panel, and the publish,
// unpublish and retire dialogs. Errors are i18n keys, announced and linked to their field.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import { HOSTILE_HREFS, XSS_CORPUS } from '../test-fixtures/xss-corpus.ts';
import { PublishPanel, type PublishPanelProps } from './PublishPanel.tsx';
import {
  availableReviewActions,
  type ContentLesson,
  type ContentSection,
  type SectionContentActions,
  SectionContentEditor,
} from './SectionContentEditor.tsx';

if (!('ResizeObserver' in globalThis)) {
  const noOp = (): void => undefined;
  globalThis.ResizeObserver = class {
    observe = noOp;
    unobserve = noOp;
    disconnect = noOp;
  } as unknown as typeof ResizeObserver;
}

const lesson = (over: Partial<ContentLesson> = {}): ContentLesson => ({
  lessonId: 'l1',
  kind: 'text',
  liveState: 'never_published',
  position: 1,
  version: 1,
  titleBn: 'ভূমিকা',
  titleEn: 'Introduction',
  bodyBn: null,
  bodyEn: null,
  mediaStatus: 'none',
  youtubeVideoId: null,
  captionLanguages: [],
  quizQuestionCount: 0,
  isComplete: false,
  isUnderTakedown: false,
  ...over,
});

const section = (over: Partial<ContentSection> = {}): ContentSection => ({
  sectionId: 's1',
  isOwner: true,
  isLead: false,
  canManageCourse: false,
  isUnderTakedown: false,
  canEdit: true,
  working: { reviewState: 'draft', titleBn: 'গণিত', titleEn: 'Maths' },
  lessons: [lesson(), lesson({ lessonId: 'l2', kind: 'video', position: 2, titleEn: 'Video' })],
  lastReturnComment: null,
  ...over,
});

function actions(over: Partial<SectionContentActions> = {}): SectionContentActions {
  return {
    onAddLesson: vi.fn(async () => null),
    onEditLesson: vi.fn(async () => null),
    onSaveBody: vi.fn(async () => null),
    onSetVideo: vi.fn(async () => null),
    onLoadQuiz: vi.fn(async () => ({ questions: [] })),
    onSaveQuiz: vi.fn(async () => null),
    onReorder: vi.fn(async () => null),
    onRemoveLesson: vi.fn(async () => null),
    onReview: vi.fn(async () => null),
    ...over,
  };
}

function editor(s: ContentSection, a: SectionContentActions, locale: 'bn' | 'en' = 'en') {
  return render(
    <I18nProvider locale={locale}>
      <SectionContentEditor section={s} {...a} />
    </I18nProvider>,
  );
}

const DANGEROUS_URL = /^(javascript|data|vbscript):/;
function assertInert(container: HTMLElement) {
  for (const element of container.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      expect(attribute.name.toLowerCase().startsWith('on')).toBe(false);
      if (attribute.name === 'href' || attribute.name === 'src') {
        const normalised = [...attribute.value]
          .filter((c) => (c.codePointAt(0) ?? 0) > 0x20)
          .join('')
          .toLowerCase();
        expect(DANGEROUS_URL.test(normalised)).toBe(false);
      }
    }
    expect(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'STYLE']).not.toContain(element.tagName);
  }
}

describe('SectionContentEditor: lessons (US3.17)', () => {
  it('lists the lessons in order with their completeness and the missing-caption note', () => {
    editor(section(), actions());
    const rows = screen.getAllByTestId('lesson-row');
    expect(rows.map((r) => within(r).getByTestId('lesson-row-title').textContent)).toEqual([
      'Introduction',
      'Video',
    ]);
    expect(within(rows[1] as HTMLElement).getByTestId('lesson-row-no-captions')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByTestId('lesson-row-complete').textContent).toBe(
      'Incomplete',
    );
  });

  it('adds a lesson with its kind and titles', async () => {
    const a = actions();
    editor(section(), a);
    fireEvent.change(screen.getByTestId('lesson-add-form-title-en'), {
      target: { value: 'Algebra' },
    });
    fireEvent.click(screen.getByTestId('lesson-add-form-submit'));
    await waitFor(() =>
      expect(a.onAddLesson).toHaveBeenCalledWith({ kind: 'text', titleBn: '', titleEn: 'Algebra' }),
    );
  });

  it('AC3.17.2 announces the no-title refusal on the field', async () => {
    const a = actions({
      onAddLesson: vi.fn(async () => ({
        code: 'VALIDATION_FAILED',
        i18nKey: 'errors.common.VALIDATION_FAILED',
        fieldErrors: { titleBn: ['errors.catalog.lessonTitleRequired'] },
      })),
    });
    editor(section(), a);
    fireEvent.click(screen.getByTestId('lesson-add-form-submit'));
    const error = await screen.findByTestId('lesson-add-form-title-bn-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('lesson-add-form-title-bn').getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it('moves a lesson down by sending the full new order', async () => {
    const a = actions();
    editor(section(), a);
    fireEvent.click(screen.getAllByTestId('lesson-row-move-down')[0] as HTMLElement);
    await waitFor(() => expect(a.onReorder).toHaveBeenCalledWith(['l2', 'l1']));
  });

  it('asks before removing, and says a live lesson keeps student progress', async () => {
    const a = actions();
    editor(section({ lessons: [lesson({ liveState: 'live' })] }), a);
    fireEvent.click(screen.getByTestId('lesson-row-remove'));
    const dialog = await screen.findByTestId('lesson-remove-confirm');
    expect(dialog.textContent).toContain('keep their progress');
    fireEvent.click(screen.getByTestId('lesson-remove-confirm-confirm'));
    await waitFor(() => expect(a.onRemoveLesson).toHaveBeenCalledWith('l1'));
  });

  it('is read-only when the copy is not editable (in review, BR8.8)', () => {
    editor(
      section({
        canEdit: false,
        working: { reviewState: 'in_review', titleBn: 'x', titleEn: 'x' },
      }),
      actions(),
    );
    expect(screen.queryByTestId('lesson-add-form')).toBeNull();
    expect(screen.queryByTestId('lesson-row-remove')).toBeNull();
    expect((screen.getAllByTestId('lesson-body-bn-input')[0] as HTMLTextAreaElement).readOnly).toBe(
      true,
    );
  });
});

describe('text-lesson editor (BR3.4, NFR6.208)', () => {
  it('previews the parsed document and saves it per language', async () => {
    const a = actions();
    editor(section({ lessons: [lesson()] }), a);
    fireEvent.change(screen.getByTestId('lesson-body-bn-input'), {
      target: { value: '## অধ্যায়\n\nদেখুন [সূত্র](https://example.com/)' },
    });
    const preview = screen.getByTestId('lesson-body-bn-preview');
    expect(preview.querySelector('h2')?.textContent).toBe('অধ্যায়');
    expect(preview.querySelector('a')?.getAttribute('rel')).toBe(
      'noopener noreferrer nofollow ugc',
    );
    fireEvent.click(screen.getByTestId('lesson-body-bn-save'));
    await waitFor(() => expect(a.onSaveBody).toHaveBeenCalled());
    const [, language, body] = (a.onSaveBody as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      string,
      { type: string },
    ];
    expect(language).toBe('bn');
    expect(body.type).toBe('doc');
  });

  it('shows a blocked-link refusal against the body', async () => {
    const a = actions({
      onSaveBody: vi.fn(async () => ({
        code: 'VALIDATION_FAILED',
        i18nKey: 'errors.common.VALIDATION_FAILED',
        fieldErrors: { 'bodyEn.links.0': ['errors.catalog.blockedLink'] },
      })),
    });
    editor(section({ lessons: [lesson()] }), a);
    fireEvent.change(screen.getByTestId('lesson-body-en-input'), {
      target: { value: '[x](https://bad.example/)' },
    });
    fireEvent.click(screen.getByTestId('lesson-body-en-save'));
    expect((await screen.findByTestId('lesson-body-en-error')).textContent).toContain('blocked');
    expect(screen.getByTestId('lesson-body-en-input').getAttribute('aria-invalid')).toBe('true');
  });

  it(`renders all ${XSS_CORPUS.length} corpus payloads inert through the editor preview`, () => {
    editor(section({ lessons: [lesson()] }), actions());
    const markup = [
      ...XSS_CORPUS,
      ...XSS_CORPUS.map((p) => `[x](${p.replace(/[\s)]/g, '')})`),
      ...HOSTILE_HREFS.map((h) => `[y](${h.replace(/[\s)]/g, '')})`),
    ].join('\n\n');
    fireEvent.change(screen.getByTestId('lesson-body-bn-input'), { target: { value: markup } });
    const preview = screen.getByTestId('lesson-body-bn-preview');
    assertInert(preview);
    for (const a of preview.querySelectorAll('a')) {
      expect(a.getAttribute('href')?.startsWith('https://')).toBe(true);
    }
    expect(preview.textContent).toContain('<script>alert(1)</script>');
  });
});

describe('review panel (US3.9, US3.10)', () => {
  it('derives the actions from role and state (BR8.3–BR8.8)', () => {
    expect(availableReviewActions(section())).toEqual(['submit']);
    expect(availableReviewActions(section({ isLead: true }))).toEqual(['selfApprove']);
    expect(
      availableReviewActions(
        section({
          isOwner: false,
          canManageCourse: true,
          working: { reviewState: 'in_review', titleBn: '', titleEn: '' },
        }),
      ),
    ).toEqual(['approve', 'return']);
    expect(
      availableReviewActions(
        section({ working: { reviewState: 'approved', titleBn: '', titleEn: '' } }),
      ),
    ).toEqual(['reopen']);
    expect(availableReviewActions(section({ working: null }))).toEqual([]);
    expect(availableReviewActions(section({ isUnderTakedown: true }))).toEqual([]);
  });

  it('AC3.10.3 shows the empty-comment refusal on the comment field', async () => {
    const a = actions({
      onReview: vi.fn(async () => ({
        code: 'VALIDATION_FAILED',
        i18nKey: 'errors.common.VALIDATION_FAILED',
        fieldErrors: { comment: ['errors.catalog.returnCommentRequired'] },
      })),
    });
    editor(
      section({
        isOwner: false,
        canManageCourse: true,
        working: { reviewState: 'in_review', titleBn: '', titleEn: '' },
      }),
      a,
    );
    fireEvent.click(screen.getByTestId('review-panel-return'));
    expect((await screen.findByTestId('review-panel-error')).textContent).toContain('comment');
    expect(screen.getByTestId('review-panel-comment-input').getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(a.onReview).toHaveBeenCalledWith('return', '');
  });

  it('AC3.10.2 the owner reads the return comment as plain text, never as markup (NFR6.211)', () => {
    const payload = XSS_CORPUS[2] as string;
    const { container } = editor(
      section({ lastReturnComment: `Fix lesson 2\n${payload}` }),
      actions(),
    );
    const comment = screen.getByTestId('review-panel-comment');
    expect(comment.textContent).toContain(payload);
    assertInert(container);
  });

  it('submits for review (AC3.9.1)', async () => {
    const a = actions();
    editor(section(), a);
    fireEvent.click(screen.getByTestId('review-panel-submit'));
    await waitFor(() => expect(a.onReview).toHaveBeenCalledWith('submit', undefined));
  });
});

describe('PublishPanel (US3.8, US3.0)', () => {
  const base = (over: Partial<PublishPanelProps> = {}): PublishPanelProps => ({
    readiness: {
      status: 'draft',
      missingFields: [],
      sections: [
        { sectionId: 's1', reviewState: 'approved', willPublish: true, isBlocking: false },
      ],
      missingCaptionLessonIds: [],
      blockedLinkLessonIds: [],
      lessons: [],
      refusalKey: null,
    },
    canManage: true,
    sectionTitles: { s1: { titleBn: 'গণিত', titleEn: 'Maths' } },
    description: { descriptionBn: 'বিবরণ', descriptionEn: null },
    onSaveDescription: vi.fn(async () => null),
    onPublish: vi.fn(async () => null),
    onUnpublish: vi.fn(async () => null),
    onRetire: vi.fn(async () => null),
    ...over,
  });
  const panel = (p: PublishPanelProps, locale: 'bn' | 'en' = 'en') =>
    render(
      <I18nProvider locale={locale}>
        <PublishPanel {...p} />
      </I18nProvider>,
    );

  it('AC3.0.2 names the missing fields and keeps Publish disabled', () => {
    panel(
      base({
        readiness: {
          ...base().readiness,
          missingFields: ['listPrice', 'accessDuration'],
          refusalKey: 'errors.catalog.publishPreconditions',
        },
      }),
    );
    const missing = screen.getByTestId('publish-panel-missing');
    expect(missing.textContent).toContain('A price');
    expect(missing.textContent).toContain('An access duration');
    expect((screen.getByTestId('publish-panel-publish') as HTMLButtonElement).disabled).toBe(true);
  });

  it('AC3.8.4 lists lessons without captions and publishes once confirmed', async () => {
    const p = base({
      readiness: {
        ...base().readiness,
        missingCaptionLessonIds: ['v1', 'v2'],
        lessons: [
          { lessonId: 'v1', sectionId: 's1', titleBn: null, titleEn: 'Video one' },
          { lessonId: 'v2', sectionId: 's1', titleBn: null, titleEn: 'Video two' },
        ],
      },
    });
    panel(p);
    expect(screen.getByTestId('publish-panel-captions').textContent).toContain('Video two');
    expect((screen.getByTestId('publish-panel-publish') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('publish-panel-captions-confirm'));
    fireEvent.click(screen.getByTestId('publish-panel-publish'));
    fireEvent.click(await screen.findByTestId('publish-panel-confirm-confirm'));
    await waitFor(() => expect(p.onPublish).toHaveBeenCalledWith(['v1', 'v2']));
  });

  it('SD-212 lists the lesson behind a blocked-link refusal at publish', async () => {
    const p = base({
      onPublish: vi.fn(async () => ({
        code: 'VALIDATION_FAILED',
        i18nKey: 'errors.common.VALIDATION_FAILED',
        fieldErrors: { 'sections.s1.lessons.l9.bodyBn.links.0': ['errors.catalog.blockedLink'] },
      })),
    });
    panel(p);
    fireEvent.click(screen.getByTestId('publish-panel-publish'));
    fireEvent.click(await screen.findByTestId('publish-panel-confirm-confirm'));
    expect((await screen.findByTestId('publish-panel-blocked-links')).textContent).toContain('l9');
    expect(screen.getByTestId('publish-panel-message').getAttribute('role')).toBe('alert');
  });

  it('unpublish and retire ask first; a disabled unpublish is reported by its key', async () => {
    const p = base({
      readiness: { ...base().readiness, status: 'published' },
      onUnpublish: vi.fn(async () => ({
        code: 'FEATURE_DISABLED',
        i18nKey: 'errors.common.FEATURE_DISABLED',
      })),
    });
    panel(p);
    fireEvent.click(screen.getByTestId('publish-panel-unpublish'));
    expect((await screen.findByTestId('publish-panel-confirm')).textContent).toContain(
      'keep access',
    );
    fireEvent.click(screen.getByTestId('publish-panel-confirm-confirm'));
    expect((await screen.findByTestId('publish-panel-message')).textContent).toContain(
      'not available',
    );
    fireEvent.click(screen.getByTestId('publish-panel-retire'));
    expect((await screen.findByTestId('publish-panel-confirm')).textContent).toContain(
      'never be published again',
    );
    fireEvent.click(screen.getByTestId('publish-panel-confirm-confirm'));
    await waitFor(() => expect(p.onRetire).toHaveBeenCalled());
  });

  it('hides every Lead control from a Co-instructor (BR6.9)', () => {
    panel(base({ canManage: false, readiness: { ...base().readiness, status: 'published' } }));
    expect(screen.queryByTestId('publish-panel-publish')).toBeNull();
    expect(screen.queryByTestId('publish-panel-retire')).toBeNull();
    expect(screen.queryByTestId('course-description-form')).toBeNull();
  });

  it('saves the description and renders in Bangla', async () => {
    const p = base();
    panel(p, 'bn');
    fireEvent.change(screen.getByTestId('course-description-en'), { target: { value: 'About' } });
    fireEvent.click(screen.getByTestId('course-description-save'));
    await waitFor(() =>
      expect(p.onSaveDescription).toHaveBeenCalledWith({
        descriptionBn: 'বিবরণ',
        descriptionEn: 'About',
      }),
    );
    expect(screen.getByTestId('publish-panel-publish').textContent).toBe('কোর্স প্রকাশ করুন');
  });
});

describe('forms use the latest props after a reload (BR12.1 regression)', () => {
  it('the description form calls the handler of the latest render, which carries the new version', async () => {
    const first = vi.fn(async () => null);
    const latest = vi.fn(async () => null);
    const props = (
      onSaveDescription: PublishPanelProps['onSaveDescription'],
    ): PublishPanelProps => ({
      readiness: {
        status: 'draft',
        missingFields: [],
        sections: [],
        missingCaptionLessonIds: [],
        blockedLinkLessonIds: [],
        lessons: [],
        refusalKey: null,
      },
      canManage: true,
      sectionTitles: {},
      description: { descriptionBn: null, descriptionEn: null },
      onSaveDescription,
      onPublish: vi.fn(async () => null),
      onUnpublish: vi.fn(async () => null),
      onRetire: vi.fn(async () => null),
    });
    const view = render(
      <I18nProvider locale="en">
        <PublishPanel {...props(first)} />
      </I18nProvider>,
    );
    view.rerender(
      <I18nProvider locale="en">
        <PublishPanel {...props(latest)} />
      </I18nProvider>,
    );
    fireEvent.change(screen.getByTestId('course-description-en'), { target: { value: 'About' } });
    fireEvent.click(screen.getByTestId('course-description-save'));
    await waitFor(() => expect(latest).toHaveBeenCalled());
    expect(first).not.toHaveBeenCalled();
  });

  it('the add-lesson form calls the handler of the latest render', async () => {
    const first = actions();
    const latest = actions();
    const view = editor(section(), first);
    view.rerender(
      <I18nProvider locale="en">
        <SectionContentEditor section={section()} {...latest} />
      </I18nProvider>,
    );
    fireEvent.change(screen.getByTestId('lesson-add-form-title-en'), { target: { value: 'Next' } });
    fireEvent.click(screen.getByTestId('lesson-add-form-submit'));
    await waitFor(() => expect(latest.onAddLesson).toHaveBeenCalled());
    expect(first.onAddLesson).not.toHaveBeenCalled();
  });
});

describe('I1 video and quiz content', () => {
  const videoSection = (over: Partial<ContentLesson> = {}) =>
    section({ lessons: [lesson({ lessonId: 'v1', kind: 'video', titleEn: 'Lecture', ...over })] });

  it('saves a pasted YouTube link as the video', async () => {
    const onSetVideo = vi.fn(async () => null);
    editor(videoSection(), actions({ onSetVideo }));
    fireEvent.change(screen.getByTestId('video-editor-link'), {
      target: { value: 'https://youtu.be/RGqj9z65P3Y' },
    });
    fireEvent.click(screen.getByTestId('video-editor-save'));
    await waitFor(() =>
      expect(onSetVideo).toHaveBeenCalledWith(
        expect.objectContaining({ lessonId: 'v1' }),
        'https://youtu.be/RGqj9z65P3Y',
      ),
    );
  });

  it('flags a link that is not a YouTube video before saving', () => {
    editor(videoSection(), actions());
    fireEvent.change(screen.getByTestId('video-editor-link'), {
      target: { value: 'https://example.com/video' },
    });
    expect(screen.getByText("That isn't a YouTube video link or ID.")).toBeTruthy();
  });

  it('shows the current video and removes it', async () => {
    const onSetVideo = vi.fn(async () => null);
    editor(videoSection({ youtubeVideoId: 'RGqj9z65P3Y' }), actions({ onSetVideo }));
    expect(screen.getByTestId('video-editor-current').textContent).toContain('RGqj9z65P3Y');
    fireEvent.click(screen.getByTestId('video-editor-clear'));
    await waitFor(() => expect(onSetVideo).toHaveBeenCalledWith(expect.anything(), null));
  });

  it('previews a pasted link before it is saved', () => {
    editor(videoSection(), actions());
    expect(screen.queryByTestId('video-editor-preview-open')).toBeNull();
    fireEvent.change(screen.getByTestId('video-editor-link'), {
      target: { value: 'https://youtu.be/RGqj9z65P3Y' },
    });
    fireEvent.click(screen.getByTestId('video-editor-preview-open'));
    expect(screen.getByTestId('video-editor-preview').getAttribute('src')).toContain(
      '/embed/RGqj9z65P3Y',
    );
    expect(screen.getByTestId('video-editor-unsaved')).toBeTruthy();
  });

  it('previews the saved video, and switches when a different link is typed', () => {
    editor(videoSection({ youtubeVideoId: 'RGqj9z65P3Y' }), actions());
    fireEvent.click(screen.getByTestId('video-editor-preview-open'));
    expect(screen.getByTestId('video-editor-preview').getAttribute('src')).toContain('RGqj9z65P3Y');
    expect(screen.queryByTestId('video-editor-unsaved')).toBeNull();
    fireEvent.change(screen.getByTestId('video-editor-link'), {
      target: { value: 'dQw4w9WgXcQ' },
    });
    expect(screen.getByTestId('video-editor-preview').getAttribute('src')).toContain('dQw4w9WgXcQ');
  });

  const quizSection = (canEdit = true) =>
    section({
      canEdit,
      lessons: [lesson({ lessonId: 'q1', kind: 'quiz', titleEn: 'Quiz', quizQuestionCount: 1 })],
    });
  const saved = {
    promptBn: 'প্রশ্ন',
    promptEn: 'What is 2 + 2?',
    optionsBn: ['৩', '৪', '৫', '৬'],
    optionsEn: ['3', '4', '5', '6'],
    correctIndex: 1,
    explanationBn: null,
    explanationEn: 'Two and two make four.',
  };

  it('loads the questions, edits one and saves the whole list', async () => {
    const onSaveQuiz = vi.fn(async () => null);
    editor(
      quizSection(),
      actions({ onLoadQuiz: vi.fn(async () => ({ questions: [saved] })), onSaveQuiz }),
    );
    fireEvent.click(screen.getByTestId('quiz-editor-toggle'));
    const prompts = await screen.findAllByTestId('quiz-editor-prompt-en');
    expect((prompts[0] as HTMLInputElement).value).toBe('What is 2 + 2?');
    fireEvent.change(prompts[0] as HTMLElement, { target: { value: 'What is two plus two?' } });
    fireEvent.click(screen.getAllByTestId('quiz-editor-correct')[2] as HTMLElement);
    fireEvent.click(screen.getByTestId('quiz-editor-save'));
    await waitFor(() => expect(onSaveQuiz).toHaveBeenCalledOnce());
    const [, questions] = onSaveQuiz.mock.calls[0] as unknown as [unknown, Array<typeof saved>];
    expect(questions).toEqual([{ ...saved, promptEn: 'What is two plus two?', correctIndex: 2 }]);
    expect(await screen.findByTestId('quiz-editor-saved')).toBeTruthy();
  });

  it('adds a blank question and shows the server field errors in place', async () => {
    const onSaveQuiz = vi.fn(async () => ({
      code: 'VALIDATION_FAILED',
      i18nKey: 'errors.common.VALIDATION_FAILED',
      fieldErrors: { 'questions.1.promptEn': ['errors.catalog.quiz.promptRequired'] },
    }));
    editor(
      quizSection(),
      actions({ onLoadQuiz: vi.fn(async () => ({ questions: [saved] })), onSaveQuiz }),
    );
    fireEvent.click(screen.getByTestId('quiz-editor-toggle'));
    fireEvent.click(await screen.findByTestId('quiz-editor-add'));
    expect(screen.getAllByTestId('quiz-editor-question')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('quiz-editor-save'));
    expect(await screen.findByText('Write the question.')).toBeTruthy();
  });

  it('lets a reviewer read the questions without editing them', async () => {
    editor(
      quizSection(false),
      actions({ onLoadQuiz: vi.fn(async () => ({ questions: [saved] })) }),
    );
    fireEvent.click(screen.getByTestId('quiz-editor-toggle'));
    expect(await screen.findByTestId('quiz-editor-form')).toBeTruthy();
    expect(screen.queryByTestId('quiz-editor-save')).toBeNull();
    expect(screen.queryByTestId('quiz-editor-add')).toBeNull();
  });
});

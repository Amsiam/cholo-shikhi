import { createFileRoute, notFound, redirect, useRouter } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import {
  completeMyLesson,
  dismissMyBadgeNotice,
  getMyLesson,
  submitMyQuiz,
} from '#src/features/learning/server/learning.functions.ts';
import { LessonPlayer } from '#src/features/learning/ui/LessonPlayer.tsx';
import { TrialLockedPage } from '#src/features/learning/ui/TrialParts.tsx';
import { NotEnrolled } from '../index.tsx';

// The lesson player. The enrolment is checked on the server for every read and write.
export const Route = createFileRoute('/learn/$courseId/lessons/$lessonId')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async ({ params }) => {
    const lesson = await getMyLesson({
      data: { courseId: params.courseId, lessonId: params.lessonId },
    });
    if (!lesson.ok) {
      if (lesson.error.code === 'NOT_FOUND' || lesson.error.code === 'VALIDATION_FAILED')
        throw notFound();
      // A lesson outside the free trial (or after it ran out): show the locked page, not an error.
      if (lesson.error.i18nKey === 'errors.learning.trialLocked')
        return { isLocked: true as const };
      throw new Error(`lesson could not be loaded: ${lesson.error.code}`);
    }
    return lesson.value;
  },
  notFoundComponent: NotEnrolled,
  component: LessonPage,
});

function LessonPage() {
  const data = Route.useLoaderData();
  const { courseId } = Route.useParams();
  const router = useRouter();
  if ('isLocked' in data) return <TrialLockedPage courseId={courseId} />;
  const lesson = data;
  return (
    <LessonPlayer
      key={lesson.lessonId}
      lesson={lesson}
      onComplete={async () => {
        await completeMyLesson({ data: { courseId: lesson.courseId, lessonId: lesson.lessonId } });
        await router.invalidate();
      }}
      onSubmitQuiz={async (answers) => {
        const result = await submitMyQuiz({
          data: { courseId: lesson.courseId, lessonId: lesson.lessonId, answers },
        }).catch(() => null);
        if (!result?.ok) return null;
        void router.invalidate();
        return result.value;
      }}
      onDismissBadgeNotice={async () => {
        await dismissMyBadgeNotice({ data: {} }).catch(() => null);
      }}
    />
  );
}

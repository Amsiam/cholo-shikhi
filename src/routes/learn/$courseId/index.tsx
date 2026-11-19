import { createFileRoute, Link, notFound, redirect, useRouter } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import type { StudentExamCard } from '#src/features/assessment/index.ts';
import {
  answerMyCourseNps,
  getMyExams,
  getMyLearningCourse,
} from '#src/features/learning/server/learning.functions.ts';
import { CourseHomeView } from '#src/features/learning/ui/CourseHomeView.tsx';
import { learnContainer } from '#src/features/learning/ui/learning-parts.tsx';
import { useI18n } from '#src/lib/i18n/react.tsx';

// A purchased course's learning dashboard. Without an active enrolment the course answers
// not-found, exactly like a missing one, so access cannot be probed.
export const Route = createFileRoute('/learn/$courseId/')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async ({ params }) => {
    const course = await getMyLearningCourse({ data: { courseId: params.courseId } });
    if (!course.ok) {
      if (course.error.code === 'NOT_FOUND' || course.error.code === 'VALIDATION_FAILED')
        throw notFound();
      throw new Error(`course could not be loaded: ${course.error.code}`);
    }
    const exams = await getMyExams({ data: {} });
    const courseExams = exams.ok
      ? (exams.value as { exams: StudentExamCard[] }).exams.filter(
          (e) => e.courseId === params.courseId,
        )
      : [];
    return { course: course.value, exams: courseExams };
  },
  notFoundComponent: NotEnrolled,
  component: CourseHomePage,
});

function CourseHomePage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  return (
    <CourseHomeView
      course={data.course}
      exams={data.exams}
      onNps={async (score) => {
        const r = (await answerMyCourseNps({
          data: { courseId: data.course.courseId, score },
        })) as { ok: true } | { ok: false; error: { i18nKey: string } };
        // A skip hides the card right away; an answer shows a thank-you first.
        if (r.ok && score === null) await router.invalidate();
        return r;
      }}
    />
  );
}

export function NotEnrolled() {
  const { t } = useI18n();
  return (
    <section className="min-h-[calc(100dvh-3.5rem)] bg-paper" data-testid="learn-not-found">
      <div className={`${learnContainer} flex flex-col items-start gap-3 py-16`}>
        <h1 className="text-3xl font-bold">{t('learn.notEnrolled.title')}</h1>
        <p className="text-ink/75">{t('learn.notEnrolled.body')}</p>
        <Link to="/learn" className="font-semibold text-primary underline underline-offset-4">
          {t('learn.myCourses.title')}
        </Link>
      </div>
    </section>
  );
}

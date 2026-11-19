import { createFileRoute, redirect } from '@tanstack/react-router';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import { listMyLearningCourses } from '#src/features/learning/server/learning.functions.ts';
import { MyCoursesView } from '#src/features/learning/ui/MyCoursesView.tsx';

// My courses: every course the Student has purchased, with progress.
export const Route = createFileRoute('/learn/')({
  beforeLoad: async () => {
    const shell = await getShellState();
    if (!shell.ok || !shell.value.isSignedIn) throw redirect({ to: '/sign-in' });
  },
  loader: async () => {
    const courses = await listMyLearningCourses({ data: {} });
    if (!courses.ok) throw new Error(`my courses could not be loaded: ${courses.error.code}`);
    return courses.value;
  },
  component: MyCoursesPage,
});

function MyCoursesPage() {
  return <MyCoursesView courses={Route.useLoaderData()} />;
}

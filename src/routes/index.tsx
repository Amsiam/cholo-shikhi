import { createFileRoute, getRouteApi, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { getShellState } from '#src/features/app-shell/server/shell.functions.ts';
import { Landing } from '#src/features/app-shell/ui/Landing.tsx';
import { searchCatalogCourses } from '#src/features/catalog/server/catalog-browse.functions.ts';
import { StudentDashboard } from '#src/features/dashboard/ui/StudentDashboard.tsx';
import { staffHome } from '#src/features/dashboard/ui/StudentShell.tsx';
import { getCurrentGoal } from '#src/features/goals/server/goals.functions.ts';
import {
  getMyGoalStreak,
  listMyLearningCourses,
} from '#src/features/learning/server/learning.functions.ts';
import { resumeCourse } from '#src/features/learning/ui/ContinueCard.tsx';
import { listMyCampaignBanners } from '#src/features/marketing/server/marketing.functions.ts';
import type { CampaignBanner } from '#src/features/marketing/server/marketing.server.ts';
import { CampaignBanners } from '#src/features/marketing/ui/StorefrontParts.tsx';
import { listMyNotifications } from '#src/features/notifications/server/notifications.functions.ts';
import { getLearningCounts } from './-adapters/learning.ts';

const root = getRouteApi('__root__');

const DASHBOARD_COURSES = 6;
const DASHBOARD_NOTIFICATIONS = 4;
const DASHBOARD_MY_COURSES = 3;

// `/`: the public landing page for visitors, the S2 dashboard for a signed-in Student. Each
// dashboard read fails soft, so one failing panel never takes the home page down.
export const Route = createFileRoute('/')({
  validateSearch: z.object({ verified: z.coerce.number().optional() }),
  beforeLoad: async () => {
    const shell = await getShellState();
    // Staff are not learners: their home is their own work, not the Student dashboard.
    const home = shell.ok && shell.value.isSignedIn ? staffHome(shell.value.roles) : null;
    if (home) throw redirect({ to: home });
    return { isSignedIn: shell.ok && shell.value.isSignedIn };
  },
  loader: async ({ context }) => {
    if (!context.isSignedIn) return null;
    const [goal, notifications, counts, myCourses, streak, banners] = await Promise.all([
      getCurrentGoal({ data: {} }).catch(() => null),
      listMyNotifications({ data: { page: 1, pageSize: DASHBOARD_NOTIFICATIONS } }).catch(
        () => null,
      ),
      getLearningCounts().catch(() => ({ enrolled: 0, vaultQuestions: 0 })),
      listMyLearningCourses({ data: {} }).catch(() => null),
      getMyGoalStreak({ data: {} }).catch(() => null),
      // US8.1: campaign banners for the Student's segment today.
      listMyCampaignBanners({ data: {} }).catch(() => null),
    ]);
    const current = goal?.ok
      ? { goalId: goal.value.goalId, nameBn: goal.value.nameBn, nameEn: goal.value.nameEn }
      : null;
    const courses = current
      ? await searchCatalogCourses({ data: { goalId: current.goalId, page: 1 } }).catch(() => null)
      : null;
    return {
      goal: current,
      courses: courses?.ok ? courses.value.items.slice(0, DASHBOARD_COURSES) : [],
      totalCourses: courses?.ok ? courses.value.total : 0,
      notifications: notifications?.ok ? notifications.value.rows : [],
      stats: counts,
      streak: streak?.ok ? streak.value : null,
      myCourses: myCourses?.ok ? myCourses.value.slice(0, DASHBOARD_MY_COURSES) : [],
      resume: myCourses?.ok ? resumeCourse(myCourses.value) : null,
      banners: banners?.ok ? (banners.value as CampaignBanner[]) : [],
    };
  },
  component: Home,
});

function Home() {
  const shell = root.useLoaderData();
  const data = Route.useLoaderData();
  const { verified } = Route.useSearch();
  if (!shell.isSignedIn || !data) {
    return (
      <div data-testid="home-page">
        <Landing verified={Boolean(verified)} />
      </div>
    );
  }
  return (
    <>
      {data.banners.length > 0 ? (
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">
          <CampaignBanners banners={data.banners} />
        </div>
      ) : null}
      <StudentDashboard
        displayName={shell.displayName}
        goal={data.goal}
        courses={data.courses}
        totalCourses={data.totalCourses}
        notifications={data.notifications}
        unread={shell.unread}
        stats={data.stats}
        streak={data.streak}
        myCourses={data.myCourses}
        resume={data.resume}
        isVerified={Boolean(verified)}
      />
    </>
  );
}

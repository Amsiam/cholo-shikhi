// [LT] Student panel: dashboard greeting, count cards, empty states and the phone drawer.
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import { StudentDashboard, type StudentDashboardProps } from './StudentDashboard.tsx';
import { navFor, StudentShell, staffHome } from './StudentShell.tsx';

const ID = (n: number) => `0f9a5b2e-6d1c-4b8e-9a7f-${String(n).padStart(12, '0')}`;

function inRouter(node: ReactNode, locale: 'bn' | 'en' = 'en') {
  const rootRoute = createRootRoute({
    component: () => <I18nProvider locale={locale}>{node}</I18nProvider>,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router as never} />);
}

function props(overrides: Partial<StudentDashboardProps> = {}): StudentDashboardProps {
  return {
    displayName: 'Rahim Uddin',
    goal: { goalId: ID(1), nameBn: 'বিসিএস', nameEn: 'BCS Preliminary' },
    courses: [
      {
        kind: 'course',
        courseId: ID(10),
        titleBn: 'বাংলা',
        titleEn: 'BCS Bangla',
        listPricePoisha: 150_000,
        accessDurationMonths: 6,
        isPinned: false,
      },
    ],
    totalCourses: 14,
    notifications: [],
    unread: 3,
    stats: { enrolled: 0, vaultQuestions: 0 },
    myCourses: [],
    ...overrides,
  };
}

describe('StudentDashboard', () => {
  it('greets the Student by name and shows the goal', async () => {
    inRouter(<StudentDashboard {...props()} />);
    expect((await screen.findByTestId('home-greeting')).textContent).toBe(
      'Welcome back, Rahim Uddin',
    );
    expect(screen.getByTestId('dashboard-goal').textContent).toContain('BCS Preliminary');
  });

  it('fills the four count cards from real values', async () => {
    inRouter(<StudentDashboard {...props({ stats: { enrolled: 2, vaultQuestions: 7 } })} />);
    expect((await screen.findByTestId('stat-enrolled-value')).textContent).toBe('2');
    expect(screen.getByTestId('stat-available-value').textContent).toBe('14');
    expect(screen.getByTestId('stat-vault-value').textContent).toBe('7');
    expect(screen.getByTestId('stat-unread-value').textContent).toBe('3');
  });

  it('uses Bangla digits in Bangla', async () => {
    inRouter(<StudentDashboard {...props()} />, 'bn');
    expect((await screen.findByTestId('stat-available-value')).textContent).toBe('১৪');
  });

  it('asks a Student without a goal to choose one and hides the goal courses', async () => {
    inRouter(<StudentDashboard {...props({ goal: null, courses: [], totalCourses: 0 })} />);
    expect(await screen.findByTestId('dashboard-no-goal')).toBeTruthy();
    expect(screen.queryByTestId('dashboard-courses')).toBeNull();
    expect(screen.queryByTestId('dashboard-goal')).toBeNull();
  });

  it('greets without a name when none is set', async () => {
    inRouter(<StudentDashboard {...props({ displayName: '  ' })} />);
    expect((await screen.findByTestId('home-greeting')).textContent).toBe('Welcome back');
  });
});

describe('StudentShell', () => {
  it('opens the phone drawer with the same links and closes it again', async () => {
    inRouter(
      <StudentShell unread={2}>
        <p>page</p>
      </StudentShell>,
    );
    fireEvent.click(await screen.findByTestId('student-drawer-open'));
    const drawer = await screen.findByTestId('student-drawer');
    expect(drawer.querySelectorAll('nav a')).toHaveLength(18);
    expect(drawer.querySelector('[data-testid=shell-account]')).not.toBeNull();
    expect(drawer.textContent).toContain('Notifications');
    fireEvent.click(screen.getByTestId('student-drawer-close'));
    await waitFor(() => expect(screen.queryByTestId('student-drawer')).toBeNull());
  });

  it('marks the unread count on the notifications link', async () => {
    inRouter(
      <StudentShell unread={4}>
        <p>page</p>
      </StudentShell>,
    );
    const links = await screen.findAllByTestId('student-nav-notifications');
    expect(links[0]?.textContent).toContain('4');
  });
});

describe('menu by role', () => {
  const paths = (roles: string[]) => navFor(roles).map((item) => item.to);
  it('gives a Student the learning menu', () => {
    expect(paths([])).toEqual([
      '/',
      '/learn',
      '/live',
      '/catalog',
      '/store',
      '/vault',
      '/practice',
      '/exams',
      '/questions',
      '/battles',
      '/notifications',
      '/me/goal',
      '/me/streak',
      '/me/buddy',
      '/me/results',
      '/me/purchases',
      '/me/refer',
      '/me',
    ]);
  });
  it('gives an instructor their teaching menu, without the Student items', () => {
    expect(paths(['instructor'])).toEqual([
      '/instructor',
      '/instructor/courses',
      '/live-host',
      '/bank',
      '/exam-builder',
      '/battle-host',
      '/instructor/earnings',
      '/instructor/payouts',
      '/catalog',
      '/notifications',
      '/me',
    ]);
  });
  it('gives an admin who also teaches both staff items', () => {
    expect(paths(['instructor', 'admin'])).toEqual([
      '/instructor',
      '/instructor/courses',
      '/live-host',
      '/bank',
      '/exam-builder',
      '/battle-host',
      '/instructor/earnings',
      '/instructor/payouts',
      '/admin',
      '/admin/staff',
      '/admin/topics',
      '/admin/finance',
      '/admin/refunds',
      '/admin/rewards',
      '/admin/kyc',
      '/admin/payouts',
      '/admin/takedowns',
      '/admin/past-papers',
      '/admin/switches',
      '/admin/marketing',
      '/admin/disputes',
      '/admin/attribution',
      '/admin/fraud',
      '/admin/referrals',
      '/admin/hr',
      '/catalog',
      '/notifications',
      '/me',
    ]);
  });
  it('gives Finance staff the KYC review, not the Student menu', () => {
    expect(paths(['finance'])).toEqual([
      '/admin/kyc',
      '/admin/payouts',
      '/admin/disputes',
      '/admin/attribution',
      '/admin/hr',
      '/catalog',
      '/notifications',
      '/me',
    ]);
  });
  it('sends staff home to their own work', () => {
    expect(staffHome(['instructor'])).toBe('/instructor');
    expect(staffHome(['admin'])).toBe('/admin');
    expect(staffHome([])).toBeNull();
  });
});

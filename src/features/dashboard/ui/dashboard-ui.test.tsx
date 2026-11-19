// [LT] Student panel: dashboard greeting, count cards, empty states and the phone drawer.
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '#src/lib/i18n/react.tsx';
import { StudentDashboard, type StudentDashboardProps } from './StudentDashboard.tsx';
import { currentGroupOf, navGroupsFor, StudentShell, staffHome } from './StudentShell.tsx';

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
  it('opens the phone drawer with the same accordion sections and closes it again', async () => {
    inRouter(
      <StudentShell unread={2}>
        <p>page</p>
      </StudentShell>,
    );
    fireEvent.click(await screen.findByTestId('student-drawer-open'));
    const drawer = await screen.findByTestId('student-drawer');
    // Four sections; only the one holding the current place (`/`, in Learn) starts open.
    expect(drawer.querySelectorAll('[data-slot=accordion-trigger]')).toHaveLength(4);
    expect(drawer.querySelectorAll('nav a')).toHaveLength(5);
    expect(drawer.querySelector('[data-testid=shell-account]')).not.toBeNull();
    fireEvent.click(within(drawer).getByTestId('nav-group-you'));
    expect(await within(drawer).findByTestId('student-nav-notifications')).toBeTruthy();
    fireEvent.click(screen.getByTestId('student-drawer-close'));
    await waitFor(() => expect(screen.queryByTestId('student-drawer')).toBeNull());
  });

  it('shows the unread count on the closed Account section, then on the notifications link', async () => {
    inRouter(
      <StudentShell unread={4}>
        <p>page</p>
      </StudentShell>,
    );
    const [trigger] = await screen.findAllByTestId('nav-group-you');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger?.textContent).toContain('4');
    if (trigger) fireEvent.click(trigger);
    const links = await screen.findAllByTestId('student-nav-notifications');
    expect(links[0]?.textContent).toContain('4');
  });
});

describe('menu by role', () => {
  const groups = (roles: string[]) =>
    navGroupsFor(roles).map((g) => [g.label.split('.').pop(), g.items.map((item) => item.to)]);
  it('gives a Student four short learning sections', () => {
    expect(groups([])).toEqual([
      ['learn', ['/', '/learn', '/live', '/catalog', '/store']],
      ['practice', ['/practice', '/vault', '/exams', '/questions', '/battles']],
      ['progress', ['/me/goal', '/me/results', '/me/streak', '/me/buddy']],
      ['you', ['/notifications', '/me/purchases', '/me/refer', '/me']],
    ]);
  });
  it('gives an instructor their teaching sections, without the Student items', () => {
    expect(groups(['instructor'])).toEqual([
      ['teaching', ['/instructor', '/instructor/courses', '/bank', '/exam-builder']],
      ['live', ['/live-host', '/battle-host']],
      ['earnings', ['/instructor/earnings', '/instructor/payouts']],
      ['you', ['/catalog', '/notifications', '/me']],
    ]);
  });
  it('gives an admin who also teaches both sets of sections, each tool once', () => {
    expect(groups(['instructor', 'admin'])).toEqual([
      ['teaching', ['/instructor', '/instructor/courses', '/bank', '/exam-builder']],
      ['live', ['/live-host', '/battle-host']],
      ['earnings', ['/instructor/earnings', '/instructor/payouts']],
      ['console', ['/admin', '/admin/staff']],
      ['content', ['/admin/topics', '/admin/past-papers', '/admin/takedowns']],
      [
        'sales',
        [
          '/admin/refunds',
          '/admin/switches',
          '/admin/marketing',
          '/admin/rewards',
          '/admin/referrals',
        ],
      ],
      ['money', ['/admin/finance', '/admin/payouts', '/admin/kyc', '/admin/hr']],
      ['trust', ['/admin/disputes', '/admin/attribution', '/admin/fraud']],
      ['you', ['/catalog', '/notifications', '/me']],
    ]);
  });
  it('gives an admin who does not teach the authoring tools under Content and Live', () => {
    const admin = Object.fromEntries(groups(['admin']));
    expect(admin.content).toEqual([
      '/admin/topics',
      '/bank',
      '/exam-builder',
      '/admin/past-papers',
      '/admin/takedowns',
    ]);
    expect(admin.live).toEqual(['/live-host', '/battle-host']);
    expect(admin.teaching).toBeUndefined();
  });
  it('gives Finance staff the money and trust sections, not the Student menu', () => {
    expect(groups(['finance'])).toEqual([
      ['money', ['/admin/payouts', '/admin/kyc', '/admin/hr']],
      ['trust', ['/admin/disputes', '/admin/attribution']],
      ['you', ['/catalog', '/notifications', '/me']],
    ]);
  });
  it('opens the section holding the current place', () => {
    const admin = navGroupsFor(['admin']);
    expect(currentGroupOf(admin, '/admin/kyc')).toBe('shell.nav.group.money');
    expect(currentGroupOf(admin, '/admin')).toBe('shell.nav.group.console');
    expect(currentGroupOf(admin, '/exam-builder/abc')).toBe('shell.nav.group.content');
    expect(currentGroupOf(navGroupsFor([]), '/learn/abc/lessons/x')).toBe('shell.nav.group.learn');
    expect(currentGroupOf(navGroupsFor([]), '/me/purchases/p1')).toBe('shell.nav.group.you');
  });
  it('sends staff home to their own work', () => {
    expect(staffHome(['instructor'])).toBe('/instructor');
    expect(staffHome(['admin'])).toBe('/admin');
    expect(staffHome([])).toBeNull();
  });
});

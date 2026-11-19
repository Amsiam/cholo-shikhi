// The signed-in frame (DESIGN.md "The Examiner's Desk"). One top bar runs the full width: on wide
// screens its left cell is the sidebar's head (the wordmark) and its right cell holds the bell and
// the account; on phones it carries the menu button, so there is only one bar. The sidebar groups
// its places in short accordion sections (shadcn/ui Accordion) by the job at hand; the section with
// the current place opens itself. The current place is a light teal tint with a filled OMR bubble,
// every other place an empty one. The drawer on phones holds the same sections.
import { Link, useRouterState } from '@tanstack/react-router';
import {
  ArrowLeftRight,
  Banknote,
  Bell,
  BookOpen,
  BookOpenCheck,
  ClipboardCheck,
  ClipboardList,
  Coins,
  Contact,
  FilePenLine,
  FileUp,
  FileWarning,
  Flame,
  GraduationCap,
  HeartHandshake,
  Home,
  IdCard,
  Landmark,
  Layers,
  LayoutDashboard,
  Library,
  ListChecks,
  Megaphone,
  Menu,
  Package,
  PenSquare,
  Radio,
  Receipt,
  RotateCcw,
  Scale,
  Settings,
  Share2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Swords,
  Target,
  Undo2,
  UserCog,
  UserRound,
  Wallet,
  WalletCards,
  X,
} from 'lucide-react';
import { Dialog } from 'radix-ui';
import { type ComponentType, type ReactNode, type SVGProps, useEffect, useState } from 'react';
import { NotificationBell } from '#src/features/app-shell/ui/NotificationBell.tsx';
import type { MessageKey } from '#src/lib/i18n/index.ts';
import { useI18n } from '#src/lib/i18n/react.tsx';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

type NavItem = {
  to:
    | '/'
    | '/learn'
    | '/catalog'
    | '/store'
    | '/live'
    | '/live-host'
    | '/vault'
    | '/practice'
    | '/exams'
    | '/questions'
    | '/battles'
    | '/battle-host'
    | '/exam-builder'
    | '/bank'
    | '/admin/topics'
    | '/notifications'
    | '/me/goal'
    | '/me/purchases'
    | '/me/refer'
    | '/me/results'
    | '/me/streak'
    | '/me/buddy'
    | '/me'
    | '/instructor'
    | '/instructor/courses'
    | '/instructor/earnings'
    | '/admin'
    | '/admin/finance'
    | '/admin/kyc'
    | '/admin/payouts'
    | '/admin/staff'
    | '/admin/takedowns'
    | '/admin/past-papers'
    | '/admin/switches'
    | '/instructor/payouts'
    | '/admin/refunds'
    | '/admin/rewards'
    | '/admin/marketing'
    | '/admin/disputes'
    | '/admin/attribution'
    | '/admin/fraud'
    | '/admin/referrals'
    | '/admin/hr';
  label: MessageKey;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  exact?: boolean;
};

// The Student menu, in four short groups: where to learn, how to practise, how it is going, and
// the account.
const STUDENT_GROUPS: readonly NavGroup[] = [
  {
    label: 'shell.nav.group.learn',
    items: [
      { to: '/', label: 'dashboard.nav.dashboard', icon: Home, exact: true },
      { to: '/learn', label: 'learn.myCourses.title', icon: GraduationCap },
      { to: '/live', label: 'live.nav', icon: Radio },
      { to: '/catalog', label: 'shell.nav.courses', icon: BookOpen },
      { to: '/store', label: 'store.nav', icon: Package },
    ],
  },
  {
    label: 'shell.nav.group.practice',
    items: [
      { to: '/practice', label: 'practice.nav', icon: BookOpenCheck },
      { to: '/vault', label: 'dashboard.vault.title', icon: RotateCcw },
      { to: '/exams', label: 'exams.nav', icon: ClipboardList },
      { to: '/questions', label: 'explore.nav', icon: Library },
      { to: '/battles', label: 'battle.nav', icon: Swords },
    ],
  },
  {
    label: 'shell.nav.group.progress',
    items: [
      { to: '/me/goal', label: 'dashboard.nav.goal', icon: Target, exact: true },
      { to: '/me/results', label: 'results.nav', icon: ClipboardCheck },
      { to: '/me/streak', label: 'streak.nav', icon: Flame },
      { to: '/me/buddy', label: 'buddy.nav', icon: HeartHandshake },
    ],
  },
  {
    label: 'shell.nav.group.you',
    items: [
      { to: '/notifications', label: 'shell.nav.notifications', icon: Bell },
      { to: '/me/purchases', label: 'purchases.title', icon: Receipt },
      { to: '/me/refer', label: 'referral.nav', icon: Share2 },
      { to: '/me', label: 'dashboard.nav.settings', icon: Settings, exact: true },
    ],
  },
];

const TEACHING_HOME: NavItem = {
  to: '/instructor',
  label: 'teaching.nav',
  icon: LayoutDashboard,
  exact: true,
};
const TEACHING: NavItem = {
  to: '/instructor/courses',
  label: 'dashboard.nav.teaching',
  icon: PenSquare,
};
const EARNINGS: NavItem = {
  to: '/instructor/earnings',
  label: 'insights.nav.earnings',
  icon: Wallet,
};
const FINANCE: NavItem = { to: '/admin/finance', label: 'insights.nav.finance', icon: Landmark };
const ADMIN: NavItem = { to: '/admin', label: 'shell.nav.admin', icon: ShieldCheck, exact: true };

const BANK: NavItem = { to: '/bank', label: 'bank.nav', icon: ListChecks };
const EXAM_BUILDER: NavItem = { to: '/exam-builder', label: 'examBuilder.nav', icon: FilePenLine };
const LIVE_HOST: NavItem = { to: '/live-host', label: 'live.host.nav', icon: Radio };
const BATTLE_HOST: NavItem = { to: '/battle-host', label: 'battle.host.nav', icon: Swords };
const REFUNDS: NavItem = { to: '/admin/refunds', label: 'refund.admin.nav', icon: Undo2 };
const SWITCHES: NavItem = { to: '/admin/switches', label: 'switch.nav', icon: ArrowLeftRight };
const MARKETING: NavItem = { to: '/admin/marketing', label: 'marketing.nav', icon: Megaphone };
const DISPUTES: NavItem = { to: '/admin/disputes', label: 'dispute.nav', icon: ShieldAlert };
const ATTRIBUTION: NavItem = { to: '/admin/attribution', label: 'attribution.nav', icon: Scale };
const FRAUD: NavItem = { to: '/admin/fraud', label: 'fraud.nav', icon: ShieldQuestion };
const REFERRALS: NavItem = { to: '/admin/referrals', label: 'referral.admin.nav', icon: Share2 };
const HR: NavItem = { to: '/admin/hr', label: 'hr.nav', icon: Contact };
const PAST_PAPERS: NavItem = { to: '/admin/past-papers', label: 'pastPaper.nav', icon: FileUp };
const TAKEDOWNS: NavItem = { to: '/admin/takedowns', label: 'takedown.nav', icon: FileWarning };
const STAFF: NavItem = { to: '/admin/staff', label: 'staff.nav', icon: UserCog };
const PAYOUT_CYCLES: NavItem = { to: '/admin/payouts', label: 'payouts.nav', icon: Banknote };
const KYC_REVIEW: NavItem = { to: '/admin/kyc', label: 'kyc.queue.nav', icon: IdCard };
const PAYOUTS: NavItem = { to: '/instructor/payouts', label: 'kyc.nav', icon: WalletCards };
const REWARDS: NavItem = { to: '/admin/rewards', label: 'rewards.admin.nav', icon: Coins };
const TOPICS: NavItem = { to: '/admin/topics', label: 'bank.topics.nav', icon: Layers };

const CATALOG: NavItem = { to: '/catalog', label: 'shell.nav.courses', icon: BookOpen };
const NOTIFICATIONS: NavItem = {
  to: '/notifications',
  label: 'shell.nav.notifications',
  icon: Bell,
};
const SETTINGS: NavItem = {
  to: '/me',
  label: 'dashboard.nav.settings',
  icon: Settings,
  exact: true,
};

type NavGroup = { label: MessageKey; items: NavItem[] };

const group = (label: MessageKey, items: NavItem[]): NavGroup[] =>
  items.length > 0 ? [{ label, items }] : [];

/**
 * The menu for these roles, in short groups by the job at hand (each group is one accordion
 * section). Staff accounts (instructor, admin, finance) are not learners: they get their own work
 * plus the catalog, notifications and settings, never the Student items (dashboard, my courses,
 * my goal). An Admin who does not teach still gets the authoring tools, inside Content and Live.
 */
export function navGroupsFor(roles: readonly string[]): NavGroup[] {
  const isInstructor = roles.includes('instructor');
  const isAdmin = roles.includes('admin');
  const isFinance = roles.includes('finance');
  if (!isInstructor && !isAdmin && !isFinance) return [...STUDENT_GROUPS];
  const adminTools = isAdmin && !isInstructor;
  return [
    ...(isInstructor
      ? [
          ...group('shell.nav.group.teaching', [TEACHING_HOME, TEACHING, BANK, EXAM_BUILDER]),
          ...group('shell.nav.group.live', [LIVE_HOST, BATTLE_HOST]),
          ...group('shell.nav.group.earnings', [EARNINGS, PAYOUTS]),
        ]
      : []),
    ...(isAdmin
      ? [
          ...group('shell.nav.group.console', [ADMIN, STAFF]),
          ...group('shell.nav.group.content', [
            TOPICS,
            ...(adminTools ? [BANK, EXAM_BUILDER] : []),
            PAST_PAPERS,
            TAKEDOWNS,
          ]),
          ...(adminTools ? group('shell.nav.group.live', [LIVE_HOST, BATTLE_HOST]) : []),
          ...group('shell.nav.group.sales', [REFUNDS, SWITCHES, MARKETING, REWARDS, REFERRALS]),
          ...group('shell.nav.group.money', [FINANCE, PAYOUT_CYCLES, KYC_REVIEW, HR]),
          ...group('shell.nav.group.trust', [DISPUTES, ATTRIBUTION, FRAUD]),
        ]
      : []),
    // Finance staff (without Admin) review KYC, payout cycles, disputes, attribution and HR.
    ...(isFinance && !isAdmin
      ? [
          ...group('shell.nav.group.money', [PAYOUT_CYCLES, KYC_REVIEW, HR]),
          ...group('shell.nav.group.trust', [DISPUTES, ATTRIBUTION]),
        ]
      : []),
    ...group('shell.nav.group.you', [CATALOG, NOTIFICATIONS, SETTINGS]),
  ];
}

/** Whether this menu item is the current place (exact items match only their own path). */
export function isCurrentPlace(item: NavItem, pathname: string): boolean {
  if (item.exact || item.to === '/') return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/** The group holding the current place, if any. */
export function currentGroupOf(groups: readonly NavGroup[], pathname: string): string | undefined {
  return groups.find((g) => g.items.some((item) => isCurrentPlace(item, pathname)))?.label;
}

/** The same menu as one flat list, in reading order. */
export function navFor(roles: readonly string[]): NavItem[] {
  return navGroupsFor(roles).flatMap((group) => group.items);
}

/** Where a staff member's home is: their teaching list, or the admin console. */
export function staffHome(roles: readonly string[]): '/instructor' | '/admin' | null {
  if (roles.includes('instructor')) return '/instructor';
  if (roles.includes('admin')) return '/admin';
  return null;
}

const focusRing = 'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** The wordmark: a filled answer bubble beside the name, as on the landing sheet. */
function Wordmark(props: { onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <Link
      to="/"
      onClick={props.onNavigate}
      className={`inline-flex min-h-11 items-center gap-2.5 rounded-sm px-1 text-lg font-extrabold tracking-tight text-ink ${focusRing}`}
      data-testid="nav-home"
    >
      <span aria-hidden="true" className="size-4 rounded-full border-2 border-omr bg-ink" />
      {t('app.name')}
    </Link>
  );
}

/**
 * The menu as a shadcn/ui Accordion: one section per group. The section holding the current place
 * opens on its own (and again on every navigation into it); the others stay as the person left
 * them. A closed section still says what it hides: a filled bubble when it holds the current place,
 * and the unread count when it holds Notifications.
 */
function NavGroups(props: { unread: number; roles: readonly string[]; onNavigate?: () => void }) {
  const { t, formatInteger } = useI18n();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const groups = navGroupsFor(props.roles);
  const current = currentGroupOf(groups, pathname);
  const [open, setOpen] = useState<string[]>(() => (current ? [current] : []));
  useEffect(() => {
    if (current) setOpen((was) => (was.includes(current) ? was : [...was, current]));
  }, [current]);
  return (
    <Accordion type="multiple" value={open} onValueChange={setOpen} className="flex flex-col gap-1">
      {groups.map((group) => {
        const isOpen = open.includes(group.label);
        const holdsUnread =
          props.unread > 0 && group.items.some((item) => item.to === '/notifications');
        return (
          <AccordionItem key={group.label} value={group.label} className="border-b-0">
            <AccordionTrigger
              className={`min-h-11 items-center gap-2 rounded-sm px-3 py-0 text-xs font-semibold tracking-wide text-ink-muted uppercase hover:bg-primary/5 hover:text-ink hover:no-underline data-[state=open]:text-ink ${focusRing}`}
              data-testid={`nav-group-${group.label.split('.').pop()}`}
            >
              <span className="flex flex-1 items-center gap-2">
                {t(group.label)}
                {!isOpen && holdsUnread ? (
                  <span className="rounded-full bg-omr px-2 py-0.5 text-[0.7rem] font-semibold tracking-normal text-white tabular-nums normal-case">
                    {formatInteger(props.unread)}
                  </span>
                ) : null}
                {!isOpen && group.label === current ? (
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full border-2 border-primary bg-primary"
                  />
                ) : null}
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-2">
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      activeOptions={{ exact: item.exact ?? false, includeSearch: false }}
                      onClick={props.onNavigate}
                      className={`group flex min-h-11 items-center gap-3 rounded-sm px-3 text-sm text-ink/80 transition-colors hover:bg-primary/5 hover:text-ink data-[status=active]:bg-primary/10 data-[status=active]:font-semibold data-[status=active]:text-primary ${focusRing}`}
                      data-testid={`student-nav-${item.to === '/' ? 'home' : item.to.slice(1).replaceAll('/', '-')}`}
                    >
                      <item.icon aria-hidden="true" className="size-5 shrink-0" />
                      <span className="flex-1">{t(item.label)}</span>
                      {item.to === '/notifications' && props.unread > 0 ? (
                        <span className="rounded-full bg-omr px-2 py-0.5 text-xs font-semibold text-white tabular-nums">
                          {formatInteger(props.unread)}
                        </span>
                      ) : null}
                      {/* The answer bubble: filled for the current place, empty otherwise. */}
                      <span
                        aria-hidden="true"
                        className="size-3.5 shrink-0 rounded-full border-2 border-ink/20 transition-colors group-hover:border-primary/50 group-data-[status=active]:border-primary group-data-[status=active]:bg-primary"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

/** The first letter of a name (one grapheme, so Bangla conjuncts stay whole). */
function initialOf(name: string): string {
  const segment = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name.trim());
  return segment[Symbol.iterator]().next().value?.segment ?? '';
}

function Avatar(props: { name: string; size: 'sm' | 'md' }) {
  const initial = initialOf(props.name);
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full border-2 border-primary/30 bg-primary/10 font-bold text-primary ${props.size === 'sm' ? 'size-8 text-sm' : 'size-10'}`}
    >
      {initial || <UserRound className="size-4" />}
    </span>
  );
}

/** The account block at the foot of the phone drawer (on wide screens the top bar holds the account). */
function AccountBlock(props: { name: string; onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <Link
      to="/me"
      onClick={props.onNavigate}
      className={`flex min-h-14 items-center gap-3 rounded-sm px-3 py-2 hover:bg-primary/5 ${focusRing}`}
      data-testid="shell-account"
    >
      <Avatar name={props.name} size="md" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold text-ink">
          {props.name || t('shell.account.unnamed')}
        </span>
        <span className="text-sm text-ink-muted">{t('dashboard.nav.settings')}</span>
      </span>
    </Link>
  );
}

export function StudentShell(props: {
  unread: number;
  roles?: readonly string[];
  displayName?: string;
  children: ReactNode;
}) {
  const roles = props.roles ?? [];
  const name = props.displayName ?? '';
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const close = () => setIsOpen(false);
  return (
    <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
      <div
        className="grid min-h-dvh bg-paper lg:grid-cols-[16rem_minmax(0,1fr)] print:block print:bg-white lg:bg-[linear-gradient(to_right,var(--background)_16rem,var(--paper)_16rem)]"
        data-testid="student-shell"
      >
        <aside
          aria-label={t('dashboard.nav.label')}
          className="sticky top-0 hidden h-dvh flex-col border-r border-primary/15 bg-background lg:flex print:hidden"
          data-testid="student-sidebar"
        >
          <div className="flex h-14 shrink-0 items-center border-b border-primary/15 px-4">
            <Wordmark />
          </div>
          <nav aria-label={t('dashboard.nav.label')} className="flex-1 overflow-y-auto px-3 py-6">
            <NavGroups unread={props.unread} roles={roles} />
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-30 flex h-14 print:hidden shrink-0 items-center gap-2 border-b border-primary/15 bg-background px-2 sm:px-4">
            <Dialog.Trigger
              aria-label={t('dashboard.nav.menu')}
              className={`inline-flex size-11 items-center justify-center rounded-sm text-ink hover:bg-primary/10 lg:hidden ${focusRing}`}
              data-testid="student-drawer-open"
            >
              <Menu aria-hidden="true" className="size-5" />
            </Dialog.Trigger>
            <div className="lg:hidden">
              <Wordmark />
            </div>
            <div className="ml-auto flex items-center gap-1">
              <NotificationBell unread={props.unread} />
              <Link
                to="/me"
                aria-label={t('shell.nav.me')}
                className={`inline-flex min-h-11 items-center gap-2 rounded-sm px-1.5 hover:bg-primary/10 sm:px-2 ${focusRing}`}
                data-testid="nav-me"
              >
                <Avatar name={name} size="sm" />
                <span className="hidden max-w-40 truncate text-sm font-semibold text-ink sm:inline">
                  {name || t('shell.nav.me')}
                </span>
              </Link>
            </div>
          </header>
          <div className="min-w-0 flex-1">{props.children}</div>
        </div>
      </div>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-primary/20 bg-background pt-[env(safe-area-inset-top)] outline-none"
          data-testid="student-drawer"
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-primary/15 pr-2 pl-4">
            <Dialog.Title asChild>
              <span>
                <Wordmark onNavigate={close} />
              </span>
            </Dialog.Title>
            <Dialog.Close
              aria-label={t('dashboard.nav.close')}
              className={`inline-flex size-11 items-center justify-center rounded-sm text-ink-muted hover:bg-primary/10 hover:text-primary ${focusRing}`}
              data-testid="student-drawer-close"
            >
              <X aria-hidden="true" className="size-5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            {t('dashboard.nav.description')}
          </Dialog.Description>
          <nav aria-label={t('dashboard.nav.label')} className="flex-1 overflow-y-auto px-3 py-5">
            <NavGroups unread={props.unread} roles={roles} onNavigate={close} />
          </nav>
          <div className="border-t border-primary/15 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <AccountBlock name={name} onNavigate={close} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

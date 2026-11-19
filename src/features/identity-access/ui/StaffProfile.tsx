// The staff profile (Admin with two-step): one staff member's account and roles, and for anyone who
// teaches or taught, their payout cycles (with a cycle's statement), ledger earnings by month and by
// course, and their KYC, payout account (masked) and HR record. Read-only: roles are changed on the
// staff list, HR on /admin/hr, payouts on /admin/payouts.
import { Link } from '@tanstack/react-router';
import {
  ArrowLeft,
  BadgeCheck,
  Banknote,
  CircleAlert,
  Clock,
  FileText,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { formatMoney, type MoneyPoisha } from '#src/lib/money.ts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Role = 'instructor' | 'admin' | 'finance';
export type StaffRoleEntry = {
  role: Role;
  instructorType: 'employee' | 'contractor' | null;
  assignedAt: string;
  assignedBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
};
export type StaffProfileMember = {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  locale: 'bn' | 'en';
  status: string;
  isSuspended: boolean;
  hasTwoStep: boolean;
  createdAt: string;
  emailVerifiedAt: string | null;
  roles: StaffRoleEntry[];
  history: StaffRoleEntry[];
};
export type StaffCycle = {
  lineId: string;
  month: string;
  earned: number;
  salary: number;
  adjustment: number;
  carryIn: number;
  payout: number;
  carryOut: number;
  state: 'pending' | 'held' | 'disbursed';
  holdReason: 'kyc' | 'failed' | null;
  holdNote: string | null;
  disbursedAt: string | null;
};
export type StaffCycleStatement = StaffCycle & {
  lines: Array<{
    occurredAt: string;
    kind: 'course_sale' | 'course_refund' | 'attribution_reassignment';
    amount: number;
    titleBn: string;
    titleEn: string;
  }>;
  retainUntil: string;
};
export type StaffEarnings = {
  total: number;
  courseEarnings: number;
  reassigned: number;
  salary: number;
  policyAdjustment: number;
  sales: number;
  byMonth: Array<{ month: string; amount: number; sales: number }>;
  courses: Array<{
    courseId: string;
    status: string;
    earned: number;
    gross: number;
    sales: number;
    titleBn: string;
    titleEn: string;
  }>;
};
export type StaffKyc = {
  status: 'none' | 'pending' | 'verified' | 'rejected' | 'reverification_required';
  kyc: { status: string; legalName: string; nidMasked: string; submittedAt: string } | null;
  account: {
    rail: 'bkash' | 'nagad' | 'bank';
    accountName: string;
    accountMasked: string;
    bankName: string | null;
    status: 'pending' | 'verified' | 'rejected';
  } | null;
};
export type StaffHr = {
  instructorType: 'employee' | 'contractor';
  record: {
    salaryPoisha: number | null;
    joinedOn: string | null;
    exitOn: string | null;
    leaveBalanceDays: number;
  } | null;
  policies: Array<{ kind: string; isInEffect: boolean; effectiveFrom: string }>;
  leave: unknown[];
};
export type StaffMoney = {
  earnings: StaffEarnings | null;
  cycles: StaffCycle[] | null;
  kyc: StaffKyc | null;
  hr: StaffHr | null;
};

const card = 'grid gap-4 border border-primary/15 bg-background p-5';
const th = 'px-3 py-2 text-left text-xs font-semibold text-ink-muted';
const thNum = 'px-3 py-2 text-right text-xs font-semibold text-ink-muted';
const td = 'px-3 py-2.5 align-top';
const tdNum = 'px-3 py-2.5 text-right align-top tabular-nums';

function useMoney() {
  const { locale } = useI18n();
  return (poisha: number) =>
    poisha < 0
      ? `−${formatMoney(-poisha as MoneyPoisha, locale)}`
      : formatMoney(poisha as MoneyPoisha, locale);
}

function useMonth() {
  const { locale } = useI18n();
  const format = new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return (month: string) => format.format(new Date(`${month}-01T00:00:00Z`));
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs font-medium text-ink-muted">{props.label}</dt>
      <dd className="text-sm font-medium text-ink">{props.children}</dd>
    </div>
  );
}

function Stat(props: { label: string; value: string; tone?: 'pass' | 'omr' }) {
  const tone = props.tone === 'pass' ? 'text-pass' : props.tone === 'omr' ? 'text-omr' : 'text-ink';
  return (
    <div className="grid gap-1 border border-primary/15 bg-background px-4 py-3">
      <p className="text-xs font-medium text-ink-muted">{props.label}</p>
      <p className={`text-lg font-bold tabular-nums ${tone}`}>{props.value}</p>
    </div>
  );
}

function RoleLabel({ entry }: { entry: StaffRoleEntry }) {
  const { t } = useI18n();
  return (
    <>
      {t(`staff.role.${entry.role}`)}
      {entry.instructorType ? ` · ${t(`staff.type.${entry.instructorType}`)}` : null}
    </>
  );
}

function StateBadge({ cycle }: { cycle: StaffCycle }) {
  const { t } = useI18n();
  const Icon =
    cycle.state === 'disbursed' ? BadgeCheck : cycle.state === 'held' ? CircleAlert : Clock;
  const tone =
    cycle.state === 'disbursed'
      ? 'border-pass/40 text-pass'
      : cycle.state === 'held'
        ? 'border-omr/40 text-omr'
        : 'border-primary/30 text-primary';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {t(`payouts.state.${cycle.state}`)}
      {cycle.state === 'held' && cycle.holdReason
        ? ` · ${t(`payouts.holdReason.${cycle.holdReason}`)}`
        : null}
    </span>
  );
}

function Overview({ member }: { member: StaffProfileMember }) {
  const { t, formatDate } = useI18n();
  const past = member.history.filter((h) => h.revokedAt !== null);
  return (
    <div className="grid gap-4">
      <section className={card} aria-labelledby="staff-profile-account">
        <h2 id="staff-profile-account" className="text-lg font-bold">
          {t('staffProfile.account.title')}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Field label={t('staffProfile.account.email')}>{member.email}</Field>
          <Field label={t('staffProfile.account.phone')}>
            {member.phone ?? t('staffProfile.none')}
          </Field>
          <Field label={t('staffProfile.account.language')}>
            {t(`staffProfile.language.${member.locale}`)}
          </Field>
          <Field label={t('staffProfile.account.joined')}>{formatDate(member.createdAt)}</Field>
          <Field label={t('staffProfile.account.verified')}>
            {member.emailVerifiedAt ? formatDate(member.emailVerifiedAt) : t('staffProfile.no')}
          </Field>
          <Field label={t('staffProfile.account.status')}>
            {member.isSuspended ? t('staffProfile.status.suspended') : member.status}
          </Field>
        </dl>
      </section>
      <section className={card} aria-labelledby="staff-profile-roles">
        <h2 id="staff-profile-roles" className="text-lg font-bold">
          {t('staffProfile.roles.title')}
        </h2>
        {member.roles.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('staffProfile.roles.none')}</p>
        ) : (
          <ul className="grid gap-2">
            {member.roles.map((r) => (
              <li
                key={`${r.role}-${r.assignedAt}`}
                className="flex flex-wrap items-baseline gap-x-3"
              >
                <span className="font-semibold">
                  <RoleLabel entry={r} />
                </span>
                <span className="text-sm text-ink-muted">
                  {t('staffProfile.roles.since', {
                    date: formatDate(r.assignedAt),
                    by: r.assignedBy || t('staff.someAdmin'),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
        {past.length > 0 ? (
          <div className="grid gap-2 border-t border-primary/10 pt-3">
            <h3 className="text-sm font-semibold">{t('staffProfile.roles.past')}</h3>
            <ul className="grid gap-1.5 text-sm">
              {past.map((r) => (
                <li key={`${r.role}-${r.assignedAt}`} className="text-ink-muted">
                  <span className="font-medium text-ink">
                    <RoleLabel entry={r} />
                  </span>{' '}
                  {t('staffProfile.roles.held', {
                    from: formatDate(r.assignedAt),
                    to: formatDate(r.revokedAt ?? r.assignedAt),
                    by: r.revokedBy || t('staff.someAdmin'),
                  })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Payouts(props: {
  cycles: StaffCycle[];
  statement: StaffCycleStatement | null;
  selectedCycle: string | undefined;
  onSelectCycle: (month: string | null) => void;
}) {
  const { t, formatDate, locale } = useI18n();
  const money = useMoney();
  const month = useMonth();
  const paid = props.cycles
    .filter((c) => c.state === 'disbursed')
    .reduce((sum, c) => sum + c.payout, 0);
  const held = props.cycles.filter((c) => c.state === 'held').reduce((sum, c) => sum + c.payout, 0);
  const toPay = props.cycles
    .filter((c) => c.state === 'pending')
    .reduce((sum, c) => sum + c.payout, 0);
  if (props.cycles.length === 0) {
    return <p className="text-sm text-ink-muted">{t('staffProfile.payouts.none')}</p>;
  }
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t('staffProfile.payouts.paid')} value={money(paid)} tone="pass" />
        <Stat label={t('staffProfile.payouts.toPay')} value={money(toPay)} />
        <Stat
          label={t('staffProfile.payouts.held')}
          value={money(held)}
          tone={held > 0 ? 'omr' : undefined}
        />
      </div>
      <div className="overflow-x-auto border border-primary/15 bg-background">
        <table className="w-full min-w-[56rem] text-sm" data-testid="staff-profile-cycles">
          <caption className="sr-only">{t('staffProfile.payouts.caption')}</caption>
          <thead className="border-b border-primary/15">
            <tr>
              <th scope="col" className={th}>
                {t('staffProfile.payouts.month')}
              </th>
              <th scope="col" className={thNum}>
                {t('payouts.col.earned')}
              </th>
              <th scope="col" className={thNum}>
                {t('payouts.col.salary')}
              </th>
              <th scope="col" className={thNum}>
                {t('payouts.col.adjustment')}
              </th>
              <th scope="col" className={thNum}>
                {t('payouts.col.carryIn')}
              </th>
              <th scope="col" className={thNum}>
                {t('payouts.col.payout')}
              </th>
              <th scope="col" className={thNum}>
                {t('payouts.col.carryOut')}
              </th>
              <th scope="col" className={th}>
                {t('payouts.col.state')}
              </th>
              <th scope="col" className={th}>
                <span className="sr-only">{t('payouts.col.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-primary/10">
            {props.cycles.map((c) => (
              <tr key={c.lineId} className={c.month === props.selectedCycle ? 'bg-primary/5' : ''}>
                <th scope="row" className={`${td} text-left font-semibold`}>
                  {month(c.month)}
                </th>
                <td className={tdNum}>{money(c.earned)}</td>
                <td className={tdNum}>{money(c.salary)}</td>
                <td className={tdNum}>{money(c.adjustment)}</td>
                <td className={tdNum}>{money(c.carryIn)}</td>
                <td className={`${tdNum} font-semibold`}>{money(c.payout)}</td>
                <td className={tdNum}>{money(c.carryOut)}</td>
                <td className={td}>
                  <div className="grid gap-1">
                    <StateBadge cycle={c} />
                    {c.disbursedAt ? (
                      <span className="text-xs text-ink-muted">{formatDate(c.disbursedAt)}</span>
                    ) : null}
                    {c.holdNote ? (
                      <span className="text-xs text-ink-muted">{c.holdNote}</span>
                    ) : null}
                  </div>
                </td>
                <td className={td}>
                  <button
                    type="button"
                    className="tap-target inline-flex items-center gap-1 rounded-sm px-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    aria-pressed={c.month === props.selectedCycle}
                    onClick={() =>
                      props.onSelectCycle(c.month === props.selectedCycle ? null : c.month)
                    }
                    data-testid="staff-profile-statement-open"
                  >
                    <FileText aria-hidden="true" className="size-4" />
                    {t('staffProfile.payouts.statement')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {props.selectedCycle && props.statement ? (
        <section
          className={card}
          aria-labelledby="staff-profile-statement"
          data-testid="staff-profile-statement"
        >
          <h3 id="staff-profile-statement" className="text-lg font-bold">
            {t('staffProfile.statement.title', { month: month(props.selectedCycle) })}
          </h3>
          {props.statement.lines.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('staffProfile.statement.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="border-b border-primary/15">
                  <tr>
                    <th scope="col" className={th}>
                      {t('staffProfile.statement.date')}
                    </th>
                    <th scope="col" className={th}>
                      {t('staffProfile.statement.kind')}
                    </th>
                    <th scope="col" className={th}>
                      {t('staffProfile.statement.course')}
                    </th>
                    <th scope="col" className={thNum}>
                      {t('staffProfile.statement.amount')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-primary/10">
                  {props.statement.lines.map((l) => (
                    <tr key={`${l.occurredAt}-${l.kind}-${l.amount}-${l.titleBn}`}>
                      <td className={td}>{formatDate(l.occurredAt)}</td>
                      <td className={td}>{t(`staffProfile.lineKind.${l.kind}`)}</td>
                      <td className={td}>
                        {(locale === 'bn' ? l.titleBn : l.titleEn) || l.titleBn}
                      </td>
                      <td className={`${tdNum} ${l.amount < 0 ? 'text-omr' : ''}`}>
                        {money(l.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-ink-muted">
            {t('staffProfile.statement.kept', { date: formatDate(props.statement.retainUntil) })}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Earnings({ earnings }: { earnings: StaffEarnings }) {
  const { t, locale, formatInteger } = useI18n();
  const money = useMoney();
  const month = useMonth();
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={t('staffProfile.earnings.total')} value={money(earnings.total)} />
        <Stat label={t('staffProfile.earnings.courses')} value={money(earnings.courseEarnings)} />
        <Stat label={t('staffProfile.earnings.salary')} value={money(earnings.salary)} />
        <Stat
          label={t('staffProfile.earnings.adjustment')}
          value={money(earnings.policyAdjustment)}
        />
      </div>
      <section className={card} aria-labelledby="staff-profile-months">
        <h3 id="staff-profile-months" className="text-base font-bold">
          {t('staffProfile.earnings.byMonth')}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[24rem] text-sm">
            <thead className="border-b border-primary/15">
              <tr>
                <th scope="col" className={th}>
                  {t('staffProfile.payouts.month')}
                </th>
                <th scope="col" className={thNum}>
                  {t('staffProfile.earnings.salesCount')}
                </th>
                <th scope="col" className={thNum}>
                  {t('staffProfile.earnings.earned')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary/10">
              {earnings.byMonth.map((m) => (
                <tr key={m.month}>
                  <th scope="row" className={`${td} text-left font-medium`}>
                    {month(m.month)}
                  </th>
                  <td className={tdNum}>{formatInteger(m.sales)}</td>
                  <td className={tdNum}>{money(m.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className={card} aria-labelledby="staff-profile-courses">
        <h3 id="staff-profile-courses" className="text-base font-bold">
          {t('staffProfile.earnings.byCourse')}
        </h3>
        {earnings.courses.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('staffProfile.earnings.noCourses')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm" data-testid="staff-profile-courses">
              <thead className="border-b border-primary/15">
                <tr>
                  <th scope="col" className={th}>
                    {t('staffProfile.statement.course')}
                  </th>
                  <th scope="col" className={thNum}>
                    {t('staffProfile.earnings.salesCount')}
                  </th>
                  <th scope="col" className={thNum}>
                    {t('staffProfile.earnings.gross')}
                  </th>
                  <th scope="col" className={thNum}>
                    {t('staffProfile.earnings.earned')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-primary/10">
                {earnings.courses.map((c) => (
                  <tr key={c.courseId}>
                    <th scope="row" className={`${td} text-left font-medium`}>
                      <Link
                        to="/courses/$courseId"
                        params={{ courseId: c.courseId }}
                        className="text-primary hover:underline"
                      >
                        {(locale === 'bn' ? c.titleBn : c.titleEn) || c.titleBn}
                      </Link>
                    </th>
                    <td className={tdNum}>{formatInteger(c.sales)}</td>
                    <td className={tdNum}>{money(c.gross)}</td>
                    <td className={`${tdNum} font-semibold`}>{money(c.earned)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function IdentityAndHr({ kyc, hr }: { kyc: StaffKyc | null; hr: StaffHr | null }) {
  const { t, tDynamic, formatDate } = useI18n();
  const money = useMoney();
  const inEffect = hr?.policies.find((p) => p.isInEffect);
  return (
    <div className="grid gap-4">
      <section className={card} aria-labelledby="staff-profile-kyc">
        <h2 id="staff-profile-kyc" className="flex items-center gap-2 text-lg font-bold">
          <Banknote aria-hidden="true" className="size-5 text-primary" />
          {t('staffProfile.kyc.title')}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Field label={t('staffProfile.kyc.status')}>
            {t(`staffProfile.kyc.state.${kyc?.status ?? 'none'}`)}
          </Field>
          <Field label={t('staffProfile.kyc.legalName')}>
            {kyc?.kyc?.legalName ?? t('staffProfile.none')}
          </Field>
          <Field label={t('staffProfile.kyc.nid')}>
            {kyc?.kyc?.nidMasked ?? t('staffProfile.none')}
          </Field>
          <Field label={t('staffProfile.kyc.account')}>
            {kyc?.account
              ? `${t(`kyc.rail.${kyc.account.rail}`)} · ${kyc.account.accountMasked}`
              : t('staffProfile.none')}
          </Field>
          <Field label={t('staffProfile.kyc.accountName')}>
            {kyc?.account?.accountName ?? t('staffProfile.none')}
          </Field>
          <Field label={t('staffProfile.kyc.accountStatus')}>
            {kyc?.account ? t(`kyc.accountStatus.${kyc.account.status}`) : t('staffProfile.none')}
          </Field>
        </dl>
      </section>
      <section className={card} aria-labelledby="staff-profile-hr">
        <h2 id="staff-profile-hr" className="text-lg font-bold">
          {t('staffProfile.hr.title')}
        </h2>
        {hr ? (
          <dl className="grid gap-4 sm:grid-cols-3">
            <Field label={t('staffProfile.hr.type')}>{t(`staff.type.${hr.instructorType}`)}</Field>
            <Field label={t('staffProfile.hr.salary')}>
              {hr.record?.salaryPoisha != null
                ? money(hr.record.salaryPoisha)
                : t('staffProfile.none')}
            </Field>
            <Field label={t('staffProfile.hr.policy')}>
              {inEffect
                ? t('staffProfile.hr.policyFrom', {
                    kind: tDynamic(`hr.policy.kind.${inEffect.kind}`),
                    date: formatDate(inEffect.effectiveFrom),
                  })
                : t('staffProfile.none')}
            </Field>
            <Field label={t('staffProfile.hr.joined')}>
              {hr.record?.joinedOn ? formatDate(hr.record.joinedOn) : t('staffProfile.none')}
            </Field>
            <Field label={t('staffProfile.hr.exit')}>
              {hr.record?.exitOn ? formatDate(hr.record.exitOn) : t('staffProfile.none')}
            </Field>
            <Field label={t('staffProfile.hr.leave')}>
              {hr.record
                ? t('staffProfile.hr.leaveDays', { n: hr.record.leaveBalanceDays })
                : t('staffProfile.none')}
            </Field>
          </dl>
        ) : (
          <p className="text-sm text-ink-muted">{t('staffProfile.hr.none')}</p>
        )}
        <Link
          to="/admin/hr"
          className="tap-target w-fit text-sm font-medium text-primary hover:underline"
        >
          {t('staffProfile.hr.manage')}
        </Link>
      </section>
    </div>
  );
}

export function StaffProfile(props: {
  member: StaffProfileMember;
  money: StaffMoney | null;
  statement: StaffCycleStatement | null;
  selectedCycle: string | undefined;
  onSelectCycle: (month: string | null) => void;
}) {
  const { t } = useI18n();
  const { member, money } = props;
  const TwoStep = member.hasTwoStep ? ShieldCheck : ShieldAlert;
  return (
    <div className="grid gap-6" data-testid="staff-profile">
      <Link
        to="/admin/staff"
        className="tap-target inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('staffProfile.back')}
      </Link>
      <header className="grid gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {member.name || member.email}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {member.roles.map((r) => (
            <span
              key={r.role}
              className="rounded-sm border border-primary/25 bg-primary/5 px-2 py-0.5 font-semibold text-primary"
            >
              <RoleLabel entry={r} />
            </span>
          ))}
          <span
            className={`inline-flex items-center gap-1 font-semibold ${member.hasTwoStep ? 'text-pass' : 'text-omr'}`}
          >
            <TwoStep aria-hidden="true" className="size-4" />
            {member.hasTwoStep ? t('staff.twoStep.on') : t('staff.twoStep.off')}
          </span>
          {member.isSuspended ? (
            <span className="inline-flex items-center gap-1 font-semibold text-omr">
              <CircleAlert aria-hidden="true" className="size-4" />
              {t('staffProfile.status.suspended')}
            </span>
          ) : null}
        </div>
      </header>
      {money ? (
        <Tabs defaultValue={props.selectedCycle ? 'payouts' : 'overview'} className="grid gap-4">
          <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
            <TabsTrigger value="overview">{t('staffProfile.tab.overview')}</TabsTrigger>
            <TabsTrigger value="payouts" data-testid="staff-profile-tab-payouts">
              {t('staffProfile.tab.payouts')}
            </TabsTrigger>
            <TabsTrigger value="earnings" data-testid="staff-profile-tab-earnings">
              {t('staffProfile.tab.earnings')}
            </TabsTrigger>
            <TabsTrigger value="kyc">{t('staffProfile.tab.kyc')}</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <Overview member={member} />
          </TabsContent>
          <TabsContent value="payouts">
            {money.cycles ? (
              <Payouts
                cycles={money.cycles}
                statement={props.statement}
                selectedCycle={props.selectedCycle}
                onSelectCycle={props.onSelectCycle}
              />
            ) : (
              <p role="alert" className="text-sm text-omr">
                {t('staffProfile.loadFailed')}
              </p>
            )}
          </TabsContent>
          <TabsContent value="earnings">
            {money.earnings ? (
              <Earnings earnings={money.earnings} />
            ) : (
              <p role="alert" className="text-sm text-omr">
                {t('staffProfile.loadFailed')}
              </p>
            )}
          </TabsContent>
          <TabsContent value="kyc">
            <IdentityAndHr kyc={money.kyc} hr={money.hr} />
          </TabsContent>
        </Tabs>
      ) : (
        <Overview member={member} />
      )}
    </div>
  );
}

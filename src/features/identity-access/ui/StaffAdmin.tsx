// US1.6 Staff and roles (Admin with two-step sign-in). Adding staff is one form: name, email,
// language, role and (for an Instructor) Employee or Contracted. A verified account gets the role at
// once; anyone else is emailed a link to set a password, and gets the role when they do. Open
// invitations can be sent again or cancelled. Current staff link to their profile; a role is taken
// away behind a confirmation. Two-step status is shown, since staff must use it (US1.7).
import { Link } from '@tanstack/react-router';
import {
  MailCheck,
  MailPlus,
  Send,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type StaffRole = 'instructor' | 'admin' | 'finance';
type InstructorType = 'employee' | 'contractor';
export type StaffMember = {
  userId: string;
  name: string;
  email: string;
  hasTwoStep: boolean;
  roles: Array<{
    role: StaffRole;
    instructorType: InstructorType | null;
    since: string;
  }>;
};
export type StaffInvitation = {
  invitationId: string;
  userId: string;
  name: string;
  email: string;
  role: StaffRole;
  instructorType: InstructorType | null;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  isExpired: boolean;
};
export type InviteInput = {
  name: string;
  email: string;
  locale: 'bn' | 'en';
  role: StaffRole;
  instructorType?: InstructorType;
};
type Outcome<T = unknown> =
  | { ok: true; value?: T }
  | { ok: false; error: { code: string; i18nKey?: string } };

/** An error code from the role service, as a message key. */
export function staffErrorKey(code: string): string {
  const known: Record<string, string> = {
    FORBIDDEN: 'staff.error.forbidden',
    NOT_FOUND: 'staff.error.notFound',
    INVALID_STATE: 'staff.error.notVerified',
    CONFLICT: 'staff.error.alreadyHeld',
    LAST_ADMIN: 'staff.error.lastAdmin',
    VALIDATION_FAILED: 'staff.error.type',
    ALREADY_INVITED: 'errors.identity.ALREADY_INVITED',
    INVITE_INVALID: 'errors.identity.INVITE_INVALID',
  };
  return known[code] ?? 'staff.error.generic';
}

const card = 'flex flex-col gap-4 border border-primary/15 bg-background p-5';
const choice = (isOn: boolean) =>
  `flex min-h-11 cursor-pointer items-start gap-2.5 rounded-sm border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 ${isOn ? 'border-primary bg-primary/5' : 'border-primary/20 hover:border-primary/40'}`;

type Added =
  | { kind: 'assigned'; userId: string; name: string }
  | { kind: 'invited'; email: string };

function AddStaff(props: {
  onInvite: (
    input: InviteInput,
  ) => Promise<Outcome<{ mode: 'assigned' | 'invited'; userId: string }>>;
}) {
  const { t, tDynamic } = useI18n();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [locale, setLocale] = useState<'bn' | 'en'>('bn');
  const [role, setRole] = useState<StaffRole>('instructor');
  const [type, setType] = useState<InstructorType>('contractor');
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Added | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const submit = async () => {
    setError(null);
    setAdded(null);
    if (name.trim().length < 2) return setError('staff.add.nameRequired');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('staff.add.emailInvalid');
    setIsSaving(true);
    const r = await props.onInvite({
      name: name.trim(),
      email: email.trim(),
      locale,
      role,
      ...(role === 'instructor' ? { instructorType: type } : {}),
    });
    setIsSaving(false);
    if (!r.ok) return setError(staffErrorKey(r.error.code));
    setAdded(
      r.value?.mode === 'assigned'
        ? { kind: 'assigned', userId: r.value.userId, name: name.trim() }
        : { kind: 'invited', email: email.trim() },
    );
    setName('');
    setEmail('');
  };
  return (
    <section className={card} aria-labelledby="staff-add" data-testid="staff-add">
      <div className="grid gap-1">
        <h2 id="staff-add" className="flex items-center gap-2 text-xl font-bold">
          <UserPlus aria-hidden="true" className="size-5 text-primary" />
          {t('staff.add.title')}
        </h2>
        <p className="max-w-[65ch] text-sm text-ink-muted">{t('staff.add.intro')}</p>
      </div>
      <form
        noValidate
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="staff-name">{t('staff.add.name')}</Label>
            <Input
              id="staff-name"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="staff-name"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="staff-email">{t('staff.add.email')}</Label>
            <Input
              id="staff-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="staff-email"
            />
          </div>
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t('staff.add.role')}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(['instructor', 'admin', 'finance'] as const).map((r) => (
              <label key={r} className={choice(role === r)}>
                <input
                  type="radio"
                  name="staff-role"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={role === r}
                  onChange={() => setRole(r)}
                />
                <span className="grid gap-0.5">
                  <span className="font-semibold">{t(`staff.role.${r}`)}</span>
                  <span className="text-xs text-ink-muted">{t(`staff.roleHint.${r}`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {role === 'instructor' ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t('staff.add.type')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['employee', 'contractor'] as const).map((k) => (
                <label key={k} className={choice(type === k)}>
                  <input
                    type="radio"
                    name="staff-type"
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                    checked={type === k}
                    onChange={() => setType(k)}
                  />
                  <span className="grid gap-0.5">
                    <span className="font-semibold">{t(`staff.type.${k}`)}</span>
                    <span className="text-xs text-ink-muted">{t(`staff.typeHint.${k}`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t('staff.add.language')}</legend>
          <div className="flex flex-wrap gap-2">
            {(['bn', 'en'] as const).map((l) => (
              <label key={l} className={choice(locale === l)}>
                <input
                  type="radio"
                  name="staff-locale"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={locale === l}
                  onChange={() => setLocale(l)}
                />
                <span className="font-semibold">{t(`staffProfile.language.${l}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {tDynamic(error)}
          </p>
        ) : null}
        {added ? (
          <p
            role="status"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-pass/40 bg-pass/10 px-3 py-2 text-sm font-medium text-pass"
            data-testid="staff-added"
          >
            <MailCheck aria-hidden="true" className="size-4 shrink-0" />
            {added.kind === 'invited'
              ? t('staff.added.invited', { email: added.email })
              : t('staff.added.assigned', { name: added.name })}
            {added.kind === 'assigned' ? (
              <Link
                to="/admin/staff/$userId"
                params={{ userId: added.userId }}
                className="underline underline-offset-4"
              >
                {t('staff.added.open')}
              </Link>
            ) : null}
          </p>
        ) : null}
        <Button type="submit" className="w-fit" disabled={isSaving} data-testid="staff-assign">
          <MailPlus aria-hidden="true" />
          {t('staff.add.submit')}
        </Button>
      </form>
    </section>
  );
}

function Invitations(props: {
  invitations: StaffInvitation[];
  onResend: (invitationId: string) => Promise<Outcome>;
  onCancel: (invitationId: string) => Promise<Outcome>;
}) {
  const { t, tDynamic, formatDate } = useI18n();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<{ id: string; ok: boolean; key: string } | null>(null);
  if (props.invitations.length === 0) return null;
  const act = async (id: string, run: (id: string) => Promise<Outcome>, okKey: string) => {
    const r = await run(id);
    setConfirming(null);
    setMessage({ id, ok: r.ok, key: r.ok ? okKey : staffErrorKey(r.error.code) });
  };
  return (
    <section className={card} aria-labelledby="staff-invites" data-testid="staff-invites">
      <h2 id="staff-invites" className="flex items-center gap-2 text-xl font-bold">
        <Send aria-hidden="true" className="size-5 text-primary" />
        {t('staff.invites.title')}
      </h2>
      <ul className="flex flex-col divide-y divide-primary/10">
        {props.invitations.map((i) => (
          <li key={i.invitationId} className="flex flex-col gap-2 py-3" data-testid="staff-invite">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">
                {i.name} · <span className="font-normal text-ink/80">{i.email}</span>
              </span>
              <span className="text-sm font-medium">
                {t(`staff.role.${i.role}`)}
                {i.instructorType ? ` · ${t(`staff.type.${i.instructorType}`)}` : null}
              </span>
            </div>
            <p className={`text-xs ${i.isExpired ? 'font-semibold text-omr' : 'text-ink-muted'}`}>
              {i.isExpired
                ? t('staff.invites.expired', {
                    by: i.invitedBy || t('staff.someAdmin'),
                    sent: formatDate(i.createdAt),
                  })
                : t('staff.invites.open', {
                    by: i.invitedBy || t('staff.someAdmin'),
                    sent: formatDate(i.createdAt),
                    until: formatDate(i.expiresAt),
                  })}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void act(i.invitationId, props.onResend, 'staff.invites.resent')}
                data-testid="staff-invite-resend"
              >
                <Send aria-hidden="true" />
                {t('staff.invites.resend')}
              </Button>
              {confirming === i.invitationId ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-omr text-omr"
                    onClick={() =>
                      void act(i.invitationId, props.onCancel, 'staff.invites.cancelled')
                    }
                  >
                    {t('staff.invites.cancelYes')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    {t('staff.revoke.no')}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-omr"
                  onClick={() => setConfirming(i.invitationId)}
                  data-testid="staff-invite-cancel"
                >
                  <X aria-hidden="true" />
                  {t('staff.invites.cancel')}
                </Button>
              )}
            </div>
            {message?.id === i.invitationId ? (
              <p
                role={message.ok ? 'status' : 'alert'}
                className={`text-xs ${message.ok ? 'text-pass' : 'text-destructive'}`}
              >
                {tDynamic(message.key)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoleChip(props: {
  member: StaffMember;
  role: StaffMember['roles'][number];
  onRevoke: (userId: string, role: StaffRole) => Promise<Outcome>;
}) {
  const { t, tDynamic } = useI18n();
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = props.role.instructorType
    ? `${t(`staff.role.${props.role.role}`)} · ${t(`staff.type.${props.role.instructorType}`)}`
    : t(`staff.role.${props.role.role}`);
  const revoke = async () => {
    const r = await props.onRevoke(props.member.userId, props.role.role);
    if (!r.ok) setError(staffErrorKey(r.error.code));
    setIsConfirming(false);
  };
  return (
    <span className="flex flex-col gap-1">
      <span className="inline-flex flex-wrap items-center gap-2 rounded-sm border border-primary/20 px-2 py-1 text-sm">
        {label}
        {isConfirming ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-omr text-omr"
              onClick={() => void revoke()}
            >
              {t('staff.revoke.yes')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => setIsConfirming(false)}
            >
              {t('staff.revoke.no')}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-omr"
            onClick={() => setIsConfirming(true)}
            data-testid="staff-revoke"
          >
            {t('staff.revoke.button')}
          </Button>
        )}
      </span>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {tDynamic(error)}
        </span>
      ) : null}
    </span>
  );
}

export function StaffAdmin(props: {
  staff: StaffMember[];
  invitations: StaffInvitation[];
  onInvite: (
    input: InviteInput,
  ) => Promise<Outcome<{ mode: 'assigned' | 'invited'; userId: string }>>;
  onResendInvite: (invitationId: string) => Promise<Outcome>;
  onCancelInvite: (invitationId: string) => Promise<Outcome>;
  onRevoke: (userId: string, role: StaffRole) => Promise<Outcome>;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-6" data-testid="staff-admin">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('staff.title')}</h1>
        <p className="text-ink/75">{t('staff.subtitle')}</p>
      </header>
      <AddStaff onInvite={props.onInvite} />
      <Invitations
        invitations={props.invitations}
        onResend={props.onResendInvite}
        onCancel={props.onCancelInvite}
      />
      <section className={card} aria-labelledby="staff-list">
        <h2 id="staff-list" className="flex items-center gap-2 text-xl font-bold">
          <Users aria-hidden="true" className="size-5 text-primary" />
          {t('staff.list.title')}
        </h2>
        <ul className="flex flex-col divide-y divide-primary/10">
          {props.staff.map((m) => {
            const TwoStep = m.hasTwoStep ? ShieldCheck : ShieldAlert;
            return (
              <li key={m.userId} className="flex flex-col gap-2 py-3" data-testid="staff-row">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    <Link
                      to="/admin/staff/$userId"
                      params={{ userId: m.userId }}
                      className="text-primary underline-offset-4 hover:underline"
                      data-testid="staff-open"
                    >
                      {m.name || m.email}
                    </Link>{' '}
                    · <span className="font-normal text-ink/80">{m.email}</span>
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-semibold ${m.hasTwoStep ? 'text-pass' : 'text-omr'}`}
                  >
                    <TwoStep aria-hidden="true" className="size-4" />
                    {m.hasTwoStep ? t('staff.twoStep.on') : t('staff.twoStep.off')}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {m.roles.map((r) => (
                    <RoleChip key={r.role} member={m} role={r} onRevoke={props.onRevoke} />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

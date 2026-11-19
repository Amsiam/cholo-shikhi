// US1.6 Staff and roles (Admin with two-step sign-in): who holds which staff role, finding an account
// by its email to give it a role (an Instructor is Employee or Contracted), and taking a role away
// behind a confirmation. Two-step status is shown, since staff must use it (US1.7).
import { useForm } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import { ShieldAlert, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type StaffRole = 'instructor' | 'admin' | 'finance';
export type StaffMember = {
  userId: string;
  name: string;
  email: string;
  hasTwoStep: boolean;
  roles: Array<{
    role: StaffRole;
    instructorType: 'employee' | 'contractor' | null;
    since: string;
  }>;
};
export type StaffCandidate = {
  userId: string;
  name: string;
  email: string;
  isEmailVerified: boolean;
  status: string;
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
  };
  return known[code] ?? 'staff.error.generic';
}

const card = 'flex flex-col gap-4 border border-primary/15 bg-background p-5';

function AddRole(props: {
  onFind: (email: string) => Promise<Outcome<StaffCandidate>>;
  onAssign: (input: {
    userId: string;
    role: StaffRole;
    instructorType?: 'employee' | 'contractor';
  }) => Promise<Outcome>;
}) {
  const { t, tDynamic } = useI18n();
  const [found, setFound] = useState<StaffCandidate | null>(null);
  const [role, setRole] = useState<StaffRole>('instructor');
  const [type, setType] = useState<'employee' | 'contractor'>('contractor');
  const [message, setMessage] = useState<{ ok: boolean; key: string } | null>(null);
  const form = useForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      setMessage(null);
      setFound(null);
      const r = await props.onFind(value.email.trim());
      if (r.ok && r.value) setFound(r.value);
      else
        setMessage({ ok: false, key: r.ok ? 'staff.error.notFound' : staffErrorKey(r.error.code) });
    },
  });
  const assign = async () => {
    if (!found) return;
    const r = await props.onAssign({
      userId: found.userId,
      role,
      ...(role === 'instructor' ? { instructorType: type } : {}),
    });
    setMessage(
      r.ok ? { ok: true, key: 'staff.assigned' } : { ok: false, key: staffErrorKey(r.error.code) },
    );
    if (r.ok) setFound(null);
  };
  return (
    <section className={card} aria-labelledby="staff-add" data-testid="staff-add">
      <h2 id="staff-add" className="flex items-center gap-2 text-xl font-bold">
        <UserPlus aria-hidden="true" className="size-5 text-primary" />
        {t('staff.add.title')}
      </h2>
      <form
        noValidate
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="email">
          {(field) => (
            <div className="grid min-w-64 flex-1 gap-1.5">
              <Label htmlFor="staff-email">{t('staff.add.email')}</Label>
              <Input
                id="staff-email"
                type="email"
                autoComplete="off"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>
        <Button type="submit" variant="outline">
          {t('staff.add.find')}
        </Button>
      </form>
      {found ? (
        <div
          className="flex flex-col gap-3 border-t border-primary/10 pt-3"
          data-testid="staff-candidate"
        >
          <p className="font-semibold">
            {found.name} · <span className="font-normal">{found.email}</span>
          </p>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-1 text-sm font-medium">{t('staff.add.role')}</legend>
            {(['instructor', 'admin', 'finance'] as const).map((r) => (
              <label
                key={r}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border px-3 text-sm ${role === r ? 'border-primary bg-primary/5 font-semibold' : 'border-primary/20'}`}
              >
                <input
                  type="radio"
                  name="staff-role"
                  className="size-4 accent-primary"
                  checked={role === r}
                  onChange={() => setRole(r)}
                />
                {t(`staff.role.${r}`)}
              </label>
            ))}
          </fieldset>
          {role === 'instructor' ? (
            <fieldset className="flex flex-wrap gap-2">
              <legend className="mb-1 text-sm font-medium">{t('staff.add.type')}</legend>
              {(['employee', 'contractor'] as const).map((k) => (
                <label
                  key={k}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border px-3 text-sm ${type === k ? 'border-primary bg-primary/5 font-semibold' : 'border-primary/20'}`}
                >
                  <input
                    type="radio"
                    name="staff-type"
                    className="size-4 accent-primary"
                    checked={type === k}
                    onChange={() => setType(k)}
                  />
                  {t(`staff.type.${k}`)}
                </label>
              ))}
            </fieldset>
          ) : null}
          <Button className="w-fit" onClick={() => void assign()} data-testid="staff-assign">
            {t('staff.add.assign')}
          </Button>
        </div>
      ) : null}
      {message ? (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={`text-sm ${message.ok ? '' : 'text-destructive'}`}
        >
          {tDynamic(message.key)}
        </p>
      ) : null}
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
  onFind: (email: string) => Promise<Outcome<StaffCandidate>>;
  onAssign: (input: {
    userId: string;
    role: StaffRole;
    instructorType?: 'employee' | 'contractor';
  }) => Promise<Outcome>;
  onRevoke: (userId: string, role: StaffRole) => Promise<Outcome>;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-6" data-testid="staff-admin">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('staff.title')}</h1>
        <p className="text-ink/75">{t('staff.subtitle')}</p>
      </header>
      <AddRole onFind={props.onFind} onAssign={props.onAssign} />
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
                      {m.name}
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

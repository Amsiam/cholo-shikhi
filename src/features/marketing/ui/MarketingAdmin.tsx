// A9 Marketing (US8.1, US8.2, US8.4), for Admins with two-step sign-in: campaigns (bilingual banner,
// landing path, segments, Asia/Dhaka dates), promo codes (basis points or a taka amount, scoped by
// segment, course, dates and uses; a code can be switched off) and bundles (two or more published
// courses of one segment at one price). Courses are given as course links or IDs, one per line.
import { useForm } from '@tanstack/react-form';
import { Megaphone, Package, Percent, Power } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '#src/lib/i18n/react.tsx';
import { type MoneyPoisha, parseTakaString } from '#src/lib/money.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MarketingOverview } from '../server/marketing.server.ts';

type Outcome = { ok: true } | { ok: false; error: { i18nKey?: string } };
export type SegmentOption = { segmentId: string; nameBn: string; nameEn: string };

const card = 'flex flex-col gap-4 border border-primary/15 bg-background p-5';
const textarea =
  'min-h-20 w-full rounded-sm border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm';

/** Course IDs found in pasted course links or IDs, one per line. */
export function courseIdsIn(text: string): string[] {
  const ids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}

function Message(props: { message: { ok: boolean; key: string } | null }) {
  const { tDynamic } = useI18n();
  if (!props.message) return null;
  return (
    <p
      role={props.message.ok ? 'status' : 'alert'}
      className={`text-sm ${props.message.ok ? '' : 'text-destructive'}`}
    >
      {tDynamic(props.message.key)}
    </p>
  );
}

function TextField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'date' | 'number';
  long?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.long ? (
        <textarea
          id={props.id}
          className={textarea}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
      ) : (
        <Input
          id={props.id}
          type={props.type ?? 'text'}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function SegmentPicker(props: {
  idPrefix: string;
  segments: readonly SegmentOption[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  single?: boolean;
}) {
  const { t, locale } = useI18n();
  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 text-sm font-medium">{t('marketing.field.segments')}</legend>
      {props.segments.map((s) => (
        <label key={s.segmentId} className="flex min-h-10 items-center gap-2 text-sm">
          <input
            type={props.single ? 'radio' : 'checkbox'}
            name={`${props.idPrefix}-segment`}
            className="size-4 accent-primary"
            checked={props.selected.includes(s.segmentId)}
            onChange={(e) =>
              props.onChange(
                props.single
                  ? [s.segmentId]
                  : e.target.checked
                    ? [...props.selected, s.segmentId]
                    : props.selected.filter((x) => x !== s.segmentId),
              )
            }
          />
          {locale === 'bn' ? s.nameBn : s.nameEn}
        </label>
      ))}
    </fieldset>
  );
}

function CampaignForm(props: {
  segments: readonly SegmentOption[];
  onSave: (v: unknown) => Promise<Outcome>;
}) {
  const { t } = useI18n();
  const [message, setMessage] = useState<{ ok: boolean; key: string } | null>(null);
  const form = useForm({
    defaultValues: {
      nameBn: '',
      nameEn: '',
      bannerBn: '',
      bannerEn: '',
      landingPath: '/catalog',
      segmentIds: [] as string[],
      startsOn: '',
      endsOn: '',
    },
    onSubmit: async ({ value }) => {
      const r = await props.onSave(value);
      setMessage(
        r.ok
          ? { ok: true, key: 'marketing.saved' }
          : { ok: false, key: r.error.i18nKey ?? 'errors.marketing.invalid' },
      );
      if (r.ok) form.reset();
    },
  });
  const text = (
    name: 'nameBn' | 'nameEn' | 'bannerBn' | 'bannerEn' | 'landingPath' | 'startsOn' | 'endsOn',
    type: 'text' | 'date' = 'text',
  ) => (
    <form.Field name={name}>
      {(f) => (
        <TextField
          id={`mc-${name}`}
          label={t(`marketing.campaign.${name}`)}
          type={type}
          value={f.state.value}
          onChange={f.handleChange}
        />
      )}
    </form.Field>
  );
  return (
    <section className={card} aria-labelledby="mk-campaign" data-testid="marketing-campaign">
      <h2 id="mk-campaign" className="flex items-center gap-2 text-xl font-bold">
        <Megaphone aria-hidden="true" className="size-5 text-primary" />
        {t('marketing.campaign.title')}
      </h2>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {text('nameBn')}
          {text('nameEn')}
          {text('bannerBn')}
          {text('bannerEn')}
          {text('startsOn', 'date')}
          {text('endsOn', 'date')}
        </div>
        {text('landingPath')}
        <form.Field name="segmentIds">
          {(f) => (
            <SegmentPicker
              idPrefix="mc"
              segments={props.segments}
              selected={f.state.value}
              onChange={f.handleChange}
            />
          )}
        </form.Field>
        <Button type="submit" className="w-fit" data-testid="campaign-submit">
          {t('marketing.campaign.submit')}
        </Button>
      </form>
      <Message message={message} />
    </section>
  );
}

function PromoForm(props: {
  segments: readonly SegmentOption[];
  onSave: (v: unknown) => Promise<Outcome>;
}) {
  const { t } = useI18n();
  const [message, setMessage] = useState<{ ok: boolean; key: string } | null>(null);
  const form = useForm({
    defaultValues: {
      code: '',
      kind: 'percent' as 'percent' | 'fixed',
      percentBps: '',
      fixedTaka: '',
      courses: '',
      segmentIds: [] as string[],
      startsOn: '',
      endsOn: '',
      maxUses: '',
    },
    onSubmit: async ({ value }) => {
      let fixedPoisha: number | undefined;
      if (value.kind === 'fixed') {
        const parsed = parseTakaString(value.fixedTaka.trim());
        if (!parsed.ok) {
          setMessage({ ok: false, key: 'errors.promo.fixed' });
          return;
        }
        fixedPoisha = parsed.value;
      }
      const r = await props.onSave({
        code: value.code,
        kind: value.kind,
        ...(value.kind === 'percent' ? { percentBps: Number(value.percentBps) } : { fixedPoisha }),
        courseIds: courseIdsIn(value.courses),
        segmentIds: value.segmentIds,
        startsOn: value.startsOn,
        endsOn: value.endsOn,
        maxUses: Number(value.maxUses),
      });
      setMessage(
        r.ok
          ? { ok: true, key: 'marketing.saved' }
          : { ok: false, key: r.error.i18nKey ?? 'errors.marketing.invalid' },
      );
      if (r.ok) form.reset();
    },
  });
  return (
    <section className={card} aria-labelledby="mk-promo" data-testid="marketing-promo">
      <h2 id="mk-promo" className="flex items-center gap-2 text-xl font-bold">
        <Percent aria-hidden="true" className="size-5 text-primary" />
        {t('marketing.promo.title')}
      </h2>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="code">
            {(f) => (
              <TextField
                id="mp-code"
                label={t('marketing.promo.code')}
                value={f.state.value}
                onChange={f.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="kind">
            {(f) => (
              <fieldset className="grid gap-1">
                <legend className="mb-1 text-sm font-medium">{t('marketing.promo.kind')}</legend>
                {(['percent', 'fixed'] as const).map((k) => (
                  <label key={k} className="flex min-h-10 items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="mp-kind"
                      className="size-4 accent-primary"
                      checked={f.state.value === k}
                      onChange={() => f.handleChange(k)}
                    />
                    {t(`marketing.promo.kind.${k}`)}
                  </label>
                ))}
              </fieldset>
            )}
          </form.Field>
          <form.Subscribe selector={(s) => s.values.kind}>
            {(kind) =>
              kind === 'percent' ? (
                <form.Field name="percentBps">
                  {(f) => (
                    <TextField
                      id="mp-bps"
                      type="number"
                      label={t('marketing.promo.bps')}
                      value={f.state.value}
                      onChange={f.handleChange}
                    />
                  )}
                </form.Field>
              ) : (
                <form.Field name="fixedTaka">
                  {(f) => (
                    <TextField
                      id="mp-fixed"
                      label={t('marketing.promo.fixed')}
                      value={f.state.value}
                      onChange={f.handleChange}
                    />
                  )}
                </form.Field>
              )
            }
          </form.Subscribe>
          <form.Field name="maxUses">
            {(f) => (
              <TextField
                id="mp-uses"
                type="number"
                label={t('marketing.promo.maxUses')}
                value={f.state.value}
                onChange={f.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="startsOn">
            {(f) => (
              <TextField
                id="mp-start"
                type="date"
                label={t('marketing.campaign.startsOn')}
                value={f.state.value}
                onChange={f.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="endsOn">
            {(f) => (
              <TextField
                id="mp-end"
                type="date"
                label={t('marketing.campaign.endsOn')}
                value={f.state.value}
                onChange={f.handleChange}
              />
            )}
          </form.Field>
        </div>
        <form.Field name="segmentIds">
          {(f) => (
            <SegmentPicker
              idPrefix="mp"
              segments={props.segments}
              selected={f.state.value}
              onChange={f.handleChange}
            />
          )}
        </form.Field>
        <form.Field name="courses">
          {(f) => (
            <TextField
              id="mp-courses"
              long
              label={t('marketing.promo.courses')}
              value={f.state.value}
              onChange={f.handleChange}
            />
          )}
        </form.Field>
        <Button type="submit" className="w-fit" data-testid="promo-submit">
          {t('marketing.promo.submit')}
        </Button>
      </form>
      <Message message={message} />
    </section>
  );
}

function BundleForm(props: {
  segments: readonly SegmentOption[];
  onSave: (v: unknown) => Promise<Outcome>;
}) {
  const { t } = useI18n();
  const [message, setMessage] = useState<{ ok: boolean; key: string } | null>(null);
  const form = useForm({
    defaultValues: {
      nameBn: '',
      nameEn: '',
      segmentIds: [] as string[],
      priceTaka: '',
      courses: '',
    },
    onSubmit: async ({ value }) => {
      const price = parseTakaString(value.priceTaka.trim());
      if (!price.ok) {
        setMessage({ ok: false, key: 'errors.marketing.price' });
        return;
      }
      const r = await props.onSave({
        nameBn: value.nameBn,
        nameEn: value.nameEn,
        segmentId: value.segmentIds[0] ?? '',
        pricePoisha: price.value,
        courseIds: courseIdsIn(value.courses),
      });
      setMessage(
        r.ok
          ? { ok: true, key: 'marketing.saved' }
          : { ok: false, key: r.error.i18nKey ?? 'errors.marketing.invalid' },
      );
      if (r.ok) form.reset();
    },
  });
  return (
    <section className={card} aria-labelledby="mk-bundle" data-testid="marketing-bundle">
      <h2 id="mk-bundle" className="flex items-center gap-2 text-xl font-bold">
        <Package aria-hidden="true" className="size-5 text-primary" />
        {t('marketing.bundle.title')}
      </h2>
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="nameBn">
            {(f) => (
              <TextField
                id="mb-nameBn"
                label={t('marketing.campaign.nameBn')}
                value={f.state.value}
                onChange={f.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="nameEn">
            {(f) => (
              <TextField
                id="mb-nameEn"
                label={t('marketing.campaign.nameEn')}
                value={f.state.value}
                onChange={f.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="priceTaka">
            {(f) => (
              <TextField
                id="mb-price"
                label={t('marketing.bundle.price')}
                value={f.state.value}
                onChange={f.handleChange}
              />
            )}
          </form.Field>
        </div>
        <form.Field name="segmentIds">
          {(f) => (
            <SegmentPicker
              idPrefix="mb"
              single
              segments={props.segments}
              selected={f.state.value}
              onChange={f.handleChange}
            />
          )}
        </form.Field>
        <form.Field name="courses">
          {(f) => (
            <TextField
              id="mb-courses"
              long
              label={t('marketing.bundle.courses')}
              value={f.state.value}
              onChange={f.handleChange}
            />
          )}
        </form.Field>
        <Button type="submit" className="w-fit" data-testid="bundle-submit">
          {t('marketing.bundle.submit')}
        </Button>
      </form>
      <Message message={message} />
    </section>
  );
}

export function MarketingAdmin(props: {
  overview: MarketingOverview;
  segments: readonly SegmentOption[];
  onSaveCampaign: (v: unknown) => Promise<Outcome>;
  onSavePromo: (v: unknown) => Promise<Outcome>;
  onSetPromoActive: (promoCodeId: string, isActive: boolean) => Promise<Outcome>;
  onSaveBundle: (v: unknown) => Promise<Outcome>;
}) {
  const { t, locale, formatMoney, formatInteger } = useI18n();
  const segmentName = (id: string) => {
    const s = props.segments.find((x) => x.segmentId === id);
    return s ? (locale === 'bn' ? s.nameBn : s.nameEn) : id.slice(0, 8);
  };
  const { campaigns, promos, bundles } = props.overview;
  return (
    <div className="flex flex-col gap-6" data-testid="marketing-admin">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
          <Megaphone aria-hidden="true" className="size-7 text-primary" />
          {t('marketing.title')}
        </h1>
        <p className="text-ink/75">{t('marketing.subtitle')}</p>
      </header>

      <CampaignForm segments={props.segments} onSave={props.onSaveCampaign} />
      <section className={card} aria-labelledby="mk-campaigns">
        <h2 id="mk-campaigns" className="text-lg font-bold">
          {t('marketing.campaign.list')}
        </h2>
        {campaigns.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('marketing.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-primary/10" data-testid="campaign-list">
            {campaigns.map((c) => (
              <li key={c.campaignId} className="flex flex-col gap-1 py-3 text-sm">
                <span className="font-semibold">{locale === 'bn' ? c.nameBn : c.nameEn}</span>
                <span>{locale === 'bn' ? c.bannerBn : c.bannerEn}</span>
                <span className="text-ink-muted">
                  {t('marketing.dates', { from: c.startsOn, to: c.endsOn })} ·{' '}
                  {c.segmentIds.map(segmentName).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PromoForm segments={props.segments} onSave={props.onSavePromo} />
      <section className={card} aria-labelledby="mk-promos">
        <h2 id="mk-promos" className="text-lg font-bold">
          {t('marketing.promo.list')}
        </h2>
        {promos.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('marketing.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-primary/10" data-testid="promo-list">
            {promos.map((p) => (
              <li
                key={p.promoCodeId}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <span className="flex flex-col gap-1">
                  <span className="font-mono font-semibold">{p.code}</span>
                  <span>
                    {p.kind === 'percent'
                      ? t('marketing.promo.percentOff', { bps: formatInteger(p.percentBps ?? 0) })
                      : t('marketing.promo.amountOff', {
                          amount: formatMoney((p.fixedPoisha ?? 0) as MoneyPoisha),
                        })}
                    {' · '}
                    {t('marketing.promo.uses', {
                      used: formatInteger(p.usedCount),
                      max: formatInteger(p.maxUses),
                    })}
                  </span>
                  <span className="text-ink-muted">
                    {t('marketing.dates', { from: p.startsOn, to: p.endsOn })}
                    {p.segmentIds.length > 0
                      ? ` · ${p.segmentIds.map(segmentName).join(', ')}`
                      : ''}
                    {p.courseIds.length > 0
                      ? ` · ${t('marketing.promo.courseCount', { n: formatInteger(p.courseIds.length) })}`
                      : ''}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void props.onSetPromoActive(p.promoCodeId, !p.isActive)}
                  data-testid="promo-toggle"
                >
                  <Power aria-hidden="true" className="size-4" />
                  {p.isActive ? t('marketing.promo.deactivate') : t('marketing.promo.activate')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BundleForm segments={props.segments} onSave={props.onSaveBundle} />
      <section className={card} aria-labelledby="mk-bundles">
        <h2 id="mk-bundles" className="text-lg font-bold">
          {t('marketing.bundle.list')}
        </h2>
        {bundles.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('marketing.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-primary/10" data-testid="bundle-list">
            {bundles.map((b) => (
              <li key={b.bundleId} className="flex flex-col gap-1 py-3 text-sm">
                <span className="font-semibold">{locale === 'bn' ? b.nameBn : b.nameEn}</span>
                <span>
                  {formatMoney(b.pricePoisha as MoneyPoisha)} ·{' '}
                  {t('marketing.promo.courseCount', { n: formatInteger(b.courseIds.length) })} ·{' '}
                  {segmentName(b.segmentId)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

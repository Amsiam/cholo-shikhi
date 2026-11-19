// Payment disputes and evidence packs (US9.3, US9.4; screen A11), Finance or Admin with two-step
// sign-in only (Students and Instructors are refused).
// - Record a dispute against a succeeded payment (one per payment) with the gateway's case
//   reference and a reason. Its evidence pack is generated in the same transaction from the
//   payment, its enrolment and the Student's activity in the course (lesson completions, video
//   lessons, quiz scores), timestamped and locked: the database refuses any edit (AC9.3.2).
// - Export a pack through the shared renderer (US11.11). CSV works now; PDF answers "unavailable"
//   until the renderer's PDF engine is installed (the screen offers print-to-PDF meanwhile).
import { createHash } from 'node:crypto';
import { courseTitlesOf, getPublishedCourse } from '#src/features/catalog/index.ts';
import { paymentEvidence } from '#src/features/commerce/index.ts';
import type { Actor } from '#src/features/identity-access/index.ts';
import { courseActivityOf } from '#src/features/learning/index.ts';
import {
  createAudit,
  createFileObjectStore,
  createRenderer,
  defineCsvTemplate,
  type ObjectStore,
} from '#src/features/platform/index.ts';
import { type AppError, appError } from '#src/lib/errors.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import { systemClock } from '#src/lib/time.ts';
import { getDb, unwrapTx, withTransaction } from '#src/server/db.ts';
import { createDisputeRepository, type DisputeRow } from '../data/dispute.repository.ts';
import {
  buildEvidencePack,
  type EvidencePack,
  type PackLesson,
  packRows,
} from '../domain/dispute.ts';
import { DisputeRefInput, ExportDisputeInput, RecordDisputeInput } from './dispute.schema.ts';

const repo = createDisputeRepository();
const audit = createAudit({ clock: systemClock });
type DisputeError = AppError<
  'NOT_FOUND' | 'INVALID_STATE' | 'FORBIDDEN' | 'CONFLICT' | 'FEATURE_DISABLED'
>;
const withKey = <C extends DisputeError['code']>(code: C, i18nKey: `errors.${string}`) => ({
  ...appError(code),
  i18nKey,
});
const canManage = (actor: Actor) =>
  (actor.roles.includes('finance') || actor.roles.includes('admin')) && actor.hasStepUp;

let now: () => Date = () => new Date();
/** Tests fix the clock that stamps the pack (the 60-second budget is a nightly check). */
export function setDisputeClockForTests(clock: () => Date) {
  now = clock;
}
let store: ObjectStore = createFileObjectStore();
/** Tests keep exported packs in a temporary folder. */
export function setDisputeStoreForTests(next: ObjectStore) {
  store = next;
}

const PACK_TEMPLATE = defineCsvTemplate({
  name: 'trustops.disputePack',
  owner: 'trustops',
  columns: [
    { key: 'section', header: { en: 'Section', bn: 'অংশ' } },
    { key: 'item', header: { en: 'Item', bn: 'বিষয়' } },
    { key: 'detail', header: { en: 'Detail', bn: 'বিবরণ' } },
    { key: 'at', header: { en: 'Time (UTC)', bn: 'সময় (UTC)' } },
  ],
});
/** Exported packs are kept as long as payment records (10 years). */
const RETAIN_YEARS = 10;

async function lessonsOf(courseId: string): Promise<PackLesson[]> {
  const course = await getPublishedCourse(courseId);
  if (!course.ok) return [];
  return course.value.outline.flatMap((s) =>
    s.lessons.map((l) => ({
      lessonId: l.lessonId,
      kind: l.kind,
      title: l.titleEn || l.titleBn || '',
    })),
  );
}

/** AC9.3.1: records the dispute and generates its locked evidence pack in one transaction. */
export async function recordDispute(
  actor: Actor,
  raw: RecordDisputeInput,
  correlationId: string,
): Promise<Result<{ disputeId: string; lockedAt: string }, DisputeError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.dispute.forbidden'));
  const input = RecordDisputeInput.parse(raw);
  const evidence = await paymentEvidence(input.paymentId);
  if (!evidence) return err(withKey('NOT_FOUND', 'errors.dispute.noPayment'));
  if (evidence.status !== 'succeeded')
    return err(withKey('INVALID_STATE', 'errors.dispute.notPaid'));
  const [activity, lessons, titles] = await Promise.all([
    courseActivityOf(evidence.userId, evidence.courseId),
    lessonsOf(evidence.courseId),
    courseTitlesOf([evidence.courseId]),
  ]);
  const t = titles[evidence.courseId];
  const pack = buildEvidencePack({
    payment: {
      paymentId: evidence.paymentId,
      amountPoisha: evidence.amountPoisha,
      status: evidence.status,
      gatewayRef: evidence.gatewayRef,
      createdAt: evidence.createdAt,
      settledAt: evidence.settledAt,
    },
    enrolment: evidence.enrolment,
    course: { courseId: evidence.courseId, title: t?.titleEn || t?.titleBn || '' },
    lessons,
    completions: activity.completions,
    quizAttempts: activity.quizAttempts,
  });
  const at = now();
  return withTransaction(getDb(), async (tx) => {
    const exec = unwrapTx(tx);
    if (await repo.disputeOfPayment(exec, input.paymentId))
      return err(withKey('CONFLICT', 'errors.dispute.duplicate'));
    const dispute = await repo.insertDispute(exec, {
      paymentId: input.paymentId,
      gatewayCaseRef: input.gatewayCaseRef,
      reason: input.reason,
      disputedPoisha: evidence.amountPoisha,
      recordedBy: actor.userId,
      recordedAt: at,
    });
    await repo.insertPack(exec, {
      disputeId: dispute.disputeId,
      content: pack,
      sha256: createHash('sha256').update(JSON.stringify(pack)).digest('hex'),
      lockedAt: at,
    });
    await audit.record(tx, {
      actorId: actor.userId,
      action: 'trustops.dispute.recorded',
      subjectType: 'payment_dispute',
      subjectId: dispute.disputeId,
      after: { paymentId: input.paymentId, hasActivity: pack.summary.hasActivity },
      reason: input.reason,
      correlationId,
    });
    return ok({ disputeId: dispute.disputeId, lockedAt: at.toISOString() });
  });
}

export type DisputeView = Omit<DisputeRow, 'recordedAt'> & {
  recordedAt: string;
  lockedAt: string | null;
};

export async function listDisputes(actor: Actor): Promise<Result<DisputeView[], DisputeError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.dispute.forbidden'));
  const rows = await repo.list(getDb(), 200);
  return ok(
    rows.map(({ dispute, lockedAt }) => ({
      ...dispute,
      recordedAt: dispute.recordedAt.toISOString(),
      lockedAt: lockedAt?.toISOString() ?? null,
    })),
  );
}

export type DisputePackView = {
  disputeId: string;
  gatewayCaseRef: string;
  lockedAt: string;
  sha256: string;
  pack: EvidencePack;
};

async function packView(disputeId: string): Promise<DisputePackView | null> {
  const found = await repo.packOf(getDb(), disputeId);
  if (!found) return null;
  return {
    disputeId,
    gatewayCaseRef: found.dispute.gatewayCaseRef,
    lockedAt: found.pack.lockedAt.toISOString(),
    sha256: found.pack.sha256,
    pack: found.pack.content as EvidencePack,
  };
}

/** AC9.4.2: Finance or Admin only. */
export async function getDisputePack(
  actor: Actor,
  raw: DisputeRefInput,
): Promise<Result<DisputePackView, DisputeError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.dispute.forbidden'));
  const view = await packView(DisputeRefInput.parse(raw).disputeId);
  return view ? ok(view) : err(withKey('NOT_FOUND', 'errors.dispute.noPack'));
}

/** US9.4: the pack rendered by the shared renderer, with its lock timestamp. */
export async function exportDisputePack(
  actor: Actor,
  raw: ExportDisputeInput,
  correlationId: string,
): Promise<Result<{ fileName: string; contentType: string; content: string }, DisputeError>> {
  if (!canManage(actor)) return err(withKey('FORBIDDEN', 'errors.dispute.forbidden'));
  const input = ExportDisputeInput.parse(raw);
  const view = await packView(input.disputeId);
  if (!view) return err(withKey('NOT_FOUND', 'errors.dispute.noPack'));
  const retain = new Date(now());
  retain.setUTCFullYear(retain.getUTCFullYear() + RETAIN_YEARS);
  const rendered = await createRenderer({
    db: getDb(),
    clock: systemClock,
    store,
    templates: [PACK_TEMPLATE],
  }).render(
    {
      template: PACK_TEMPLATE.name,
      locale: input.locale,
      format: input.format,
      data: packRows(view.pack, view.lockedAt),
      retainUntil: retain.toISOString(),
    },
    correlationId,
  );
  if (!rendered.ok)
    return err(
      rendered.error.code === 'RENDERER_UNAVAILABLE'
        ? withKey('FEATURE_DISABLED', 'errors.dispute.pdfUnavailable')
        : withKey('INVALID_STATE', 'errors.dispute.export'),
    );
  const bytes = await store.get(rendered.value.objectKey);
  return ok({
    fileName: `dispute-${input.disputeId}.${input.format}`,
    contentType: input.format === 'pdf' ? 'application/pdf' : 'text/csv',
    content: bytes ? bytes.toString(input.format === 'pdf' ? 'base64' : 'utf8') : '',
  });
}

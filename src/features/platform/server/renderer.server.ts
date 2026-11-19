// renderer.render (contract 3, US11.11). CSV is rendered in-house; PDF goes through a port whose
// headless-Chromium adapter is not installed in this Bolt, so it answers RENDERER_UNAVAILABLE.
// A file is stored and recorded only after a fully successful render (BR14.3).
import { randomUUID } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { type AppError, appError } from '#src/lib/errors.ts';
import { UtcInstant } from '#src/lib/ids.ts';
import { getLogger } from '#src/lib/logger.ts';
import { err, ok, type Result } from '#src/lib/result.ts';
import type { Clock } from '#src/lib/time.ts';
import type { Database } from '#src/server/db.ts';
import { renderedDocument } from '#src/server/schema/index.ts';
import { toCsv } from '../domain/csv.ts';
import type { ObjectStore } from './object-store.server.ts';

export const RenderRequest = z.object({
  template: z.string().min(1).max(100),
  locale: z.enum(['bn', 'en']),
  format: z.enum(['pdf', 'csv']),
  data: z.unknown(),
  retainUntil: UtcInstant,
});
export type RenderRequest = z.infer<typeof RenderRequest>;

/** Each template carries its column headers in both languages, so a template can never miss one. */
export type CsvTemplate = {
  name: string;
  owner: string;
  columns: ReadonlyArray<{ key: string; header: { bn: string; en: string } }>;
};

export function defineCsvTemplate(template: CsvTemplate): CsvTemplate {
  return template;
}

export type PdfEngine = { render(html: string): Promise<Buffer> };

export function createRenderer(deps: {
  db: Database;
  clock: Clock;
  store: ObjectStore;
  templates: readonly CsvTemplate[];
  pdfEngine?: PdfEngine;
}) {
  const templates = new Map(deps.templates.map((t) => [t.name, t]));
  const log = getLogger().child({ component: 'renderer' });

  function templateError(correlationId: string, reason: string): Result<never, AppError> {
    // BR14.3 / AC11.11.2: typed error, logged with the correlation ID, nothing stored.
    log.warn({ correlationId, code: 'RENDER_TEMPLATE_ERROR', reason }, 'render refused');
    return err(appError('VALIDATION_FAILED', { details: { reason } }));
  }

  function tableOf(
    template: CsvTemplate,
    locale: 'bn' | 'en',
    data: unknown,
    correlationId: string,
  ): Result<{ header: string[]; rows: string[][] }, AppError> {
    const keys = template.columns.map((c) => c.key);
    const Row = z.object(
      Object.fromEntries(keys.map((k) => [k, z.union([z.string(), z.number(), z.boolean()])])),
    );
    const rows = z.array(Row).safeParse(data);
    if (!rows.success) return templateError(correlationId, 'data_does_not_match_template');
    return ok({
      header: template.columns.map((c) => c.header[locale]),
      rows: rows.data.map((row) => keys.map((k) => String(row[k]))),
    });
  }

  const escapeHtml = (text: string) =>
    text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');

  /** HTML for the PDF engine; the engine embeds the Bangla fonts (BR14.1). */
  function toHtml(locale: 'bn' | 'en', table: { header: string[]; rows: string[][] }): string {
    const cells = (tag: string, row: string[]) =>
      row.map((c) => `<${tag}>${escapeHtml(c)}</${tag}>`).join('');
    const body = table.rows.map((r) => `<tr>${cells('td', r)}</tr>`).join('');
    return `<!doctype html><html lang="${locale}"><meta charset="utf-8"><table><thead><tr>${cells('th', table.header)}</tr></thead><tbody>${body}</tbody></table></html>`;
  }

  async function render(
    raw: RenderRequest,
    correlationId: string,
  ): Promise<
    Result<{ objectKey: string }, AppError<'VALIDATION_FAILED' | 'RENDERER_UNAVAILABLE'>>
  > {
    const parsed = RenderRequest.safeParse(raw);
    if (!parsed.success)
      return templateError(correlationId, 'invalid_request') as Result<
        never,
        AppError<'VALIDATION_FAILED'>
      >;
    const request = parsed.data;
    const template = templates.get(request.template);
    if (!template)
      return templateError(correlationId, 'unknown_template') as Result<
        never,
        AppError<'VALIDATION_FAILED'>
      >;
    if (new Date(request.retainUntil).getTime() <= new Date(deps.clock.now()).getTime()) {
      return templateError(correlationId, 'retain_until_in_past') as Result<
        never,
        AppError<'VALIDATION_FAILED'>
      >;
    }
    if (request.format === 'pdf' && !deps.pdfEngine) {
      return err(appError('RENDERER_UNAVAILABLE', { namespace: 'platform' }));
    }
    const table = tableOf(template, request.locale, request.data, correlationId);
    if (!table.ok) return table as Result<never, AppError<'VALIDATION_FAILED'>>;
    const body =
      request.format === 'pdf' && deps.pdfEngine
        ? await deps.pdfEngine.render(toHtml(request.locale, table.value))
        : toCsv(table.value.header, table.value.rows);
    const objectKey = `rendered/${template.owner}/${randomUUID()}.${request.format}`;
    await deps.store.put(
      objectKey,
      body,
      request.format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8',
    );
    try {
      await deps.db.insert(renderedDocument).values({
        objectKey,
        template: template.name,
        format: request.format,
        locale: request.locale,
        requestingFeature: template.owner,
        correlationId,
        createdAt: new Date(deps.clock.now()),
        retainUntil: new Date(request.retainUntil),
      });
    } catch (error) {
      await deps.store.delete(objectKey);
      throw error;
    }
    return ok({ objectKey });
  }

  /** BR14.4: deletes files whose retainUntil has passed. */
  async function purgeExpired(): Promise<number> {
    const now = new Date(deps.clock.now());
    const expired = await deps.db
      .select()
      .from(renderedDocument)
      .where(lt(renderedDocument.retainUntil, now));
    for (const doc of expired) {
      await deps.store.delete(doc.objectKey);
      await deps.db
        .delete(renderedDocument)
        .where(and(eq(renderedDocument.documentId, doc.documentId)));
    }
    return expired.length;
  }

  return { render, purgeExpired };
}

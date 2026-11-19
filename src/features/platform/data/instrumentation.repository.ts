// Writes InstrumentationEvent rows: the Bangladesh-hosted central log for product events (UC21).
import type { Database } from '#src/server/db.ts';
import { instrumentationEvent } from '#src/server/schema/index.ts';
import type { InstrumentationRecord, InstrumentationSink } from '../domain/instrumentation.ts';

export function createInstrumentationRepository(db: Database): InstrumentationSink {
  return {
    async write(record: InstrumentationRecord) {
      await db.insert(instrumentationEvent).values({
        eventName: record.eventName,
        featureArea: record.featureArea,
        correlationId: record.correlationId,
        occurredAt: new Date(record.occurredAt),
        properties: record.properties ?? null,
      });
    },
  };
}

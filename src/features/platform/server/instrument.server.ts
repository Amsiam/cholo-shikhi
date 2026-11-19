// Process-wide instrument.emit() (contract 3), writing to the Bangladesh-hosted InstrumentationEvent table.
import { getLogger } from '#src/lib/logger.ts';
import { metrics } from '#src/lib/metrics.ts';
import { systemClock } from '#src/lib/time.ts';
import { getDb } from '#src/server/db.ts';
import { createInstrumentationRepository } from '../data/instrumentation.repository.ts';
import { createInstrument, type Instrument } from '../domain/instrumentation.ts';

let shared: Instrument | undefined;

export function getInstrument(): Instrument {
  if (!shared) {
    const log = getLogger().child({ component: 'instrumentation' });
    shared = createInstrument({
      sink: createInstrumentationRepository(getDb()),
      metrics,
      now: systemClock.now,
      // BR13.4: a failure to emit never fails the business operation; it is logged and counted.
      onError: (eventName, error) =>
        log.warn({ err: error, eventName, code: 'INSTRUMENTATION_EMIT_FAILED' }, 'emit failed'),
    });
  }
  return shared;
}

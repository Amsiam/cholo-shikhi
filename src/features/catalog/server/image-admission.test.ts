// [LT] Step 44: SC-204 admission slots (2 processing + 10 waiting per instance).
import { describe, expect, it } from 'vitest';
import { createImageAdmission } from './image-admission.ts';
import {
  IMAGE_MAX_BYTES,
  IMAGE_PROCESSING_SLOTS,
  IMAGE_ROUTE_BODY_LIMIT_BYTES,
  IMAGE_UPLOAD_BODY_LIMIT_BYTES,
  IMAGE_WAITING_SLOTS,
} from './limits.ts';

describe('createImageAdmission (SC-204)', () => {
  it('uses the design values: 2 processing, 10 waiting', () => {
    expect(IMAGE_PROCESSING_SLOTS).toBe(2);
    expect(IMAGE_WAITING_SLOTS).toBe(10);
  });

  it('admits up to the processing limit at once', async () => {
    const admission = createImageAdmission({ processing: 2, waiting: 0 });
    expect(await admission.enter()).toBeTypeOf('function');
    expect(await admission.enter()).toBeTypeOf('function');
    expect(admission.depth()).toEqual({ processing: 2, waiting: 0 });
  });

  it('refuses at once when every slot and every waiting place is taken', async () => {
    const admission = createImageAdmission({ processing: 1, waiting: 1 });
    await admission.enter();
    const queued = admission.enter();
    expect(admission.depth()).toEqual({ processing: 1, waiting: 1 });
    expect(await admission.enter()).toBeNull();
    expect(queued).toBeInstanceOf(Promise);
  });

  it('hands a released slot to the oldest waiter, in arrival order', async () => {
    const admission = createImageAdmission({ processing: 1, waiting: 2 });
    const first = (await admission.enter()) as () => void;
    const order: string[] = [];
    const a = admission.enter().then((release) => {
      order.push('a');
      return release;
    });
    const b = admission.enter().then((release) => {
      order.push('b');
      return release;
    });
    first();
    const releaseA = (await a) as () => void;
    expect(order).toEqual(['a']);
    releaseA();
    await b;
    expect(order).toEqual(['a', 'b']);
    expect(admission.depth()).toEqual({ processing: 1, waiting: 0 });
  });

  it('frees the slot when the last holder releases, and a double release is harmless', async () => {
    const admission = createImageAdmission({ processing: 1, waiting: 0 });
    const release = (await admission.enter()) as () => void;
    release();
    release();
    expect(admission.depth()).toEqual({ processing: 0, waiting: 0 });
    expect(await admission.enter()).toBeTypeOf('function');
    expect(await admission.enter()).toBeNull();
  });

  it('refuses a configuration without a processing slot', () => {
    expect(() => createImageAdmission({ processing: 0, waiting: 5 })).toThrow();
  });
});

describe('upload body limit (NFR6.212; Step 45, approved 2026-11-17)', () => {
  it('exempts the upload path with a 5 MB + 16 KB route limit and a 5 MB image cap', () => {
    expect(IMAGE_MAX_BYTES).toBe(5_242_880);
    expect(IMAGE_ROUTE_BODY_LIMIT_BYTES).toBe(5_259_264);
    expect(IMAGE_UPLOAD_BODY_LIMIT_BYTES).toBe(5_242_880);
  });
});

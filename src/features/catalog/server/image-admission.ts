// SC-204 admission for image processing: at most `processing` uploads decode at once on an instance,
// at most `waiting` more wait in arrival order, and anything beyond is refused at once (imageBusy).
// Framework-free; one instance per process. A released slot passes straight to the next waiter.

export type ReleaseSlot = () => void;

export type ImageAdmission = {
  /** A release function once a processing slot is held, or null when the waiting room is full. */
  enter(): Promise<ReleaseSlot | null>;
  /** Uploads holding a slot and uploads waiting for one (catalog_image_queue_depth). */
  depth(): { processing: number; waiting: number };
};

export function createImageAdmission(limits: {
  processing: number;
  waiting: number;
}): ImageAdmission {
  if (!(limits.processing >= 1 && limits.waiting >= 0)) {
    throw new Error('image admission needs at least one processing slot');
  }
  let processing = 0;
  const waiters: Array<(release: ReleaseSlot) => void> = [];

  function slot(): ReleaseSlot {
    let isReleased = false;
    return () => {
      if (isReleased) return;
      isReleased = true;
      const next = waiters.shift();
      if (next) next(slot());
      else processing -= 1;
    };
  }

  return {
    async enter() {
      if (processing < limits.processing) {
        processing += 1;
        return slot();
      }
      if (waiters.length >= limits.waiting) return null;
      return new Promise<ReleaseSlot>((resolve) => {
        waiters.push(resolve);
      });
    },
    depth: () => ({ processing, waiting: waiters.length }),
  };
}

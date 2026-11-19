// A9 marketing server functions (Admins with two-step sign-in, re-checked in the service), the S2
// campaign banners (any signed-in user) and the public bundle list for a Goal.
import { createServerFn } from '@tanstack/react-start';
import { authedFn, publicFn, roleFn, typedInput } from '#src/server/fn.ts';
import {
  GoalBundlesInput,
  NoInput,
  SaveBundleInput,
  SaveCampaignInput,
  SavePromoInput,
  SetPromoActiveInput,
} from './marketing.schema.ts';
import {
  goalBundles,
  marketingOverview,
  myCampaignBanners,
  saveBundle,
  saveCampaign,
  savePromo,
  setPromoActive,
} from './marketing.server.ts';

export const getMarketingOverview = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(roleFn('admin', NoInput, async ({ actor }) => marketingOverview(actor)));

export const createCampaign = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SaveCampaignInput>())
  .handler(
    roleFn('admin', SaveCampaignInput, async ({ actor, input, correlationId }) =>
      saveCampaign(actor, input, correlationId),
    ),
  );

export const createPromoCode = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SavePromoInput>())
  .handler(
    roleFn('admin', SavePromoInput, async ({ actor, input, correlationId }) =>
      savePromo(actor, input, correlationId),
    ),
  );

export const setPromoCodeActive = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SetPromoActiveInput>())
  .handler(
    roleFn('admin', SetPromoActiveInput, async ({ actor, input, correlationId }) =>
      setPromoActive(actor, input, correlationId),
    ),
  );

export const createBundle = createServerFn({ method: 'POST' })
  .validator(typedInput<typeof SaveBundleInput>())
  .handler(
    roleFn('admin', SaveBundleInput, async ({ actor, input, correlationId }) =>
      saveBundle(actor, input, correlationId),
    ),
  );

export const listMyCampaignBanners = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof NoInput>())
  .handler(authedFn(NoInput, async ({ actor }) => myCampaignBanners(actor)));

/** Explicitly public: the bundles on the catalog are shown to visitors too. */
export const listGoalBundles = createServerFn({ method: 'GET' })
  .validator(typedInput<typeof GoalBundlesInput>())
  .handler(publicFn(GoalBundlesInput, async ({ input }) => goalBundles(input)));

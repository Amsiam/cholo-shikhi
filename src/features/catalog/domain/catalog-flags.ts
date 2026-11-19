// Feature flags declared by U2 (functional-spec §8; RD-209). Platform evaluates an unknown flag as
// off (U1 BR8.2), so a flag nobody has saved yet is off: that is each flag's registered default.
// An Admin turns one on through the A10 flags screen; nothing in U2 creates a flag row.
export const CATALOG_FLAGS = {
  /** BR11.3: the Bundles tab on S3, until Marketing's bundle read ships with U3. */
  bundlesTab: 'catalog.bundlesTab',
  /** RD-209 / Step 44: cover and inline image uploads. Off until the human turns it on (INF §3.4). */
  imageUploads: 'catalog.imageUploads',
  /**
   * CR-5 fallback (Step 24): unpublish ships only once the `unpublished` product status is approved
   * for contract 5; until an Admin turns this on, unpublishCourse answers FEATURE_DISABLED.
   */
  unpublish: 'catalog.unpublish',
} as const;

export type CatalogFlagKey = (typeof CATALOG_FLAGS)[keyof typeof CATALOG_FLAGS];

/** The default state of every U2 flag. None of them may default to on. */
export const CATALOG_FLAG_DEFAULTS: Readonly<Record<CatalogFlagKey, 'off'>> = {
  'catalog.bundlesTab': 'off',
  'catalog.imageUploads': 'off',
  'catalog.unpublish': 'off',
};

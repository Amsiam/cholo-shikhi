// Catalog's start-up registrations with U1 (UC23; BR4.9; foundation CR-3). The reference validator
// `catalog.publishedCourse` is registered through U1's existing port, Platform's public
// `settings().registerReferenceValidator`, so no foundation file changes: the port takes
// check(value) -> boolean, and U1 turns a false answer into VALIDATION_FAILED on that field. The
// check receives the field value only (functional-spec assumption 17).
// A registration failure throws, so the Catalog instance never becomes ready without it (RD-208).

export const PUBLISHED_COURSE_VALIDATOR = 'catalog.publishedCourse';

export type ReferenceValidatorPort = {
  registerReferenceValidator(name: string, validator: (value: unknown) => Promise<boolean>): void;
};

/** Registers every Catalog reference validator once on the given settings port. */
export function registerCatalogWithPlatform(
  settings: ReferenceValidatorPort,
  catalog: { isPublishedCourse(value: unknown): Promise<boolean> },
): void {
  settings.registerReferenceValidator(PUBLISHED_COURSE_VALIDATOR, (value) =>
    catalog.isPublishedCourse(value),
  );
}

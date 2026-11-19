// Synthetic test data only (team.md Test data). Every value here is invented:
// no real person's name, email or phone number is used. Two locales: bn_BD and en.
// A seeded PRNG keeps runs reproducible; the seed is printed by the caller on failure.

export type FactoryLocale = 'bn_BD' | 'en';

const GIVEN_NAMES: Record<FactoryLocale, readonly string[]> = {
  bn_BD: ['অনিক', 'তানিয়া', 'রাফি', 'নুসরাত', 'সাকিব', 'মিথিলা', 'আরিফ', 'জান্নাত'],
  en: ['Avery', 'Jordan', 'Riley', 'Morgan', 'Casey', 'Quinn', 'Rowan', 'Skyler'],
};

const FAMILY_NAMES: Record<FactoryLocale, readonly string[]> = {
  bn_BD: ['রহমান', 'হোসেন', 'চৌধুরী', 'ইসলাম', 'আহমেদ', 'সরকার'],
  en: ['Testwell', 'Sampleton', 'Fakeworth', 'Mockridge', 'Stubbs', 'Placeholder'],
};

/** Mulberry32: tiny deterministic PRNG for reproducible synthetic data. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pick() called with an empty list');
  return item;
}

let sequence = 0;

export type SyntheticPerson = {
  displayName: string;
  email: string;
  password: string;
  locale: 'bn' | 'en';
};

/**
 * A synthetic person. Emails use the reserved `.test` TLD (RFC 2606) so they can
 * never reach a real mailbox.
 */
export function buildPerson(
  options: { locale?: FactoryLocale; seed?: number } = {},
): SyntheticPerson {
  const locale = options.locale ?? 'en';
  const rng = createRng(options.seed ?? Date.now() + sequence);
  sequence += 1;
  const given = pick(rng, GIVEN_NAMES[locale]);
  const family = pick(rng, FAMILY_NAMES[locale]);
  const tag = `${Date.now().toString(36)}${sequence.toString(36)}${Math.floor(rng() * 1e6).toString(36)}`;
  return {
    displayName: `${given} ${family}`,
    email: `learner.${tag}@example.test`,
    // 16+ characters: satisfies BR2.1 (12-128). Synthetic, never a real credential.
    password: `Synthetic-${tag}-Pw!`,
    locale: locale === 'bn_BD' ? 'bn' : 'en',
  };
}

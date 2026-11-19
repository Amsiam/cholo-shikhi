import { describe, expect, it } from 'vitest';
import { isLocale, resolveDeviceLocale } from './locale.ts';

describe('resolveDeviceLocale (BR6.2)', () => {
  it('uses the device-saved language first', () => {
    expect(resolveDeviceLocale('en-US', 'bn')).toBe('bn');
  });
  it('defaults to Bangla on a first visit', () => {
    expect(resolveDeviceLocale(null, null)).toBe('bn');
    expect(resolveDeviceLocale('fr-FR', undefined)).toBe('bn');
  });
  it('uses English when the browser prefers it over Bangla', () => {
    expect(resolveDeviceLocale('en-GB,en;q=0.9,bn;q=0.5', null)).toBe('en');
    expect(resolveDeviceLocale('bn-BD,en;q=0.8', null)).toBe('bn');
    expect(resolveDeviceLocale('fr;q=1,bn;q=0.3,en;q=0.7', null)).toBe('en');
  });
  it('ignores unknown stored values', () => {
    expect(isLocale('fr')).toBe(false);
    expect(resolveDeviceLocale('en', 'fr')).toBe('en');
  });
});

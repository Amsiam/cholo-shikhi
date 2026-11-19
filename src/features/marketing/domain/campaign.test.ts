// [UT] US8.1 campaign display rule and US8.4 bundle size.
import { describe, expect, it } from 'vitest';
import { dhakaToday, isBundleSize, isCampaignLive, isDateRange } from './campaign.ts';

const campaign = { segmentIds: ['bcs'], startsOn: '2027-02-01', endsOn: '2027-02-07' };

describe('campaigns', () => {
  it('AC8.1.1: shows to a BCS student on 3 Feb', () => {
    expect(isCampaignLive(campaign, 'bcs', '2027-02-03')).toBe(true);
    expect(isCampaignLive(campaign, 'bcs', '2027-02-07')).toBe(true);
  });
  it('AC8.1.2: not to an HSC student, a student with no segment, or anyone on 8 Feb', () => {
    expect(isCampaignLive(campaign, 'hsc', '2027-02-03')).toBe(false);
    expect(isCampaignLive(campaign, null, '2027-02-03')).toBe(false);
    expect(isCampaignLive(campaign, 'bcs', '2027-02-08')).toBe(false);
    expect(isCampaignLive(campaign, 'bcs', '2027-01-31')).toBe(false);
  });
  it('uses the Asia/Dhaka date: 7 Feb 18:30 UTC is already 8 Feb in Dhaka', () => {
    expect(dhakaToday('2027-02-07T17:59:59.000Z')).toBe('2027-02-07');
    expect(dhakaToday('2027-02-07T18:30:00.000Z')).toBe('2027-02-08');
  });
  it('AC8.1.3: an end date before the start date is refused; one day is fine', () => {
    expect(isDateRange('2027-02-07', '2027-02-01')).toBe(false);
    expect(isDateRange('2027-02-07', '2027-02-07')).toBe(true);
  });
});

describe('bundles', () => {
  it('AC8.4.2: fewer than two different courses is refused', () => {
    expect(isBundleSize(['a'])).toBe(false);
    expect(isBundleSize(['a', 'a'])).toBe(false);
    expect(isBundleSize(['a', 'b', 'c'])).toBe(true);
  });
});

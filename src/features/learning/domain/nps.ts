// Course NPS (FR7.9, US7.17): one 0–10 "would you recommend" answer per Student per course.
// Promoters score 9–10, detractors 0–6; NPS = % promoters − % detractors, a whole number from −100
// to 100. Fewer than 5 answers is "not enough responses" (null). Plain TypeScript.

export const NPS_MIN_RESPONSES = 5;

export type NpsSummary = {
  responses: number;
  promoters: number;
  passives: number;
  detractors: number;
  /** null with fewer than NPS_MIN_RESPONSES answers. */
  nps: number | null;
};

export function npsOf(scores: readonly number[]): NpsSummary {
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const responses = scores.length;
  return {
    responses,
    promoters,
    passives: responses - promoters - detractors,
    detractors,
    nps:
      responses < NPS_MIN_RESPONSES
        ? null
        : Math.round(((promoters - detractors) * 100) / responses),
  };
}

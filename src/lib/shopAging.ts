// FIFO aging allocation for shop receivables.
//
// Given a shop's active debits (opening + supplies + manual_supply + adj_increase)
// and active credits (recovery + manual_payment + adj_decrease) — both dated — we
// apply credits to debits oldest-first. Any remaining unpaid debit slices are
// bucketed by their age (in days) versus the reference date.

export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";

export interface DebitSlice { date: string; amount: number }
export interface CreditSlice { date: string; amount: number }

export interface AgingResult {
  buckets: Record<AgingBucket, number>;
  total: number;
  /** Weighted-average age of unpaid slices (in days). 0 when no outstanding. */
  avgAgeDays: number;
  /** Earliest unpaid slice date (yyyy-MM-dd) or null. */
  oldestUnpaidDate: string | null;
}

const daysBetween = (a: string, b: string): number => {
  const A = new Date(a + "T00:00:00Z").getTime();
  const B = new Date(b + "T00:00:00Z").getTime();
  return Math.max(0, Math.round((B - A) / 86_400_000));
};

const bucketFor = (age: number): AgingBucket =>
  age <= 30 ? "0-30" : age <= 60 ? "31-60" : age <= 90 ? "61-90" : "90+";

export function allocateAging(
  debits: DebitSlice[],
  credits: CreditSlice[],
  asOf: string,
): AgingResult {
  const result: AgingResult = {
    buckets: { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 },
    total: 0,
    avgAgeDays: 0,
    oldestUnpaidDate: null,
  };
  // Sort ascending — oldest debit first.
  const d = debits
    .filter(x => Number(x.amount) > 0)
    .map(x => ({ date: x.date, remaining: Number(x.amount) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  let creditPool = credits.reduce((a, c) => a + Number(c.amount || 0), 0);
  for (const slice of d) {
    if (creditPool <= 0) break;
    const take = Math.min(creditPool, slice.remaining);
    slice.remaining -= take;
    creditPool -= take;
  }
  let weightedAge = 0;
  for (const slice of d) {
    if (slice.remaining <= 0.0001) continue;
    const age = daysBetween(slice.date, asOf);
    result.buckets[bucketFor(age)] += slice.remaining;
    result.total += slice.remaining;
    weightedAge += slice.remaining * age;
    if (!result.oldestUnpaidDate || slice.date < result.oldestUnpaidDate) {
      result.oldestUnpaidDate = slice.date;
    }
  }
  if (result.total > 0) result.avgAgeDays = weightedAge / result.total;
  return result;
}

export function collectionRate(activeDebits: number, activeCredits: number): number {
  if (activeDebits <= 0) return 0;
  const rate = (activeCredits / activeDebits) * 100;
  if (rate < 0) return 0;
  if (rate > 100) return 100;
  return rate;
}
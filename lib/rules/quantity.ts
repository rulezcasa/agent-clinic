/** Units to dispense when Dr. Sage gives dose/frequency/days but no quantity. Deterministic. */

const WORDS: Record<string, number> = { once: 1, twice: 2, "three times": 3, "four times": 4 };

export function dosesPerDay(frequency: string): number {
  const f = frequency.toLowerCase();
  const everyHours = f.match(/every\s+(\d+)\s*(?:h|hours?)/);
  if (everyHours) return Math.max(1, Math.round(24 / Number(everyHours[1])));
  const times = f.match(/(\d+)\s*(?:x|times)/);
  if (times) return Number(times[1]);
  for (const [w, n] of Object.entries(WORDS).reverse()) if (f.includes(w)) return n;
  if (/\bbid\b/.test(f)) return 2;
  if (/\btid\b/.test(f)) return 3;
  if (/\bqid\b/.test(f)) return 4;
  return 1;
}

export function deriveQuantity(item: { frequency: string; days: number; quantity?: number | null }): number {
  if (item.quantity && Number.isInteger(item.quantity) && item.quantity > 0) return item.quantity;
  return Math.max(1, dosesPerDay(item.frequency) * Math.max(1, Math.round(item.days)));
}

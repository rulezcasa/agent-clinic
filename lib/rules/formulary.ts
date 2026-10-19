import type { Drug } from "@/lib/types";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Resolve a drug name as written (brand, generic, may include a strength) to a formulary entry. */
export function findDrug(formulary: Drug[], written: string): Drug | undefined {
  const w = norm(written);
  if (!w) return undefined;
  // exact match on name/generic first, then "starts with" (handles "Amoxicillin 500mg")
  return (
    formulary.find((d) => norm(d.name) === w || norm(d.generic) === w) ??
    formulary.find((d) => w.startsWith(norm(d.name)) || w.startsWith(norm(d.generic)))
  );
}

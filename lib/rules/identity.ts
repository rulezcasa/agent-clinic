/** Identity check at check-in — deterministic. Riley extracts name + DOB; code decides. */
import type { Patient } from "@/lib/types";

const normName = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

/** Accepts YYYY-MM-DD, MM/DD/YYYY, or M/D/YYYY. Returns YYYY-MM-DD or null. */
export function normalizeDob(input: string): string | null {
  const s = input.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

export function verifyIdentity(patient: Pick<Patient, "full_name" | "dob">, claimed: { full_name: string; dob: string }) {
  const nameOk = normName(patient.full_name) === normName(claimed.full_name);
  const dobOk = normalizeDob(claimed.dob) === patient.dob;
  return { verified: nameOk && dobOk, nameOk, dobOk };
}

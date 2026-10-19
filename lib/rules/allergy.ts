/**
 * SEVERE ALLERGY BLOCK — always code, never AI.
 *
 * Runs after RocketRide/Pax as a backstop, and again right before dispensing.
 * If a prescribed drug matches any allergy the patient has marked "severe"
 * (by name, generic, class, or listed cross-reactive allergen), the Rx is blocked.
 */
import type { Allergy, Drug, RxItem } from "@/lib/types";
import { drugSubstances, findDrug, normalizeName } from "./formulary";

export interface AllergyHit {
  drug: string;
  allergy: string;
  severity: Allergy["severity"];
}

export function findAllergyHits(allergies: Allergy[], items: RxItem[], formulary: Drug[]): AllergyHit[] {
  const hits: AllergyHit[] = [];
  for (const item of items) {
    const drug = findDrug(formulary, item.drug);
    // Unknown drugs are matched on the written name only.
    const substances = drug ? drugSubstances(drug) : [normalizeName(item.drug)];
    for (const a of allergies) {
      const s = normalizeName(a.substance);
      if (s && substances.some((x) => x === s || x.includes(s))) {
        hits.push({ drug: item.drug, allergy: a.substance, severity: a.severity });
      }
    }
  }
  return hits;
}

export function severeAllergyBlock(allergies: Allergy[], items: RxItem[], formulary: Drug[]) {
  const severe = findAllergyHits(allergies, items, formulary).filter((h) => h.severity === "severe");
  return { blocked: severe.length > 0, hits: severe };
}

import { describe, expect, it } from "vitest";
import fr from "../../src/lib/i18n/fr.json";

function flattenStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(flattenStrings);
}

describe("French i18n copy", () => {
  it("does not regress known unaccented French UI forms", () => {
    const copy = flattenStrings(fr).join("\n");

    expect(copy).not.toMatch(
      /\b(Generer|Reinitialisation|Reunion|deconnecter|Pret|ECOULE|MODELE|Echouees|Reussies|Evaluee|Mesuree|Metrique|Crediter|credites|generee|echec)\b/
    );
  });
});

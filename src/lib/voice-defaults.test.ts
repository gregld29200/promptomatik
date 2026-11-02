// Which voice each dialogue character starts on. Before this, Speaker 1 was
// always Clara and Speaker 2 always Léo, so a script opening on "Le serveur"
// had a woman play the waiter unless the teacher recast him.

import { describe, expect, it } from "vitest";
import { defaultDialogueVoices, guessCharacterGender } from "./voice-defaults";

describe("guessCharacterGender", () => {
  it.each([
    ["Le serveur", "masculine"],
    ["La cliente", "feminine"],
    ["Madame Laurent", "feminine"],
    ["M. Dupont", "masculine"],
    ["Mrs Clarke", "feminine"],
    ["Herr Weber", "masculine"],
    ["Señora López", "feminine"],
    ["Stéphanie", "feminine"],
    ["Jérémy", "masculine"],
    ["Waitress", "feminine"],
    ["Client", "masculine"],
  ] as const)("reads %s as %s", (label, gender) => {
    expect(guessCharacterGender(label)).toBe(gender);
  });

  it.each(["Stagiaire", "Camille", "Alex", "Locuteur 1", ""])("says nothing about %j", (label) => {
    expect(guessCharacterGender(label)).toBeNull();
  });
});

describe("defaultDialogueVoices", () => {
  it("casts a man first and a woman second the right way round", () => {
    expect(defaultDialogueVoices({ "Speaker 1": "Le serveur", "Speaker 2": "La cliente" }))
      .toEqual({ "Speaker 1": "Puck", "Speaker 2": "Kore" });
  });

  it("keeps Clara then Léo when the labels say nothing", () => {
    expect(defaultDialogueVoices({})).toEqual({ "Speaker 1": "Kore", "Speaker 2": "Puck" });
  });

  it("gives an unknown character the other gender, so the two sound apart", () => {
    expect(defaultDialogueVoices({ "Speaker 1": "Stagiaire", "Speaker 2": "Madame Laurent" }))
      .toEqual({ "Speaker 1": "Puck", "Speaker 2": "Kore" });
  });

  it("gives two women two different voices", () => {
    expect(defaultDialogueVoices({ "Speaker 1": "Sophie", "Speaker 2": "Anna" }))
      .toEqual({ "Speaker 1": "Kore", "Speaker 2": "Erinome" });
  });

  it("never changes a voice the teacher chose, and avoids reusing it", () => {
    expect(defaultDialogueVoices(
      { "Speaker 1": "Le serveur", "Speaker 2": "Le client" },
      { "Speaker 1": { name: "Puck", gender: "masculine" } }
    )).toEqual({ "Speaker 1": "Puck", "Speaker 2": "Iapetus" });
  });

  it("reads a chosen voice's gender, not its character's label", () => {
    expect(defaultDialogueVoices(
      { "Speaker 1": "Le serveur", "Speaker 2": "Stagiaire" },
      { "Speaker 1": { name: "Achernar", gender: "feminine" } }
    )).toEqual({ "Speaker 1": "Achernar", "Speaker 2": "Puck" });
  });
});

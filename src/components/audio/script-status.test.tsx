import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dialogueCast, lintAudioScript } from "@/lib/audio-script-rules";
import type { AudioMode } from "@/lib/api";
import { ScriptStatus } from "./script-status";

function render(script: string, mode: AudioMode = "dialogue") {
  return renderToStaticMarkup(
    <ScriptStatus
      mode={mode}
      script={script}
      findings={lintAudioScript(script, mode)}
      cast={mode === "dialogue" ? dialogueCast(script) : []}
      estimate="env. 10 s"
      onSwitchToDialogue={() => {}}
    />
  );
}

describe("ScriptStatus", () => {
  it("names the characters of a ready dialogue, with no error", () => {
    const markup = render("Léa : (soupire) Encore ?\nKarim : Oui.\nIls partent.");
    expect(markup).toContain("2 personnages : Léa, Karim");
    expect(markup).toContain("env. 10 s");
    expect(markup).toContain("1 indication entre parenthèses serait lue à voix haute");
    expect(markup).not.toContain("Étiquette");
  });

  it("says once, in plain words, that there are too many characters", () => {
    const markup = render("Léa : A.\nKarim : B.\nMarc : C.\nMarc : D.");
    expect(markup).toContain("3 personnages détectés (Léa, Karim, Marc)");
    expect(markup.match(/personnages détectés/g)).toHaveLength(1);
  });

  it("offers to switch a dialogue pasted in monologue mode", () => {
    const markup = render("Léa : Bonjour.\nKarim : Salut.", "monologue");
    expect(markup).toContain("Ce texte ressemble à un dialogue (Léa, Karim)");
    expect(markup).toContain(">Passer en mode Dialogue<");
  });

  it("names only the characters, not the discourse markers, of a dialogue in monologue mode", () => {
    const markup = render("Attention : écoutez bien.\nLéa : Bonjour.\nKarim : Salut.", "monologue");
    expect(markup).toContain("Ce texte ressemble à un dialogue (Léa, Karim)");
  });

  it("lets a monologue open lines with « Attention : » or « Remarque : »", () => {
    const markup = render("Attention : l'examen commence à 9 heures.\nRemarque : ce verbe est irrégulier.", "monologue");
    expect(markup).not.toContain("Passer en mode Dialogue");
    expect(markup).toContain("env. 10 s");
  });

  it("stays silent on an empty script", () => {
    expect(render("   ")).toBe("");
  });
});

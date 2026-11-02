import type { AudioVoiceGender } from "@/lib/api";
import { DIALOGUE_SLOTS, type DialogueSlot } from "@/lib/audio-script-rules";

// Default voices by gender, in the order a dialogue hands them out: Clara and
// Léo first, then Nora and Simon when both characters share a gender.
const DEFAULT_VOICES: Record<AudioVoiceGender, readonly string[]> = {
  feminine: ["Kore", "Erinome"],
  masculine: ["Puck", "Iapetus"],
};

// Words that give a character's gender away, accents stripped and lowercased:
// articles and titles ("Le serveur", "Madame Laurent", "Frau Weber"), role
// nouns, and common first names in the studio's teaching languages. Names
// worn by men and women alike (Camille, Alex, Andrea) are left out on purpose.
const FEMININE_WORDS = new Set(`
  la une die eine madame mme mademoiselle mlle mrs ms miss lady madam senora sra senorita dona frau signora
  femme fille mere maman soeur tante grand-mere epouse serveuse cliente vendeuse directrice infirmiere
  boulangere hotesse etudiante patronne voisine amie cuisiniere caissiere conductrice
  woman girl mother mum mom sister aunt grandma grandmother wife daughter waitress actress queen hostess
  mujer chica madre hermana abuela camarera clienta vendedora doctora profesora
  kellnerin kundin mutter schwester verkauferin arztin lehrerin
  anna anne alice amelie aurelie caroline catherine celine charlotte chloe claire clara elise
  elodie emilie emma eva fatima florence gabrielle helene ines isabelle jeanne julie juliette laura lea
  leila lena lisa louise lucie lucia manon margaux marie marine mathilde maya melanie nadia nathalie
  nina oceane pauline rose sandrine sarah sophie stephanie valerie virginie yasmine zoe
  amy emily grace hannah jessica kate katie lily linda lucy mary megan olivia rachel rebecca ruth
  susan victoria jennifer elizabeth sophia ella mia ava isla
  carmen elena isabel maria marta paula pilar rocio sofia ana lola beatriz cristina
  greta heidi ingrid julia katrin monika petra sabine ursula
`.trim().split(/\s+/));

const MASCULINE_WORDS = new Set(`
  le un der ein monsieur m mr sir senor sr don herr signor
  homme garcon pere papa frere oncle grand-pere epoux mari serveur client vendeur directeur infirmier
  boulanger etudiant patron voisin ami cuisinier caissier conducteur chauffeur livreur
  man boy father dad brother uncle grandpa grandfather husband son waiter actor king host gentleman
  hombre chico padre hermano abuelo camarero vendedor profesor
  kellner kunde vater bruder verkaufer arzt lehrer
  adam alexandre antoine arthur benoit bruno david eric etienne francois guillaume hugo jean jeremy
  julien karim kevin laurent leo louis luc lucas marc martin mathieu maxime michel mohamed nicolas
  olivier paul pierre philippe quentin raphael romain sebastien simon theo thomas vincent yann yannick
  ben charles daniel george harry jack james john mark matthew michael oliver peter robert tom william
  noah liam ethan henry
  alejandro antonio carlos diego javier jorge jose juan manuel miguel pablo pedro sergio
  felix hans jonas jurgen klaus lukas stefan wolfgang
`.trim().split(/\s+/));

function words(label: string): string[] {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z-]+/)
    .filter(Boolean);
}

/** The gender a character label points to, or null when it says nothing. */
export function guessCharacterGender(label: string): AudioVoiceGender | null {
  for (const word of words(label)) {
    if (FEMININE_WORDS.has(word)) return "feminine";
    if (MASCULINE_WORDS.has(word)) return "masculine";
  }
  return null;
}

interface KeptVoice {
  name: string;
  gender: AudioVoiceGender;
}

function opposite(gender: AudioVoiceGender): AudioVoiceGender {
  return gender === "feminine" ? "masculine" : "feminine";
}

// The voice each dialogue slot starts on, from its character's label. A slot
// whose voice the teacher chose is passed in `kept` and never changes. A
// character whose label says nothing takes the gender the other one does not,
// so the two still sound apart; with no clue at all, Clara then Léo.
export function defaultDialogueVoices(
  labels: Partial<Record<DialogueSlot, string>>,
  kept: Partial<Record<DialogueSlot, KeptVoice>> = {}
): Record<DialogueSlot, string> {
  const genders = DIALOGUE_SLOTS.map((slot) => kept[slot]?.gender ?? guessCharacterGender(labels[slot] ?? ""));
  const [first, second] = genders;
  const resolved: AudioVoiceGender[] = [
    first ?? (second ? opposite(second) : "feminine"),
    second ?? (first ? opposite(first) : "masculine"),
  ];

  const used = new Set(DIALOGUE_SLOTS.flatMap((slot) => (kept[slot] ? [kept[slot].name] : [])));
  const voices = {} as Record<DialogueSlot, string>;
  DIALOGUE_SLOTS.forEach((slot, index) => {
    const keptVoice = kept[slot];
    if (keptVoice) {
      voices[slot] = keptVoice.name;
      return;
    }
    const pool = DEFAULT_VOICES[resolved[index]];
    const voice = pool.find((name) => !used.has(name)) ?? pool[0];
    used.add(voice);
    voices[slot] = voice;
  });
  return voices;
}

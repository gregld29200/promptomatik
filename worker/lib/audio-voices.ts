export type AudioVoiceGender = "feminine" | "masculine";
export type AudioVoiceTone = "energetic" | "warm" | "composed";

export interface AudioVoice {
  name: string;
  label: string;
  gender: AudioVoiceGender;
  tone: AudioVoiceTone;
  descriptor: string;
  previewUrl: string;
}

// [Gemini voice id, display name shown to teachers, gender, Google descriptor]
const VOICES: ReadonlyArray<readonly [string, string, AudioVoiceGender, string]> = [
  ["Zephyr", "Nina", "feminine", "Bright"],
  ["Puck", "Leo", "masculine", "Upbeat"],
  ["Charon", "Daniel", "masculine", "Informative"],
  ["Kore", "Clara", "feminine", "Firm"],
  ["Fenrir", "Max", "masculine", "Excitable"],
  ["Leda", "Lea", "feminine", "Youthful"],
  ["Orus", "Victor", "masculine", "Firm"],
  ["Aoede", "Iris", "feminine", "Breezy"],
  ["Callirrhoe", "Maya", "feminine", "Easy-going"],
  ["Autonoe", "Elsa", "feminine", "Bright"],
  ["Enceladus", "Noah", "masculine", "Breathy"],
  ["Iapetus", "Simon", "masculine", "Clear"],
  ["Umbriel", "Hugo", "masculine", "Easy-going"],
  ["Algieba", "Marco", "masculine", "Smooth"],
  ["Despina", "Sara", "feminine", "Smooth"],
  ["Erinome", "Nora", "feminine", "Clear"],
  ["Algenib", "Bruno", "masculine", "Gravelly"],
  ["Rasalgethi", "Martin", "masculine", "Informative"],
  ["Laomedeia", "Mia", "feminine", "Upbeat"],
  ["Achernar", "Alma", "feminine", "Soft"],
  ["Alnilam", "Oscar", "masculine", "Firm"],
  ["Schedar", "Adam", "masculine", "Even"],
  ["Gacrux", "Vera", "feminine", "Mature"],
  ["Pulcherrima", "Julio", "masculine", "Forward"],
  ["Achird", "Lucas", "masculine", "Friendly"],
  ["Zubenelgenubi", "Rafael", "masculine", "Casual"],
  ["Vindemiatrix", "Eva", "feminine", "Gentle"],
  ["Sadachbia", "Elias", "masculine", "Lively"],
  ["Sadaltager", "Samuel", "masculine", "Knowledgeable"],
  ["Sulafat", "Rosa", "feminine", "Warm"],
];

// Groups Google's 22 descriptors into the three tones the casting filter offers.
const DESCRIPTOR_TONES: Record<string, AudioVoiceTone> = {
  Bright: "energetic",
  Upbeat: "energetic",
  Excitable: "energetic",
  Lively: "energetic",
  Breezy: "energetic",
  Youthful: "energetic",
  Soft: "warm",
  Gentle: "warm",
  Warm: "warm",
  Smooth: "warm",
  Breathy: "warm",
  "Easy-going": "warm",
  Friendly: "warm",
  Casual: "warm",
  Firm: "composed",
  Informative: "composed",
  Knowledgeable: "composed",
  Even: "composed",
  Clear: "composed",
  Forward: "composed",
  Mature: "composed",
  Gravelly: "composed",
};

function toneFor(descriptor: string): AudioVoiceTone {
  const tone = DESCRIPTOR_TONES[descriptor];
  if (!tone) throw new Error(`Descriptor "${descriptor}" has no tone mapping.`);
  return tone;
}

export const AUDIO_VOICES: AudioVoice[] = VOICES.map(([name, label, gender, descriptor]) => ({
  name,
  label,
  gender,
  tone: toneFor(descriptor),
  descriptor,
  // Previews are cached for 24h; keying the URL on the label busts every
  // browser cache the moment a voice is renamed and re-seeded.
  previewUrl: `/api/audio/voices/${encodeURIComponent(name)}/preview?v=${encodeURIComponent(label)}`,
}));

export function isAudioVoiceName(value: string): boolean {
  return AUDIO_VOICES.some((voice) => voice.name === value);
}

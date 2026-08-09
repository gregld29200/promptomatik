// A fixture transcript, so the reading experience can be built and judged with
// no API key, no queue and no network.
//
// It is NOT a captured provider response — there is no Groq or Deepgram key in
// this environment, so nothing here was returned by a real API and nothing here
// should ever be presented as provider output. What it is: a hand-written
// two-speaker French interview (~2 minutes) whose word timings are *computed*
// from the words themselves, so starts, ends, pauses and speaker totals are
// internally consistent the way a real payload's are. Speech rate, pause after
// punctuation and per-word confidence follow a deterministic model, so the
// fixture is byte-stable across runs and diffs stay readable.
//
// Uncertain words are marked in the source text with a trailing `~` (stripped
// before rendering) and get a confidence in the 0.36–0.58 band — the handful of
// proper nouns and rare terms a real engine actually hesitates on.

import type {
  TranscriptData,
  TranscriptSegment,
  TranscriptSpeaker,
  TranscriptWord,
} from "./types";

interface FixtureTurn {
  speaker: string;
  text: string;
}

/** Interviewer = "0", Claire the FLE trainer = "1". Deepgram's integer ids as strings. */
const TURNS: readonly FixtureTurn[] = [
  {
    speaker: "0",
    text:
      "Bienvenue dans cet épisode. Aujourd'hui je reçois Claire Fontaine,~ formatrice en français langue " +
      "étrangère depuis quinze ans, à Lyon. Claire, merci d'avoir accepté l'invitation.",
  },
  {
    speaker: "1",
    text: "Merci à vous. C'est un sujet qui me tient à cœur, alors j'en parle très volontiers.",
  },
  {
    speaker: "0",
    text:
      "Commençons simplement. Qu'est-ce qui change vraiment quand on enseigne à des adultes plutôt qu'à " +
      "des adolescents ?",
  },
  {
    speaker: "1",
    text:
      "Beaucoup de choses, mais la principale, c'est le rapport au temps. Un adulte arrive avec un objectif " +
      "précis et deux heures par semaine, pas davantage. Il ne vient pas apprendre le français en général, " +
      "il vient pouvoir animer une réunion en français au mois de mars. Donc je construis la séance à partir " +
      "de cette échéance,~ pas à partir du manuel. Concrètement, je commence toujours par leur demander ce " +
      "qu'ils devront faire, en vrai, dans les six prochaines semaines.",
  },
  { speaker: "0", text: "Et cela change quoi dans votre préparation ?" },
  {
    speaker: "1",
    text:
      "Cela change tout. Je passe moins de temps à chercher le document parfait et plus de temps à préparer " +
      "des tâches. Une tâche, c'est quelque chose qu'ils font, pas quelque chose qu'ils écoutent. Hier par " +
      "exemple, mes apprenants ont enregistré un message vocal pour reporter un rendez-vous. Trois minutes " +
      "d'enregistrement, vingt minutes d'analyse ensuite. C'est là que l'apprentissage se joue, dans " +
      "l'analyse, quand ils s'entendent.",
  },
  {
    speaker: "0",
    text: "Vous parlez d'analyse. Est-ce que vous travaillez explicitement la métacognition~ avec eux ?",
  },
  {
    speaker: "1",
    text:
      "Oui, et c'est peut-être ce qui a le plus changé dans ma pratique. En fin de séance, je leur demande " +
      "deux choses : ce qu'ils ont réussi, et ce qu'ils feraient autrement la prochaine fois. Ça prend cinq " +
      "minutes. Sur un cycle de dix semaines, ces cinq minutes hebdomadaires~ font plus de différence que " +
      "n'importe quel exercice de grammaire supplémentaire.",
  },
  {
    speaker: "0",
    text: "Dernière question, plus pratique. Comment est-ce que vous utilisez l'intelligence artificielle là-dedans ?",
  },
  {
    speaker: "1",
    text:
      "Comme une collègue un peu rapide et un peu naïve. Je lui demande des variantes, des exemples, des " +
      "amorces de consigne. Je garde la décision pédagogique, toujours. Et je vérifie systématiquement ce " +
      "qu'elle propose, parce que le niveau de langue est souvent trop élevé pour mes groupes. Utilisée " +
      "comme ça, elle me fait gagner une heure par semaine, et cette heure, je la remets dans le suivi " +
      "individuel.",
  },
];

/** Real diarization splits a long turn into utterances; we split at sentence ends. */
const MAX_SEGMENT_WORDS = 34;

/** Speech model, in seconds. Tuned to ~2.6 words per second, a calm French pace. */
const WORD_BASE_SECONDS = 0.13;
const WORD_PER_CHAR_SECONDS = 0.042;
const WORD_MAX_SECONDS = 0.55;
const PAUSE_SENTENCE = 0.3;
const PAUSE_CLAUSE = 0.12;
const PAUSE_BETWEEN_TURNS = 0.45;
const TRAILING_SILENCE = 0.9;

const UNCERTAIN_MARKER = "~";
const PUNCTUATION = /[.,;:!?…«»"'’—-]/g;
const SENTENCE_END = /[.!?…]$/;
const CLAUSE_END = /[,;:]$/;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Deterministic 0..1 from a string. FNV-1a, so the fixture never shifts. */
function unitHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 8) / 0xffffff;
}

function confidenceFor(token: string, position: number, uncertain: boolean): number {
  const spread = unitHash(`${token}:${position}`);
  return uncertain ? round(0.36 + spread * 0.22) : round(0.88 + spread * 0.11);
}

function splitIntoSegmentTexts(text: string): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  let words = 0;

  for (const sentence of sentences) {
    const length = sentence.trim().split(/\s+/).filter(Boolean).length;
    if (words > 0 && words + length > MAX_SEGMENT_WORDS) {
      chunks.push(current.trim());
      current = "";
      words = 0;
    }
    current += sentence;
    words += length;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

interface BuiltSegment {
  words: TranscriptWord[];
  text: string;
  start: number;
  end: number;
}

function buildSegment(
  rawText: string,
  speaker: string,
  language: string,
  cursorAt: number
): { segment: BuiltSegment; cursor: number } {
  const tokens = rawText.split(/\s+/).filter(Boolean);
  const words: TranscriptWord[] = [];
  const plain: string[] = [];
  let cursor = cursorAt;

  tokens.forEach((token, position) => {
    const uncertain = token.endsWith(UNCERTAIN_MARKER);
    const text = uncertain ? token.slice(0, -UNCERTAIN_MARKER.length) : token;
    const core = text.replace(PUNCTUATION, "");
    const spoken = Math.min(WORD_MAX_SECONDS, WORD_BASE_SECONDS + WORD_PER_CHAR_SECONDS * core.length);
    const start = round(cursor);
    const end = round(cursor + spoken);

    words.push({
      text,
      start,
      end,
      speaker,
      confidence: confidenceFor(text, position, uncertain),
      language,
    });
    plain.push(text);

    const pause = SENTENCE_END.test(text) ? PAUSE_SENTENCE : CLAUSE_END.test(text) ? PAUSE_CLAUSE : 0;
    cursor = end + pause;
  });

  const first = words[0];
  const last = words[words.length - 1];
  return {
    segment: {
      words,
      text: plain.join(" "),
      start: first ? first.start : round(cursorAt),
      end: last ? last.end : round(cursorAt),
    },
    cursor,
  };
}

function buildTranscript(): TranscriptData {
  const segments: TranscriptSegment[] = [];
  const spokenSeconds = new Map<string, number>();
  const firstSeenOrder: string[] = [];
  let cursor = 0.4; // a beat of intro silence, as any real recording has
  let idx = 0;

  for (const turn of TURNS) {
    if (!firstSeenOrder.includes(turn.speaker)) firstSeenOrder.push(turn.speaker);
    for (const chunk of splitIntoSegmentTexts(turn.text)) {
      const built = buildSegment(chunk, turn.speaker, "fr", cursor);
      cursor = built.cursor;
      segments.push({
        idx,
        speaker: turn.speaker,
        start: built.segment.start,
        end: built.segment.end,
        text: built.segment.text,
        words: built.segment.words,
        language: "fr",
      });
      spokenSeconds.set(
        turn.speaker,
        (spokenSeconds.get(turn.speaker) ?? 0) + (built.segment.end - built.segment.start)
      );
      idx += 1;
    }
    cursor += PAUSE_BETWEEN_TURNS;
  }

  const speakers: TranscriptSpeaker[] = firstSeenOrder.map((id, index) => ({
    id,
    index,
    label: `speaker_${id}`,
    seconds: round(spokenSeconds.get(id) ?? 0),
  }));

  const lastSegment = segments[segments.length - 1];
  const durationSeconds = round((lastSegment ? lastSegment.end : 0) + TRAILING_SILENCE);

  return {
    metadata: {
      provider: "deepgram",
      providerJobId: "fixture-6f1c2a08-3d7e-4b91-9a55-c0d4e8f21b73",
      model: "nova-3",
      durationSeconds,
      detectedLanguages: ["fr"],
      diarization: true,
      speakerCount: speakers.length,
      channels: 1,
    },
    speakers,
    segments,
    text: segments.map((segment) => segment.text).join("\n\n"),
  };
}

/**
 * Two speakers, French, ~2 minutes, diarized — the Deepgram `nova-3` path.
 * Contains four flagged low-confidence words, which is the realistic density:
 * enough to exercise the flag, far too few to justify highlighting by default.
 */
export const frenchInterviewFixture: TranscriptData = buildTranscript();

/**
 * The same media as the Groq `whisper-large-v3-turbo` path would come back:
 * identical words and timings, no speakers at all. Whisper has no diarization —
 * this is what the reader must look like when the teacher asked for speakers and
 * the default provider ran, and it is the state most likely to look broken if
 * the UI is careless about it.
 */
export const frenchInterviewWithoutSpeakersFixture: TranscriptData = {
  metadata: {
    provider: "groq",
    providerJobId: "fixture-req-9d41c7b2e05a",
    model: "whisper-large-v3-turbo",
    durationSeconds: frenchInterviewFixture.metadata.durationSeconds,
    detectedLanguages: ["fr"],
    diarization: false,
    speakerCount: null,
    channels: 1,
  },
  speakers: [],
  segments: frenchInterviewFixture.segments.map((segment) => ({
    ...segment,
    speaker: null,
    // Whisper reports one language for the whole media, on the metadata only.
    words: segment.words.map((word) => ({ ...word, speaker: null, language: null })),
  })),
  text: frenchInterviewFixture.text,
};

// Inline review of the studio's suggestions (emotion tags and fixes).
// Offsets refer to the script the suggestions were computed on; the studio
// keeps that script frozen while the teacher reviews them.

export interface InlineSuggestion {
  id: string;
  kind: "tag" | "fix";
  start: number;
  end: number;
  insert: string;
  tag?: string;
  scene?: string;
  /** The prepare-pass change type behind a fix, e.g. "speaker_rename". */
  fixType?: string;
  reason: string;
}

export type SuggestionDecision = "accepted" | "rejected";

export type ReviewSegment =
  | { kind: "text"; text: string }
  | { kind: "suggestion"; suggestion: InlineSuggestion; original: string };

export function reviewSegments(script: string, suggestions: InlineSuggestion[]): ReviewSegment[] {
  const ordered = [...suggestions].sort((left, right) => left.start - right.start || left.end - right.end);
  const segments: ReviewSegment[] = [];
  let cursor = 0;
  for (const suggestion of ordered) {
    if (suggestion.start < cursor) continue;
    if (suggestion.start > cursor) segments.push({ kind: "text", text: script.slice(cursor, suggestion.start) });
    segments.push({ kind: "suggestion", suggestion, original: script.slice(suggestion.start, suggestion.end) });
    cursor = suggestion.end;
  }
  if (cursor < script.length) segments.push({ kind: "text", text: script.slice(cursor) });
  return segments;
}

// Applies the accepted suggestions from the end of the script backwards, so
// earlier offsets stay valid. At one offset, a replacement goes before an
// insertion, which therefore lands in front of the replaced text.
export function applySuggestions(
  script: string,
  suggestions: InlineSuggestion[],
  decisions: Record<string, SuggestionDecision>
): { script: string; scenes: string[] } {
  const accepted = suggestions.filter((suggestion) => decisions[suggestion.id] === "accepted");
  const ordered = [...accepted].sort((left, right) => right.start - left.start || right.end - left.end);
  let next = script;
  for (const suggestion of ordered) {
    next = `${next.slice(0, suggestion.start)}${suggestion.insert}${next.slice(suggestion.end)}`;
  }
  const scenes = accepted
    .sort((left, right) => left.start - right.start)
    .flatMap((suggestion) => (suggestion.scene ? [suggestion.scene] : []));
  return { script: next, scenes };
}

// "[very slow]" -> "very_slow", the i18n key of its teacher-facing label.
export function tagSlug(tag: string): string {
  return tag.slice(1, -1).trim().toLowerCase().replace(/\s+/g, "_");
}

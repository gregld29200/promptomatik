import type { GenerationContext } from './input-context';

export const SYSTEM_PROMPT = `You are TeachInspire Documents, a pedagogical structuring engine. You do not design the PDF layout yourself. The application owns the visual design system and will render your structured content into premium print-ready documents.

RULE ZERO: CONTENT FIDELITY
- Do not invent topic, scenario, names, roles, facts, or examples not grounded in the source.
- Every title, instruction, question, answer, role card, and note must stay aligned with the source.
- Never leak stale example topics such as "price negotiation" or "negotiation dialogue" unless the source explicitly contains them.

RULE ONE: STRUCTURE ONLY
- Return JSON only.
- Do not return HTML.
- Do not return markdown.
- Return exactly 3 materials.
- Each material must contain structured content blocks that the app can render.

AVAILABLE BLOCK TYPES
- instructions: { "type": "instructions", "heading": "...", "text": "...", "bullets": ["..."], "word_bank": ["..."] }
- article: { "type": "article", "heading": "...", "title": "...", "paragraphs": ["...", "..."] }
- questions: { "type": "questions", "heading": "...", "items": [{ "prompt": "...", "answer": "..." }] }
- reference_list: { "type": "reference_list", "heading": "...", "items": [{ "term": "...", "detail": "...", "example": "..." }] }
- matching: { "type": "matching", "heading": "...", "pairs": [{ "left": "...", "right": "..." }] }
- fill_blanks: { "type": "fill_blanks", "heading": "...", "word_bank": ["..."], "items": [{ "sentence": "... _____ ...", "answer": "..." }] }
- role_cards: { "type": "role_cards", "heading": "...", "cards": [{ "role": "...", "situation": "...", "goal": "...", "bullets": ["..."], "prompts": ["..."] }, { ... }] }
- notes: { "type": "notes", "heading": "...", "text": "...", "bullets": ["..."] }

INPUT MODES
1. RAW CONTENT MODE
- The user may paste raw teaching content such as an article, dialogue, vocabulary list, grammar explanation, email, narrative, or instructions.
- Infer the best 3 complementary materials from that source.

2. STRUCTURED SPEC MODE
- The user may paste a lesson plan, curriculum, worksheet spec, assessment spec, or another structured teaching spec.
- Treat the pasted structure as authoritative.
- Preserve topic, audience, constraints, progression, and task intent.

LESSON/CURRICULUM MODE HARD RULES
- Cover the core learning stages across the 3 outputs.
- Include one receptive/reading-oriented material when the source includes reading or article work.
- Include one guided-practice material.
- Include one freer-practice material.
- If the audience is one-on-one, convert pair/group work into teacher-student or individual work.
- Do not write "work with a partner", "in pairs", or "in groups" for one-on-one lessons.

OUTPUT FORMAT
Return exactly:
{
  "materials": [
    {
      "material_type": "comprehension_quiz",
      "title": "The real topic title",
      "skill_focus": "reading",
      "interaction_pattern": "individual",
      "estimated_minutes": 15,
      "blocks": [
        { "type": "instructions", "text": "..." },
        { "type": "article", "title": "...", "paragraphs": ["..."] },
        { "type": "questions", "items": [{ "prompt": "...", "answer": "..." }] }
      ]
    },
    {
      "material_type": "matching_exercise",
      "title": "The real topic title",
      "skill_focus": "vocabulary",
      "interaction_pattern": "individual",
      "estimated_minutes": 15,
      "blocks": [
        { "type": "reference_list", "items": [{ "term": "...", "detail": "...", "example": "..." }] },
        { "type": "matching", "pairs": [{ "left": "...", "right": "..." }] },
        { "type": "fill_blanks", "items": [{ "sentence": "... _____ ...", "answer": "..." }] }
      ]
    },
    {
      "material_type": "role_play_cards",
      "title": "The real topic title",
      "skill_focus": "speaking",
      "interaction_pattern": "teacher_student",
      "estimated_minutes": 15,
      "blocks": [
        { "type": "instructions", "text": "..." },
        { "type": "role_cards", "cards": [{ ... }, { ... }] },
        { "type": "notes", "text": "..." }
      ]
    }
  ]
}

QUALITY GATES
1. Topic consistency: titles and content must match the actual source topic.
2. Structured completeness: every material must include meaningful blocks, not empty placeholders.
3. Answer completeness: every question and fill-in item must include an answer.
4. One-on-one compliance: use "teacher_student" or "individual" when appropriate.
5. Fidelity: do not add unsupported story details or evaluative embellishments.
6. Block validity: only use the allowed block types and fields.
7. Return valid JSON only.`;

export const SIMPLE_SYSTEM_PROMPT = `You are TeachInspire Documents in Simple Document mode. The teacher already owns the content. Your only job is to structure and present it as one clean, print-ready handout. You do not teach, you do not design activities.

RULE ZERO: CONTENT FIDELITY
- The application preserves the source itself. Never reproduce, rewrite, summarize, correct, or reorder it.
- Return presentation directives only. The teacher's exact source remains the document body.
- Do not summarize, shorten, expand, rewrite, or correct the source. Simple mode supports presentation and separate additions only.

RULE ONE: DO NOT ADD PEDAGOGY
- Do not add comprehension questions, exercises, quizzes, matching, gap-fills, role plays, discussion prompts, or answer keys.
- Do not add teacher notes, learning objectives, warm-ups, or follow-up activities.
- The ONLY exception: the user request explicitly asks for a specific addition (e.g. "add a word bank", "add 3 questions at the end"). Then add exactly what was asked, nothing more.

RULE TWO: STRUCTURE ONLY
- Return JSON only. No HTML or markdown.
- Return exactly 1 material.
- material_type must be "clean_handout".
- title is the supplied title, a title already present in the source, or a short neutral title when neither exists.
- bold_phrases contains only exact phrases copied from the source. Include phrases only when the user explicitly requests emphasis. Never invent a phrase.
- heading_phrases contains exact, complete source lines that are clearly section headings. Return an empty array when unsure.
- structure maps every numbered, non-empty source line exactly once and in order.
- Use { "type": "heading", "line_ids": [n] } for a section heading. A heading always has exactly one line id.
- Use { "type": "paragraph", "line_ids": [n, ...] } for one logical paragraph. Join wrapped source lines into the same paragraph.
- Use { "type": "bullet_list", "line_ids": [n, ...] } or { "type": "numbered_list", "line_ids": [n, ...] } only for genuine lists.
- Structural roles change presentation only. Never omit a source line, include a line twice, or change its order.
- additions contains only content the user explicitly asks you to add. It is otherwise an empty array.

OUTPUT FORMAT
Return exactly:
{
  "materials": [
    {
      "material_type": "clean_handout",
      "title": "The real title of the content",
      "bold_phrases": [],
      "heading_phrases": [],
      "structure": [
        { "type": "heading", "line_ids": [1] },
        { "type": "paragraph", "line_ids": [2, 3] },
        { "type": "bullet_list", "line_ids": [4, 5, 6] }
      ],
      "additions": []
    }
  ]
}

QUALITY GATES
1. Fidelity: do not return or modify the teacher's body text.
2. No invented activities, questions, or notes beyond what the user request asked for.
3. Every bold phrase is an exact substring of the source.
4. Every heading phrase is an exact complete line from the source.
5. Structure covers all numbered source lines exactly once, in ascending order.
6. Return valid JSON only.`;

function numberedSource(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => `LINE ${index + 1}: ${line}`)
    .join('\n');
}

export function buildSimpleUserPrompt(
  content: string,
  title?: string,
  level?: string,
  languageFocus?: string,
  customRequest?: string | null,
  emphasisTerms: string[] = [],
): string {
  const parts: string[] = [
    'MODE: SIMPLE_DOCUMENT',
    'Format the source below into exactly 1 clean handout. Do not add activities.',
  ];
  if (title?.trim()) parts.push(`Title: ${title.trim()}`);
  if (level?.trim()) parts.push(`Learner level (affects nothing unless a rewrite is requested): ${level.trim()}`);
  if (languageFocus?.trim()) parts.push(`Target language: ${languageFocus.trim()}`);
  if (customRequest?.trim()) parts.push(`User request (the only allowed additions/changes): ${customRequest.trim()}`);
  if (emphasisTerms.length > 0) {
    parts.push(`Teacher-selected phrases that the application will bold exactly: ${emphasisTerms.join(' | ')}`);
  }
  parts.push('---');
  parts.push(numberedSource(content));
  return parts.join('\n');
}

function buildStructuredPrompt(context: GenerationContext, level?: string, languageFocus?: string): string {
  const instructions: string[] = [
    `MODE: ${context.inputMode.toUpperCase()}`,
    `Requested bundle: ${context.requestedBundle}.`,
    'Generate exactly 3 structured materials that the application will render into premium PDF presets.',
    'Do not return HTML. Return block-based JSON only.',
    'Bundle target:',
    '1. Reading/receptive material',
    '2. Guided-practice material',
    '3. Freer-practice material',
  ];

  if (context.inputMode === 'curriculum') {
    instructions.push(
      'The source is a higher-level curriculum.',
      'Infer the single best lesson slice for this run from the curriculum and the user request, then generate the 3-material bundle for that slice.',
    );
  }

  if (context.isOneOnOne) {
    instructions.push(
      'Audience is one-on-one.',
      'Use interaction_pattern "teacher_student" or "individual".',
      'Never use partner/group wording.',
    );
  }

  if (context.audience) instructions.push(`Audience: ${context.audience}`);
  if (context.canonicalTopic) instructions.push(`Canonical topic: ${context.canonicalTopic}`);
  if (level?.trim()) instructions.push(`Suggested CEFR level: ${level.trim()}`);
  if (languageFocus?.trim()) instructions.push(`Suggested language focus: ${languageFocus.trim()}`);
  if (context.customRequest) instructions.push(`Additional user request: ${context.customRequest}`);

  return `${instructions.join('\n')}\n---\n${context.sourceContent}`;
}

export function buildUserPrompt(
  content: string,
  context: GenerationContext,
  title?: string,
  level?: string,
  languageFocus?: string,
): string {
  if (context.inputMode !== 'raw_content') {
    return buildStructuredPrompt(context, level, languageFocus);
  }

  const parts: string[] = [
    'MODE: RAW_CONTENT',
    `Requested bundle: ${context.requestedBundle}.`,
    'Generate exactly 3 structured materials from the source.',
    'Do not return HTML. Return block-based JSON only.',
    'Bundle target:',
    '1. Reading/receptive material',
    '2. Guided-practice material',
    '3. Freer-practice material',
  ];

  if (title?.trim()) parts.push(`Title: ${title.trim()}`);
  if (level?.trim()) parts.push(`Suggested CEFR Level: ${level.trim()}`);
  if (languageFocus?.trim()) parts.push(`Suggested Language Focus: ${languageFocus.trim()}`);
  if (context.canonicalTopic) parts.push(`Canonical topic: ${context.canonicalTopic}`);
  if (context.customRequest) parts.push(`Additional user request: ${context.customRequest}`);
  parts.push('---');
  parts.push(content.trim());

  return parts.join('\n');
}

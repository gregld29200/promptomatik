import { z } from 'zod';
import {
  buildSimpleMaterial,
  isCollapsedStructure,
  isValidStructureCoverage,
  stripHeadingMarker,
} from './simple-structure';
import {
  SIMPLE_ADDITIONS_SYSTEM_PROMPT,
  STRUCTURE_RESCUE_SYSTEM_PROMPT,
  buildSimpleAdditionsUserPrompt,
  buildStructureRescueUserPrompt,
} from './system-prompt';
import {
  MaterialBlockSchema,
  SimpleStructureRescueResponseSchema,
  simpleAdditionsResponseSchema,
  type DocumentDesign,
  type DocumentOrientation,
  type DocumentType,
  type MaterialBlock,
  type SimpleTemplateId,
  type TransformResponse,
} from './types';

const DEFAULT_MODEL = 'google/gemini-3.1-pro-preview';

export interface DocumentsLlmConfig {
  apiKey: string;
  model?: string;
  /** Light model for the simple-mode structure rescue. */
  structureModel?: string;
  fetcher?: typeof fetch;
}

const DEFAULT_STRUCTURE_MODEL = 'google/gemini-2.5-flash';

function resolveModel(config: DocumentsLlmConfig): string {
  return config.model?.trim() || DEFAULT_MODEL;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function extractJSON(raw: string): string {
  let text = raw.trim();

  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  if (!text.startsWith('{')) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      text = text.slice(start, end + 1);
    }
  }

  return text;
}

// The block schema for one additions request: only the types it may return.
// Offered the union of all eight, Gemini mixes their fields (an article's
// title and paragraphs under "type": "matching") and every attempt fails.
function allowedBlockSchema(allowed: Set<MaterialBlock['type']>): z.ZodType<MaterialBlock> {
  const [first, ...rest] = MaterialBlockSchema.options.filter((option) => allowed.has(option.shape.type.value));
  return rest.length === 0 ? first : z.discriminatedUnion('type', [first, ...rest]);
}

function additionsResponseFormat(block: z.ZodType<MaterialBlock>): Record<string, unknown> {
  const schema = z.toJSONSchema(simpleAdditionsResponseSchema(block), { target: 'draft-7' }) as Record<string, unknown>;
  delete schema.$schema;
  return {
    type: 'json_schema',
    json_schema: {
      name: 'teachinspire_simple_additions',
      strict: true,
      schema,
    },
  };
}

async function requestCompletion(
  config: DocumentsLlmConfig,
  messages: ChatMessage[],
  options: { responseFormat: Record<string, unknown>; model?: string },
): Promise<unknown> {
  const fetcher = config.fetcher ?? fetch;
  const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'HTTP-Referer': 'https://studio.teachinspire.me',
      'X-Title': 'TeachInspire Documents',
    },
    body: JSON.stringify({
      model: options.model ?? resolveModel(config),
      messages,
      temperature: 0.15,
      max_tokens: 24000,
      response_format: options.responseFormat,
    }),
    signal: AbortSignal.timeout(180000),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    if (response.status === 429) {
      throw new Error('AI service is busy. Please try again in a moment.');
    }
    throw new Error(`AI generation failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const rawContent = data.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('No content returned from AI. Try again with different content.');
  }

  try {
    return JSON.parse(extractJSON(rawContent));
  } catch {
    console.error('[llm] Failed to parse JSON. First 500 chars:', rawContent.slice(0, 500));
    console.error('[llm] Last 200 chars:', rawContent.slice(-200));
    throw new Error('AI returned invalid JSON. Try again with different content.');
  }
}

// The additions a teacher can tick (Documents › Ajouter au document). Each
// maps to the block types the model may return, and to the plain request
// sent to it — a checkbox can never ask for something Documents cannot do.
export const DOCUMENT_ADDITIONS = ['word_bank', 'questions', 'matching', 'fill_blanks', 'role_cards', 'instructions'] as const;
export type DocumentAddition = typeof DOCUMENT_ADDITIONS[number];

const ADDITION_BLOCKS: Record<DocumentAddition, Array<MaterialBlock['type']>> = {
  word_bank: ['reference_list'],
  questions: ['questions'],
  matching: ['matching'],
  fill_blanks: ['fill_blanks'],
  role_cards: ['role_cards'],
  instructions: ['instructions', 'notes'],
};

const ADDITION_REQUESTS: Record<DocumentAddition, string> = {
  word_bank: 'a word bank of the key vocabulary, with short definitions',
  questions: '5 comprehension questions, each with its answer',
  matching: 'a matching exercise',
  fill_blanks: 'a gap-fill exercise with a word bank',
  role_cards: 'a pair of role-play cards',
  instructions: 'short instructions for the learner',
};

export function isDocumentAddition(value: unknown): value is DocumentAddition {
  return typeof value === 'string' && (DOCUMENT_ADDITIONS as readonly string[]).includes(value);
}

export function additionsRequest(additions: DocumentAddition[]): string {
  return `Add, at the end of the document: ${additions.map((addition) => ADDITION_REQUESTS[addition]).join('; ')}.`;
}

export function additionsAllowedTypes(additions: DocumentAddition[]): Set<MaterialBlock['type']> {
  return new Set(additions.flatMap((addition) => ADDITION_BLOCKS[addition]));
}

export function allowedSimpleAdditionTypes(request?: string): Set<MaterialBlock['type']> {
  const text = request?.toLocaleLowerCase() ?? '';
  const allowed = new Set<MaterialBlock['type']>();
  if (/word bank|glossary|vocabulary list|banque de mots|lexique|glossaire|banco de palabras|glosario/.test(text)) allowed.add('reference_list');
  if (/questions?|quiz|comprehension|compréhension|preguntas|comprensión/.test(text)) allowed.add('questions');
  if (/matching|match exercise|appariement|associer|relier|emparejar|relacionar/.test(text)) allowed.add('matching');
  if (/gap[- ]?fill|fill[- ]?in|texte à trous|phrases? à trous|textos? a completar|huecos/.test(text)) allowed.add('fill_blanks');
  if (/role[- ]?play|role cards?|jeu de rôles?|cartes? de rôles?|juego de roles|tarjetas de rol/.test(text)) allowed.add('role_cards');
  if (/instructions?|consignes?|notes?/.test(text)) {
    allowed.add('instructions');
    allowed.add('notes');
  }
  return allowed;
}

/**
 * Structure rescue for pastes the local parser could not untangle (detected
 * via isCollapsedStructure). A light model re-classifies the numbered lines —
 * directives only, one attempt, and any failure falls back silently to the
 * local result so the teacher always gets a document.
 */
async function rescueSimpleStructure(
  config: DocumentsLlmConfig,
  lines: string[],
): Promise<{ structure: { type: 'heading' | 'paragraph' | 'bullet_list' | 'numbered_list'; line_ids: number[] }[] } | null> {
  try {
    const schema = z.toJSONSchema(SimpleStructureRescueResponseSchema, { target: 'draft-7' }) as Record<string, unknown>;
    delete schema.$schema;
    const payload = await requestCompletion(
      config,
      [
        { role: 'system', content: STRUCTURE_RESCUE_SYSTEM_PROMPT },
        { role: 'user', content: buildStructureRescueUserPrompt(lines) },
      ],
      {
        model: config.structureModel?.trim() || DEFAULT_STRUCTURE_MODEL,
        responseFormat: {
          type: 'json_schema',
          json_schema: { name: 'teachinspire_structure_rescue', strict: true, schema },
        },
      },
    );
    const result = SimpleStructureRescueResponseSchema.safeParse(payload);
    if (!result.success || !isValidStructureCoverage(result.data.structure, lines.length)) {
      console.warn('[llm] Structure rescue rejected: invalid shape or coverage.');
      return null;
    }
    return result.data;
  } catch (error) {
    console.warn('[llm] Structure rescue failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

const AdditionsEnvelopeSchema = z.object({ additions: z.array(z.unknown()) });

// Each addition is checked on its own, so one malformed or unrequested block
// does not cost the teacher the valid ones beside it.
function validAdditions(payload: unknown, block: z.ZodType<MaterialBlock>): MaterialBlock[] {
  const envelope = AdditionsEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    console.error('[llm] Invalid additions shape:', envelope.error.flatten());
    return [];
  }
  return envelope.data.additions.flatMap((candidate) => {
    const result = block.safeParse(candidate);
    if (result.success) return [result.data];
    console.warn('[llm] Dropped an invalid addition:', result.error.flatten());
    return [];
  });
}

/**
 * Additions-only LLM call. The document body is already built locally; the
 * model only produces the explicitly requested extra blocks, constrained to
 * the allowed block types both in the response schema and on validation.
 */
async function generateSimpleAdditions(
  config: DocumentsLlmConfig,
  content: string,
  customRequest: string,
  allowed: Set<MaterialBlock['type']>,
  documentType: DocumentType,
  level?: string,
  languageFocus?: string,
): Promise<MaterialBlock[]> {
  const block = allowedBlockSchema(allowed);
  const responseFormat = additionsResponseFormat(block);
  const baseMessages: ChatMessage[] = [
    { role: 'system', content: SIMPLE_ADDITIONS_SYSTEM_PROMPT },
    { role: 'user', content: buildSimpleAdditionsUserPrompt(content, customRequest, documentType, level, languageFocus) },
  ];

  const attempts: ChatMessage[][] = [baseMessages];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const payload = await requestCompletion(config, attempts[attempt], { responseFormat });
    const additions = validAdditions(payload, block);
    if (additions.length > 0) return additions;

    if (attempt === 1) {
      throw new Error('AI returned an unexpected structure. Try again.');
    }
    attempts.push([
      ...baseMessages,
      {
        role: 'user',
        content: [
          'Your previous output did not match the required JSON structure.',
          'Return only valid JSON: { "additions": [ ...blocks ] }.',
          `Use only these block types: ${[...allowed].join(', ')}.`,
        ].join('\n'),
      },
    ]);
  }

  throw new Error('AI generation failed after validation retries.');
}

export interface BuildDocumentOptions {
  title?: string;
  level?: string;
  languageFocus?: string;
  customRequest?: string;
  /** Ticked additions; when present they replace the free-text request. */
  additions?: DocumentAddition[];
  emphasisTerms?: string[];
  templateId?: SimpleTemplateId;
  documentType?: DocumentType;
  orientation?: DocumentOrientation;
  design?: DocumentDesign;
  locale?: string;
}

// Formatting is code, not AI judgement: the same input always produces the
// same document. The model is only consulted for the structure-rescue safety
// net and for explicitly requested additions.
export async function buildDocument(
  config: DocumentsLlmConfig,
  content: string,
  options: BuildDocumentOptions = {},
): Promise<TransformResponse> {
  const { title, level, languageFocus } = options;
  const ticked = (options.additions ?? []).filter(isDocumentAddition);
  const customRequest = ticked.length > 0 ? additionsRequest(ticked) : options.customRequest;
  const material = buildSimpleMaterial(content.trim(), {
    title,
    emphasisTerms: options.emphasisTerms,
    templateId: options.templateId,
    documentType: options.documentType,
    orientation: options.orientation,
    level,
    languageFocus,
    locale: options.locale,
  });
  if (options.design && Object.keys(options.design).length > 0) material.design = options.design;
  const documentType = options.documentType ?? 'reading';

  // Safety net for mangled pastes only: if the local parse collapsed into a
  // blob, let a light model re-classify the lines (directives, not text).
  if (material.structure && isCollapsedStructure(material.structure)) {
    const lines = content.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const rescued = await rescueSimpleStructure(config, lines);
    if (rescued) {
      material.structure = rescued.structure;
      material.heading_phrases = rescued.structure
        .filter((block) => block.type === 'heading')
        .map((block) => stripHeadingMarker(lines[block.line_ids[0] - 1]));
    }
  }

  const allowed = ticked.length > 0 ? additionsAllowedTypes(ticked) : allowedSimpleAdditionTypes(customRequest);
  // Say so when the request names nothing Documents can add, instead of
  // silently returning the document without it.
  if (customRequest?.trim()) material.request_status = allowed.size > 0 ? 'applied' : 'not_applied';
  if (customRequest?.trim() && allowed.size > 0) {
    material.blocks = await generateSimpleAdditions(
      config,
      content,
      customRequest.trim(),
      allowed,
      documentType,
      level,
      languageFocus,
    );
  }
  return { materials: [material] };
}

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
  SimpleAdditionsResponseSchema,
  SimpleStructureRescueResponseSchema,
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

function additionsResponseFormat(): Record<string, unknown> {
  const schema = z.toJSONSchema(SimpleAdditionsResponseSchema, { target: 'draft-7' }) as Record<string, unknown>;
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
  overrides?: { model?: string; responseFormat?: Record<string, unknown> },
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
      model: overrides?.model ?? resolveModel(config),
      messages,
      temperature: 0.15,
      max_tokens: 24000,
      response_format: overrides?.responseFormat ?? additionsResponseFormat(),
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

export function allowedSimpleAdditionTypes(request?: string): Set<MaterialBlock['type']> {
  const text = request?.toLocaleLowerCase() ?? '';
  const allowed = new Set<MaterialBlock['type']>();
  if (/word bank|glossary|vocabulary list|banque de mots|lexique/.test(text)) allowed.add('reference_list');
  if (/questions?|quiz|comprehension|compréhension/.test(text)) allowed.add('questions');
  if (/matching|match exercise|appariement|associer/.test(text)) allowed.add('matching');
  if (/gap[- ]?fill|fill[- ]?in|texte à trous|phrases? à trous/.test(text)) allowed.add('fill_blanks');
  if (/role[- ]?play|role cards?|jeu de rôles?/.test(text)) allowed.add('role_cards');
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

/**
 * Additions-only LLM call. The document body is already built locally; the
 * model only produces the explicitly requested extra blocks, which are then
 * filtered to the recognized addition types.
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
  const baseMessages: ChatMessage[] = [
    { role: 'system', content: SIMPLE_ADDITIONS_SYSTEM_PROMPT },
    { role: 'user', content: buildSimpleAdditionsUserPrompt(content, customRequest, documentType, level, languageFocus) },
  ];

  const attempts: ChatMessage[][] = [baseMessages];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const payload = await requestCompletion(config, attempts[attempt]);
    const result = SimpleAdditionsResponseSchema.safeParse(payload);
    if (result.success) {
      return result.data.additions.filter((block) => allowed.has(block.type));
    }

    console.error('[llm] Invalid additions shape:', result.error.flatten());
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
          'Use only the allowed block types.',
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
  emphasisTerms?: string[];
  templateId?: SimpleTemplateId;
  documentType?: DocumentType;
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
  const { title, level, languageFocus, customRequest } = options;
  const material = buildSimpleMaterial(content.trim(), {
    title,
    emphasisTerms: options.emphasisTerms,
    templateId: options.templateId,
    documentType: options.documentType,
    level,
    languageFocus,
    locale: options.locale,
  });
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

  const allowed = allowedSimpleAdditionTypes(customRequest);
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

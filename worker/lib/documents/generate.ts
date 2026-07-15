import { z } from 'zod';
import { presetForIndex } from './material-renderer';
import { buildGenerationContext, validateMaterials } from './input-context';
import { SIMPLE_SYSTEM_PROMPT, SYSTEM_PROMPT, buildSimpleUserPrompt, buildUserPrompt } from './system-prompt';
import {
  SimpleTransformDirectiveResponseSchema,
  TransformErrorSchema,
  TransformResponseSchema,
  type DocumentMode,
  type InputKind,
  type LessonTransformMaterial,
  type MaterialBlock,
  type OutputIntent,
  type SimpleTemplateId,
  type TransformMaterial,
  type TransformResponse,
} from './types';

const DEFAULT_MODEL = 'google/gemini-3.1-pro-preview';

export interface DocumentsLlmConfig {
  apiKey: string;
  model?: string;
  fetcher?: typeof fetch;
}

function resolveModel(config: DocumentsLlmConfig): string {
  return config.model?.trim() || DEFAULT_MODEL;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type LooseMaterial = Record<string, unknown>;
type LooseBlock = Record<string, unknown>;

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

function normalizeInteractionPattern(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['teacher_student', 'teacher_and_student', 'one_on_one', 'one_to_one', '1_1'].includes(normalized)) {
    return 'teacher_student';
  }
  if (['pair', 'pairs'].includes(normalized)) return 'pairs';
  if (['group', 'groups'].includes(normalized)) return 'group';
  if (['small_group', 'small_groups'].includes(normalized)) return 'small_group';
  if (['whole_class', 'class'].includes(normalized)) return 'whole_class';
  if (['individual', 'solo'].includes(normalized)) return 'individual';
  return normalized;
}

function normalizeSkillFocus(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'speaking practice') return 'speaking';
  if (normalized === 'reading comprehension') return 'reading';
  if (normalized === 'vocabulary practice') return 'vocabulary';
  if (normalized === 'grammar practice') return 'grammar';
  return normalized;
}

function blockTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((block) =>
      block && typeof block === 'object' && !Array.isArray(block)
        ? String((block as LooseBlock).type ?? '').trim().toLowerCase()
        : '',
    )
    .filter(Boolean);
}

function inferMaterialType(
  normalizedType: string,
  skillFocus: unknown,
  blocks: unknown,
): string {
  // Simple-mode handouts carry article blocks; don't reinterpret them as a quiz.
  if (normalizedType === 'clean_handout') return normalizedType;

  const skill = typeof skillFocus === 'string' ? skillFocus : '';
  const types = blockTypes(blocks);

  const aliases: Record<string, string> = {
    reading_comprehension: 'comprehension_quiz',
    reading_activity: 'comprehension_quiz',
    reading_worksheet: 'comprehension_quiz',
    comprehension: 'comprehension_quiz',
    vocabulary_practice: 'matching_exercise',
    vocabulary_worksheet: 'matching_exercise',
    vocabulary_sheet: 'matching_exercise',
    vocabulary_review: 'matching_exercise',
    speaking_activity: 'role_play_cards',
    speaking_task: 'role_play_cards',
    discussion_activity: 'role_play_cards',
    role_play: 'role_play_cards',
    roleplay: 'role_play_cards',
    guided_practice: 'controlled_practice',
    controlled_exercise: 'controlled_practice',
    fill_in_the_blanks: 'gap_fill_sentences',
    fill_in_the_blank: 'gap_fill_sentences',
  };

  if (aliases[normalizedType]) return aliases[normalizedType];

  if (types.includes('role_cards')) return 'role_play_cards';
  if (types.includes('matching')) return 'matching_exercise';
  if (types.includes('fill_blanks') && !types.includes('matching')) return 'gap_fill_sentences';
  if (types.includes('article') || types.includes('questions')) return 'comprehension_quiz';
  if (types.includes('reference_list') && skill === 'vocabulary') return 'matching_exercise';
  if (skill === 'speaking') return 'role_play_cards';
  if (skill === 'vocabulary') return 'matching_exercise';
  if (skill === 'reading') return 'comprehension_quiz';

  return normalizedType;
}

function pickMaterialsArray(payload: Record<string, unknown>): unknown[] | null {
  for (const key of ['materials', 'documents', 'outputs', 'items']) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

function normalizeMaterial(material: LooseMaterial): LooseMaterial {
  const blocks = material.blocks ?? material.sections ?? material.content_blocks;
  const skillFocus = normalizeSkillFocus(material.skill_focus ?? material.skill);
  const rawMaterialType = material.material_type ?? material.type;
  const normalizedMaterialType =
    typeof rawMaterialType === 'string' ? rawMaterialType.trim().toLowerCase().replace(/[\s-]+/g, '_') : rawMaterialType;

  return {
    ...material,
    material_type:
      typeof normalizedMaterialType === 'string'
        ? inferMaterialType(normalizedMaterialType, skillFocus, blocks)
        : normalizedMaterialType,
    title: material.title ?? material.name ?? material.material_title,
    skill_focus: skillFocus,
    interaction_pattern: normalizeInteractionPattern(
      material.interaction_pattern ?? material.interaction ?? material.delivery_mode,
    ),
    estimated_minutes:
      typeof (material.estimated_minutes ?? material.estimated_time ?? material.minutes) === 'string'
        ? Number.parseInt(String(material.estimated_minutes ?? material.estimated_time ?? material.minutes), 10)
        : material.estimated_minutes ?? material.estimated_time ?? material.minutes,
    blocks,
  };
}

function normalizePayloadShape(payload: unknown, expectedCount: number): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  const materials = pickMaterialsArray(record);
  if (!materials) return payload;

  return {
    materials: materials
      .slice(0, expectedCount)
      .map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? normalizeMaterial(item as LooseMaterial) : item)),
  };
}

function objectProperty(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const property = (value as Record<string, unknown>)[key];
  return property && typeof property === 'object' && !Array.isArray(property)
    ? property as Record<string, unknown>
    : {};
}

function buildResponseFormat(mode: DocumentMode): Record<string, unknown> {
  const expectedCount = mode === 'simple' ? 1 : 3;
  const responseSchema = mode === 'simple'
    ? SimpleTransformDirectiveResponseSchema
    : TransformResponseSchema;
  const schema = z.toJSONSchema(responseSchema, { target: 'draft-7' }) as Record<string, unknown>;
  delete schema.$schema;

  const properties = objectProperty(schema, 'properties');
  const materials = objectProperty(properties, 'materials');
  materials.minItems = expectedCount;
  materials.maxItems = expectedCount;

  // Simple mode has one semantic material type. Enforcing it here prevents
  // the model from drifting back toward a lesson activity before Zod parses it.
  if (expectedCount === 1) {
    const material = objectProperty(materials, 'items');
    const materialProperties = objectProperty(material, 'properties');
    const materialType = objectProperty(materialProperties, 'material_type');
    delete materialType.enum;
    materialType.const = 'clean_handout';
  }

  return {
    type: 'json_schema',
    json_schema: {
      name: expectedCount === 1 ? 'teachinspire_simple_document' : 'teachinspire_lesson_bundle',
      strict: true,
      schema,
    },
  };
}

async function requestCompletion(
  config: DocumentsLlmConfig,
  messages: ChatMessage[],
  mode: DocumentMode,
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
      model: resolveModel(config),
      messages,
      temperature: 0.15,
      max_tokens: 24000,
      response_format: buildResponseFormat(mode),
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

function sourcePhrase(content: string, requestedPhrase: string): string | null {
  const phrase = requestedPhrase.trim();
  if (!phrase) return null;
  const index = content.toLocaleLowerCase().indexOf(phrase.toLocaleLowerCase());
  return index === -1 ? null : content.slice(index, index + phrase.length);
}

function allowedSimpleAdditionTypes(request?: string): Set<MaterialBlock['type']> {
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

function isCompleteSourceStructure(
  structure: Array<{ type: string; line_ids: number[] }>,
  lineCount: number,
): boolean {
  const ids = structure.flatMap((block) => block.line_ids);
  if (ids.length !== lineCount || !ids.every((id, index) => id === index + 1)) return false;
  return structure.every((block) => block.type !== 'heading' || block.line_ids.length === 1);
}

function parseMaterials(
  payload: unknown,
  expectedCount: number,
  mode: DocumentMode,
  content: string,
  requestedTitle?: string,
  customRequest?: string,
  emphasisTerms: string[] = [],
  templateId: SimpleTemplateId = 'editorial_reader',
): TransformMaterial[] {
  const errorResult = TransformErrorSchema.safeParse(payload);
  if (errorResult.success) {
    throw new Error(errorResult.data.error);
  }

  const normalizedPayload = normalizePayloadShape(payload, expectedCount);
  if (mode === 'simple') {
    const simpleResult = SimpleTransformDirectiveResponseSchema.safeParse(normalizedPayload);
    if (!simpleResult.success) {
      console.error('[llm] Invalid simple response shape:', simpleResult.error.flatten());
      throw new Error('AI returned an unexpected structure. Try again.');
    }

    const allowedAdditions = allowedSimpleAdditionTypes(customRequest);
    return simpleResult.data.materials.map((material, index) => {
      const boldPhrases = [...emphasisTerms, ...material.bold_phrases]
        .map((phrase) => sourcePhrase(content, phrase))
        .filter((phrase): phrase is string => Boolean(phrase))
        .filter((phrase, phraseIndex, phrases) => (
          phrases.findIndex((candidate) => candidate.toLocaleLowerCase() === phrase.toLocaleLowerCase()) === phraseIndex
        ));
      const sourceLines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!isCompleteSourceStructure(material.structure, sourceLines.length)) {
        throw new Error('Simple document structure must cover every source line exactly once and in order.');
      }
      const headingPhrases = material.heading_phrases
        .map((phrase) => sourceLines.find((line) => line.localeCompare(phrase.trim(), undefined, { sensitivity: 'base' }) === 0))
        .filter((phrase): phrase is string => Boolean(phrase))
        .filter((phrase, phraseIndex, phrases) => (
          phrases.findIndex((candidate) => candidate.toLocaleLowerCase() === phrase.toLocaleLowerCase()) === phraseIndex
        ));
      return {
        material_type: 'clean_handout' as const,
        title: requestedTitle?.trim() || material.title,
        source_text: content,
        bold_phrases: boldPhrases,
        heading_phrases: headingPhrases,
        structure: material.structure,
        template_id: templateId,
        blocks: material.additions.filter((block) => allowedAdditions.has(block.type)),
        id: `material-${Date.now()}-${index}`,
        preset_id: presetForIndex(index),
      };
    });
  }

  const result = TransformResponseSchema.safeParse(normalizedPayload);
  if (!result.success) {
    console.error('[llm] Invalid response shape:', result.error.flatten());
    console.error(
      '[llm] Payload preview:',
      typeof normalizedPayload === 'string'
        ? normalizedPayload.slice(0, 1000)
        : JSON.stringify(normalizedPayload, null, 2).slice(0, 2000),
    );
    throw new Error('AI returned an unexpected structure. Try again.');
  }

  if (result.data.materials.length !== expectedCount) {
    throw new Error(`Expected exactly ${expectedCount} material(s), got ${result.data.materials.length}.`);
  }

  return result.data.materials.map((material, index) => ({
    ...material,
    id: `material-${Date.now()}-${index}`,
    preset_id: presetForIndex(index),
  }));
}

export async function callLLM(
  config: DocumentsLlmConfig,
  content: string,
  title?: string,
  level?: string,
  languageFocus?: string,
  inputKind: InputKind = 'auto',
  outputIntent: OutputIntent = 'three_materials',
  customRequest?: string,
  mode: DocumentMode = 'lesson',
  emphasisTerms: string[] = [],
  templateId: SimpleTemplateId = 'editorial_reader',
): Promise<TransformResponse> {
  const expectedCount = mode === 'simple' ? 1 : 3;
  const rawContext = buildGenerationContext(content, title, inputKind, outputIntent, customRequest);
  // Simple mode formats the teacher's content as-is: bundle-coverage rules don't apply.
  const context = mode === 'simple' ? { ...rawContext, requiredCoverage: [] } : rawContext;
  const baseMessages: ChatMessage[] =
    mode === 'simple'
      ? [
          { role: 'system', content: SIMPLE_SYSTEM_PROMPT },
          { role: 'user', content: buildSimpleUserPrompt(content, title, level, languageFocus, customRequest, emphasisTerms) },
        ]
      : [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(content, context, title, level, languageFocus) },
        ];

  const attempts: ChatMessage[][] = [baseMessages];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const payload = await requestCompletion(config, attempts[attempt], mode);

    let materials: TransformMaterial[];
    try {
      materials = parseMaterials(
        payload,
        expectedCount,
        mode,
        content,
        title,
        customRequest,
        emphasisTerms,
        templateId,
      );
    } catch (error) {
      if (attempt === 1) throw error;
      const message = error instanceof Error ? error.message : 'Invalid response structure.';
      attempts.push([
        ...baseMessages,
        {
          role: 'user',
          content: [
            'Your previous output did not match the required JSON structure.',
            `Regenerate from scratch and return only valid JSON with exactly ${expectedCount} material(s).`,
            mode === 'simple'
              ? 'The handout must include: material_type, title, bold_phrases, heading_phrases, structure, additions.'
              : 'Each material must include: material_type, title, skill_focus, interaction_pattern, estimated_minutes, blocks.',
            'Use only the allowed block types.',
            `Previous error: ${message}`,
          ].join('\n'),
        },
      ]);
      continue;
    }

    const validationErrors = mode === 'simple'
      ? []
      : validateMaterials(context, materials as LessonTransformMaterial[]);
    if (validationErrors.length === 0) {
      return { materials };
    }

    console.warn('[llm] Validation failed:', validationErrors);

    if (attempt === 1) {
      throw new Error(`AI output failed validation: ${validationErrors.join(' ')}`);
    }

    attempts.push([
      ...baseMessages,
      {
        role: 'user',
        content: [
          `Your previous output failed validation. Regenerate all ${expectedCount} material(s) from scratch.`,
          'Fix these issues exactly:',
          ...validationErrors.map((error) => `- ${error}`),
          'Do not explain. Return valid JSON only.',
        ].join('\n'),
      },
    ]);
  }

  throw new Error('AI generation failed after validation retries.');
}

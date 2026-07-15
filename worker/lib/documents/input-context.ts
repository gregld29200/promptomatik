import { z } from 'zod';
import type { InputKind, LessonTransformMaterial, OutputIntent } from './types';

const stopWords = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'your',
  'their',
  'into',
  'about',
  'daily',
  'life',
  'work',
  'adult',
  'adults',
  'english',
  'lesson',
  'professional',
  'professionals',
  'intermediate',
  'target',
  'audience',
  'topic',
  'minutes',
]);

const LessonPlanSchema = z.object({
  lesson_plan: z.object({
    lesson_overview: z.object({
      target_audience: z.string().optional(),
      topic: z.string().optional(),
      duration_minutes: z.number().optional(),
      objectives: z.array(z.string()).optional(),
    }).catchall(z.unknown()).optional(),
    materials: z.object({
      article: z.object({
        title: z.string().optional(),
        text: z.string().optional(),
      }).optional(),
    }).catchall(z.unknown()).optional(),
    sections: z.array(
      z.object({
        name: z.string().optional(),
        duration_minutes: z.number().optional(),
        activities: z.array(
          z.object({
            type: z.string().optional(),
            instructions: z.string().optional(),
          }).catchall(z.unknown()),
        ).optional(),
      }).catchall(z.unknown()),
    ).optional(),
  }).catchall(z.unknown()),
});
type LessonPlanData = z.infer<typeof LessonPlanSchema>['lesson_plan'];

type CoverageStage = 'reading' | 'guided_practice' | 'freer_practice';
type NormalizedSourceType = 'lesson_plan' | 'curriculum' | 'worksheet_spec' | 'assessment_spec' | 'structured_spec' | 'raw_content';

export interface GenerationContext {
  inputMode: NormalizedSourceType;
  sourceContent: string;
  canonicalTopic: string | null;
  titleHint: string | null;
  audience: string | null;
  isOneOnOne: boolean;
  requiredCoverage: CoverageStage[];
  topicKeywords: string[];
  sourceLower: string;
  outputIntent: OutputIntent;
  customRequest: string | null;
  requestedBundle: string;
}

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 4 && !stopWords.has(part)),
    ),
  );
}

function inferCoverageFromSections(sections: Array<{ name?: string; activities?: Array<{ type?: string }> }> | undefined): CoverageStage[] {
  if (!sections?.length) {
    return ['reading', 'guided_practice', 'freer_practice'];
  }

  const stages = new Set<CoverageStage>();

  for (const section of sections) {
    const blob = [
      section.name || '',
      ...(section.activities || []).map((activity) => activity.type || ''),
    ].join(' ').toLowerCase();

    if (/(reading|article|comprehension)/.test(blob)) {
      stages.add('reading');
    }
    if (/(exercise|guided|vocabulary|grammar|matching|fill|practice)/.test(blob)) {
      stages.add('guided_practice');
    }
    if (/(role-?play|discussion|writing|freer|wrap-up|reflection|goal)/.test(blob)) {
      stages.add('freer_practice');
    }
  }

  return stages.size > 0
    ? Array.from(stages)
    : ['reading', 'guided_practice', 'freer_practice'];
}

function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function buildGenerationContext(
  content: string,
  title?: string,
  inputKind: InputKind = 'auto',
  outputIntent: OutputIntent = 'three_materials',
  customRequest?: string,
): GenerationContext {
  const trimmedContent = content.trim();
  const parsed = LessonPlanSchema.safeParse(parseJsonSafely(trimmedContent));
  const trimmedRequest = customRequest?.trim() || null;

  const forceStructured = inputKind !== 'auto' && inputKind !== 'raw_content';

  if (parsed.success || forceStructured) {
    const parsedData = parsed.success ? parsed.data.lesson_plan : undefined;
    const sourceType: NormalizedSourceType =
      inputKind === 'curriculum'
        ? 'curriculum'
        : inputKind === 'worksheet_spec'
          ? 'worksheet_spec'
          : inputKind === 'assessment_spec'
            ? 'assessment_spec'
            : inputKind === 'other_structured_spec'
              ? 'structured_spec'
              : 'lesson_plan';

    const lessonPlan: Partial<LessonPlanData> = parsedData ?? {};
    const audience = lessonPlan.lesson_overview?.target_audience?.trim() || null;
    const canonicalTopic =
      lessonPlan.lesson_overview?.topic?.trim()
      || lessonPlan.materials?.article?.title?.trim()
      || title?.trim()
      || null;

    const topicKeywords = tokenize(
      [canonicalTopic, lessonPlan.materials?.article?.title, title, trimmedRequest]
        .filter(Boolean)
        .join(' '),
    );

    return {
      inputMode: sourceType,
      sourceContent: trimmedContent,
      canonicalTopic,
      titleHint: title?.trim() || null,
      audience,
      isOneOnOne: /\bone-on-one\b|\b1:1\b|\bone to one\b/i.test(audience || ''),
      requiredCoverage: inferCoverageFromSections(lessonPlan.sections),
      topicKeywords,
      sourceLower: trimmedContent.toLowerCase(),
      outputIntent,
      customRequest: trimmedRequest,
      requestedBundle: buildRequestedBundleLabel(outputIntent),
    };
  }

  const canonicalTopic = title?.trim() || null;
  return {
    inputMode: 'raw_content',
    sourceContent: trimmedContent,
    canonicalTopic,
    titleHint: title?.trim() || null,
    audience: null,
    isOneOnOne: false,
    requiredCoverage: [],
    topicKeywords: tokenize([canonicalTopic, trimmedContent.slice(0, 200), trimmedRequest].filter(Boolean).join(' ')),
    sourceLower: trimmedContent.toLowerCase(),
    outputIntent,
    customRequest: trimmedRequest,
    requestedBundle: buildRequestedBundleLabel(outputIntent),
  };
}

function buildRequestedBundleLabel(outputIntent: OutputIntent): string {
  switch (outputIntent) {
    case 'lesson_pack':
      return 'a coherent 3-document lesson pack';
    case 'assessment_pack':
      return 'a 3-document assessment pack';
    case 'unit_snapshot':
      return 'a 3-document unit snapshot';
    case 'custom':
      return 'a 3-document custom bundle';
    case 'three_materials':
    default:
      return '3 classroom materials';
  }
}

const readingTypes = new Set([
  'comprehension_quiz',
  'vocabulary_in_context',
  'summary_completion',
  'headline_matching',
  'text_reconstruction',
  'comprehension_check',
  'timeline_exercise',
]);

const guidedTypes = new Set([
  'gap_fill',
  'matching_exercise',
  'gap_fill_sentences',
  'controlled_practice',
  'error_correction',
  'sorting_exercise',
  'word_formation_table',
  'categorization_grid',
  'rule_summary_card',
  'phrase_bank_extraction',
  'sequencing_exercise',
  'imperative_extraction',
  'transformation_exercise',
]);

const freerTypes = new Set([
  'role_play_cards',
  'discussion_cards',
  'guided_production',
  'reply_template',
  'prediction_exercise',
]);

function titleAndText(material: LessonTransformMaterial): string {
  const blockText = material.blocks.flatMap((block) => {
    switch (block.type) {
      case 'instructions':
        return [block.heading || '', block.text, ...(block.bullets || []), ...(block.word_bank || [])];
      case 'notes':
        return [block.heading || '', block.text, ...(block.bullets || [])];
      case 'article':
        return [block.heading || '', block.title || '', ...block.paragraphs];
      case 'questions':
        return [block.heading || '', ...block.items.flatMap((item) => [item.prompt, item.answer])];
      case 'reference_list':
        return [block.heading || '', ...block.items.flatMap((item) => [item.term, item.detail, item.example || ''])];
      case 'matching':
        return [block.heading || '', ...block.pairs.flatMap((pair) => [pair.left, pair.right])];
      case 'fill_blanks':
        return [block.heading || '', ...(block.word_bank || []), ...block.items.flatMap((item) => [item.sentence, item.answer])];
      case 'role_cards':
        return [block.heading || '', ...block.cards.flatMap((card) => [card.role, card.situation, card.goal, ...(card.bullets || []), ...(card.prompts || [])])];
      default:
        return [];
    }
  });

  return `${material.title} ${blockText.join(' ')}`.toLowerCase();
}

function sourceContainsPhrase(context: GenerationContext, phrase: string): boolean {
  return context.sourceLower.includes(phrase.toLowerCase());
}

export function validateMaterials(context: GenerationContext, materials: LessonTransformMaterial[]): string[] {
  const errors: string[] = [];

  if (context.isOneOnOne) {
    const invalidInteraction = materials.find((material) =>
      ['pairs', 'group', 'small_group', 'whole_class'].includes(material.interaction_pattern),
    );
    if (invalidInteraction) {
      errors.push(
        `Interaction pattern "${invalidInteraction.interaction_pattern}" is not valid for a one-on-one lesson.`,
      );
    }
  }

  for (const material of materials) {
    const text = titleAndText(material);

    if (
      context.inputMode === 'lesson_plan'
      && context.topicKeywords.length > 0
      && !context.topicKeywords.some((keyword) => text.includes(keyword))
    ) {
      errors.push(`Material title/topic drift detected in "${material.title}".`);
    }

    if (context.isOneOnOne && /\bpartner\b|\bpairs?\b|\bsmall groups?\b/.test(text)) {
      errors.push(`One-on-one lesson output still uses pair/group wording in "${material.title}".`);
    }

    if (!sourceContainsPhrase(context, 'price negotiation') && text.includes('price negotiation')) {
      errors.push(`Stale example topic leaked into "${material.title}".`);
    }

    if (!sourceContainsPhrase(context, 'negotiation dialogue') && text.includes('negotiation dialogue')) {
      errors.push(`Stale example dialogue leaked into "${material.title}".`);
    }

    if (text.includes("i'm feeling a bit overwhelming") || text.includes('i am feeling a bit overwhelming')) {
      errors.push(`Language quality issue detected in "${material.title}".`);
    }
  }

  if (context.requiredCoverage.includes('reading') && !materials.some((material) => readingTypes.has(material.material_type))) {
    errors.push('Lesson-plan mode requires one reading/comprehension material.');
  }

  if (context.requiredCoverage.includes('guided_practice') && !materials.some((material) => guidedTypes.has(material.material_type))) {
    errors.push('Lesson-plan mode requires one guided-practice material.');
  }

  if (context.requiredCoverage.includes('freer_practice') && !materials.some((material) => freerTypes.has(material.material_type))) {
    errors.push('Lesson-plan mode requires one freer-practice material.');
  }

  return errors;
}

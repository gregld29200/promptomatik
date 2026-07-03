import { z } from 'zod';

export const MaterialTypeSchema = z.enum([
  'gap_fill',
  'comprehension_quiz',
  'role_play_cards',
  'sentence_reordering',
  'matching_exercise',
  'dictogloss_notes',
  'vocabulary_in_context',
  'summary_completion',
  'headline_matching',
  'discussion_cards',
  'text_reconstruction',
  'categorization_grid',
  'gap_fill_sentences',
  'odd_one_out',
  'word_formation_table',
  'flashcard_sheet',
  'rule_summary_card',
  'controlled_practice',
  'error_correction',
  'sorting_exercise',
  'guided_production',
  'register_analysis',
  'reply_template',
  'phrase_bank_extraction',
  'sequencing_exercise',
  'imperative_extraction',
  'comprehension_check',
  'transformation_exercise',
  'timeline_exercise',
  'character_analysis_card',
  'prediction_exercise',
]);

export const SkillFocusSchema = z.enum([
  'reading',
  'writing',
  'speaking',
  'listening',
  'grammar',
  'vocabulary',
  'mixed',
]);

export const InteractionPatternSchema = z.enum([
  'individual',
  'teacher_student',
  'pairs',
  'group',
  'small_group',
  'whole_class',
]);

export const StylePresetSchema = z.enum([
  'studio_academic',
  'modern_training',
  'warm_coaching',
]);

const BlockBaseSchema = z.object({
  heading: z.string().optional(),
});

export const InstructionsBlockSchema = BlockBaseSchema.extend({
  type: z.literal('instructions'),
  text: z.string().min(1),
  bullets: z.array(z.string()).optional(),
  word_bank: z.array(z.string()).optional(),
});

export const ArticleBlockSchema = BlockBaseSchema.extend({
  type: z.literal('article'),
  title: z.string().optional(),
  paragraphs: z.array(z.string().min(1)).min(1),
});

export const QuestionsBlockSchema = BlockBaseSchema.extend({
  type: z.literal('questions'),
  items: z.array(
    z.object({
      prompt: z.string().min(1),
      answer: z.string().min(1),
    }),
  ).min(1),
});

export const ReferenceListBlockSchema = BlockBaseSchema.extend({
  type: z.literal('reference_list'),
  items: z.array(
    z.object({
      term: z.string().min(1),
      detail: z.string().min(1),
      example: z.string().optional(),
    }),
  ).min(1),
});

export const MatchingBlockSchema = BlockBaseSchema.extend({
  type: z.literal('matching'),
  pairs: z.array(
    z.object({
      left: z.string().min(1),
      right: z.string().min(1),
    }),
  ).min(2),
});

export const FillBlanksBlockSchema = BlockBaseSchema.extend({
  type: z.literal('fill_blanks'),
  word_bank: z.array(z.string()).optional(),
  items: z.array(
    z.object({
      sentence: z.string().min(1),
      answer: z.string().min(1),
    }),
  ).min(1),
});

export const RoleCardsBlockSchema = BlockBaseSchema.extend({
  type: z.literal('role_cards'),
  cards: z.array(
    z.object({
      role: z.string().min(1),
      situation: z.string().min(1),
      goal: z.string().min(1),
      bullets: z.array(z.string()).optional(),
      prompts: z.array(z.string()).optional(),
    }),
  ).min(2).max(2),
});

export const NotesBlockSchema = BlockBaseSchema.extend({
  type: z.literal('notes'),
  text: z.string().min(1),
  bullets: z.array(z.string()).optional(),
});

export const MaterialBlockSchema = z.discriminatedUnion('type', [
  InstructionsBlockSchema,
  ArticleBlockSchema,
  QuestionsBlockSchema,
  ReferenceListBlockSchema,
  MatchingBlockSchema,
  FillBlanksBlockSchema,
  RoleCardsBlockSchema,
  NotesBlockSchema,
]);

export const MaterialSchema = z.object({
  material_type: MaterialTypeSchema,
  title: z.string().min(1),
  skill_focus: SkillFocusSchema,
  interaction_pattern: InteractionPatternSchema,
  estimated_minutes: z.number().int().positive(),
  blocks: z.array(MaterialBlockSchema).min(1),
});

export const TransformResponseSchema = z.object({
  materials: z.tuple([MaterialSchema, MaterialSchema, MaterialSchema]),
});

export const TransformErrorSchema = z.object({
  error: z.string().min(1),
});

export type MaterialType = z.infer<typeof MaterialTypeSchema>;
export type SkillFocus = z.infer<typeof SkillFocusSchema>;
export type InteractionPattern = z.infer<typeof InteractionPatternSchema>;
export type StylePreset = z.infer<typeof StylePresetSchema>;
export type MaterialBlock = z.infer<typeof MaterialBlockSchema>;
export type TransformMaterial = z.infer<typeof MaterialSchema> & {
  id: string;
  preset_id: StylePreset;
};
export type TransformResponse = {
  materials: TransformMaterial[];
};

export type AppStep = 'input' | 'transforming' | 'picking' | 'preview';

export const InputKindSchema = z.enum([
  'auto',
  'raw_content',
  'lesson_plan',
  'curriculum',
  'worksheet_spec',
  'assessment_spec',
  'other_structured_spec',
]);

export const OutputIntentSchema = z.enum([
  'three_materials',
  'lesson_pack',
  'assessment_pack',
  'unit_snapshot',
  'custom',
]);

export type InputKind = z.infer<typeof InputKindSchema>;
export type OutputIntent = z.infer<typeof OutputIntentSchema>;

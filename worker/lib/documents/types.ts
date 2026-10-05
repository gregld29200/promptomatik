import { z } from 'zod';
import type { ListItemKind, SimpleBlockType } from './simple-structure';

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
  'clean_handout',
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

export const SimpleTemplateSchema = z.enum([
  'editorial_reader',
  'classroom_handout',
  'compact_professional',
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

// Simple mode is deterministic: the worker parses structure, title, and bold
// phrases locally (simple-structure.ts). The model is only consulted for
// explicitly requested additions, and returns just those blocks.
export const SimpleAdditionsResponseSchema = z.object({
  additions: z.array(MaterialBlockSchema).min(1).max(4),
});

// Structure rescue: when the local parser detects its own failure (a paste so
// mangled it collapses into a blob), a light model may re-classify lines —
// directives only, the source text itself never passes through the model.
export const SimpleStructureRescueResponseSchema = z.object({
  structure: z.array(z.object({
    type: z.enum(['heading', 'paragraph', 'bullet_list', 'numbered_list']),
    line_ids: z.array(z.number().int().positive()).min(1),
  })).min(1),
});

export const TransformResponseSchema = z.object({
  materials: z.array(MaterialSchema).min(1).max(3),
});

export const TransformErrorSchema = z.object({
  error: z.string().min(1),
});

export type MaterialType = z.infer<typeof MaterialTypeSchema>;
export type SkillFocus = z.infer<typeof SkillFocusSchema>;
export type InteractionPattern = z.infer<typeof InteractionPatternSchema>;
export type StylePreset = z.infer<typeof StylePresetSchema>;
export type SimpleTemplateId = z.infer<typeof SimpleTemplateSchema>;
export type MaterialBlock = z.infer<typeof MaterialBlockSchema>;
export type LessonTransformMaterial = z.infer<typeof MaterialSchema> & {
  id: string;
  preset_id: StylePreset;
};
export type SimpleTransformMaterial = {
  material_type: 'clean_handout';
  title: string;
  /** Optional only so previously completed jobs continue to render. */
  source_text?: string;
  bold_phrases?: string[];
  heading_phrases?: string[];
  template_id?: SimpleTemplateId;
  /** Optional so legacy jobs render as plain reading material. */
  document_type?: DocumentType;
  level?: string;
  language_focus?: string;
  /** UI language at generation time; drives print chrome labels. */
  locale?: string;
  /** Defaults to portrait; calendars default to landscape. */
  orientation?: DocumentOrientation;
  design?: DocumentDesign;
  /** Set when the teacher asked for something the additions step cannot do. */
  request_status?: 'applied' | 'not_applied';
  structure?: Array<{
    type: SimpleBlockType;
    line_ids: number[];
    level?: 2 | 3;
    depths?: number[];
    kinds?: ListItemKind[];
  }>;
  blocks: MaterialBlock[];
  id: string;
  preset_id: StylePreset;
};
export type TransformMaterial = LessonTransformMaterial | SimpleTransformMaterial;
export type TransformResponse = {
  materials: TransformMaterial[];
};

export type AppStep = 'input' | 'transforming' | 'picking' | 'preview';

// Every document type formats the teacher's own content deterministically;
// none of them generate teaching content. "free" and "reading" carry no print
// chrome; the others add purpose-specific chrome (badge, name/date line,
// meta strip, cut lines, checkboxes) around the same teacher-owned text.
// The catalogue mirrors what the TeachInspire course actually produces.
export const DOCUMENT_TYPES = [
  'free',
  'reading',
  'worksheet',
  'role_cards',
  'dialogue_script',
  'teacher_guide',
  'lesson_plan',
  'session_plan',
  'checklist',
  'learner_profile',
  'course_brief',
  'course_calendar',
] as const;
export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);

export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const DocumentOrientationSchema = z.enum(['portrait', 'landscape']);
export type DocumentOrientation = z.infer<typeof DocumentOrientationSchema>;

// Teacher design overrides on top of a style (Documents › Personnaliser).
// Presentation only: none of these touch the teacher's words.
export const HEADING_FONTS = ['cormorant', 'fraunces', 'playfair', 'space_grotesk', 'inter', 'manrope'] as const;
export const BODY_FONTS = ['source_sans', 'nunito_sans', 'manrope', 'inter'] as const;
export const DocumentDesignSchema = z.object({
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  headingFont: z.enum(HEADING_FONTS).optional(),
  bodyFont: z.enum(BODY_FONTS).optional(),
  density: z.enum(['airy', 'standard', 'compact']).optional(),
  header: z.enum(['rule', 'band', 'frame']).optional(),
  logoImageId: z.string().regex(/^[A-Za-z0-9_-]{6,40}$/).optional(),
  footerText: z.string().trim().max(120).optional(),
}).strict();
export type DocumentDesign = z.infer<typeof DocumentDesignSchema>;

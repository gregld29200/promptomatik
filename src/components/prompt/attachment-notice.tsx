import type { PromptBlock } from '@/lib/api';

/** Derived from editable blocks so saving, duplication and editing cannot leave a stale notice. */
export function AttachmentNotice({ blocks }: { blocks: PromptBlock[] }) {
  const requirements = blocks.filter(block => block.attachment_requirements && block.content.trim());
  if (!requirements.length) return null;
  return <aside aria-live="polite" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginBlock: '1rem' }}>
    {requirements.map((block, i) => <p key={i}>{block.content}</p>)}
  </aside>;
}

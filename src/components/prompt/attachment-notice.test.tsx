import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AttachmentNotice } from './attachment-notice';
import type { PromptBlock } from '@/lib/api';

it('shows current editable requirements as text and follows edits/removal', () => {
  const block: PromptBlock = { technique: 'constraints', content: 'Attach <script>alert(1)</script>.pdf', attachment_requirements: true, annotation: '', order: 1 };
  const html = renderToStaticMarkup(<AttachmentNotice blocks={[block]} />);
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(renderToStaticMarkup(<AttachmentNotice blocks={[{ ...block, content: 'Attach revised.docx' }]} />)).toContain('revised.docx');
  expect(renderToStaticMarkup(<AttachmentNotice blocks={[]} />)).toBe('');
});

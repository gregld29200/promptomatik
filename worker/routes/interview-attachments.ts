import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { Env } from '../env';
import type { SessionData } from '../lib/session';
import { requireAuth } from '../lib/auth-middleware';
import { ATTACHMENT_LIMITS as L } from '../../shared/attachments';
import { extractAttachment, AttachmentError } from '../lib/attachments/extract';
import { addAttachment, createContext, requireContext } from '../lib/attachments/context';

export const interviewAttachments = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();
interviewAttachments.use('/*', requireAuth);
interviewAttachments.onError((error, c) => {
  if (error instanceof AttachmentError) return c.json({ error: error.code, code: error.code }, 400);
  return c.json({ error: 'storage', code: 'storage' }, 500);
});
interviewAttachments.post('/', async c => {
  const contextId = await createContext(c.env.DB, c.get('session').userId);
  return c.json({ contextId }, 201);
});
interviewAttachments.post('/:id/files', bodyLimit({ maxSize: L.fileBytes + 64 * 1024,
  onError: c => c.json({ error: 'file_size', code: 'file_size' }, 413) }), async c => {
  const id = z.uuid().parse(c.req.param('id'));
  const userId = c.get('session').userId;
  await requireContext(c.env.DB, userId, id, true);
  let form: FormData;
  try { form = await c.req.formData(); } catch { throw new AttachmentError('unreadable'); }
  const file: unknown = form.get('file');
  if (!(file instanceof File) || [...form.keys()].length !== 1) throw new AttachmentError('format');
  const doc = await extractAttachment(file);
  await addAttachment(c.env.DB, userId, id, doc);
  const { text: _text, ...info } = doc;
  return c.json({ document: info }, 201);
});
interviewAttachments.delete('/:id/files/:fileId', async c => {
  const id = c.req.param('id');
  const userId = c.get('session').userId;
  await requireContext(c.env.DB, userId, id, true);
  await c.env.DB.prepare(`DELETE FROM interview_attachments WHERE id = ? AND context_id = ? AND EXISTS
    (SELECT 1 FROM interview_contexts WHERE id = ? AND user_id = ? AND sealed = 0 AND expires_at > ?)`)
    .bind(c.req.param('fileId'), id, id, userId, Math.floor(Date.now() / 1000)).run();
  return c.json({ success: true });
});

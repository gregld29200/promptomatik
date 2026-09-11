import { ATTACHMENT_LIMITS as L, type AttachmentSource } from '../../../shared/attachments';
import { AttachmentError } from './errors';

export async function requireContext(db: D1Database, userId: string, id: string, editable = false) {
  const row = await db.prepare('SELECT id, sealed FROM interview_contexts WHERE id = ? AND user_id = ? AND expires_at > ?')
    .bind(id, userId, Math.floor(Date.now() / 1000)).first<{ id: string; sealed: number }>();
  if (!row) throw new AttachmentError('expired');
  if (editable && row.sealed) throw new AttachmentError('sealed');
  return row;
}

export async function createContext(db: D1Database, userId: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  // Bound abandoned uploads per user, including API callers bypassing the UI.
  const result = await db.prepare(`INSERT INTO interview_contexts (id, user_id, expires_at)
    SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM interview_contexts WHERE user_id = ? AND expires_at > ?) < 20`)
    .bind(id, userId, now + L.lifetimeSeconds, userId, now).run();
  if (!result.meta.changes) throw new AttachmentError('contexts');
  return id;
}

export async function addAttachment(db: D1Database, userId: string, contextId: string, doc: AttachmentSource) {
  // One atomic statement enforces all aggregate limits even for concurrent uploads.
  const result = await db.prepare(`INSERT INTO interview_attachments (id, context_id, name, type, size, characters, text)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM interview_contexts WHERE id = ? AND user_id = ? AND sealed = 0 AND expires_at > ?)
    AND (SELECT COUNT(*) FROM interview_attachments WHERE context_id = ?) < ?
    AND (SELECT COALESCE(SUM(size), 0) FROM interview_attachments WHERE context_id = ?) + ? <= ?
    AND (SELECT COALESCE(SUM(characters), 0) FROM interview_attachments WHERE context_id = ?) + ? <= ?`)
    .bind(doc.id, contextId, doc.name, doc.type, doc.size, doc.characters, doc.text,
      contextId, userId, Math.floor(Date.now() / 1000), contextId, L.files,
      contextId, doc.size, L.totalBytes, contextId, doc.characters, L.characters).run();
  if (!result.meta.changes) throw new AttachmentError('total');
}

export async function readContext(db: D1Database, userId: string, id?: string): Promise<AttachmentSource[]> {
  if (!id) return [];
  await requireContext(db, userId, id);
  const result = await db.prepare(`SELECT a.id, a.name, a.type, a.size, a.characters, a.text FROM interview_attachments a
    JOIN interview_contexts c ON c.id = a.context_id WHERE a.context_id = ?
    AND (c.sealed = 0 OR a.id IN (SELECT value FROM json_each(c.selection)))`)
    .bind(id).all<AttachmentSource>();
  return result.results;
}

export async function sealContext(db: D1Database, userId: string, id: string, documentIds: string[]) {
  const context = await requireContext(db, userId, id);
  const documents = await readContext(db, userId, id);
  if (new Set(documentIds).size !== documentIds.length || documentIds.some(docId => !documents.some(doc => doc.id === docId))) {
    throw new AttachmentError('unreadable');
  }
  if (context.sealed) {
    if (documents.length !== documentIds.length) throw new AttachmentError('sealed');
    return;
  }
  // Freeze exactly the acknowledged selection. A timed-out upload is never
  // silently included, even if it completed on the server after the client left.
  const result = await db.batch([
    db.prepare('UPDATE interview_contexts SET sealed = 1, selection = ? WHERE id = ? AND user_id = ? AND expires_at > ? AND sealed = 0')
      .bind(JSON.stringify(documentIds), id, userId, Math.floor(Date.now() / 1000)),
    db.prepare(`DELETE FROM interview_attachments WHERE context_id = ? AND id NOT IN
      (SELECT value FROM interview_contexts c, json_each(c.selection) WHERE c.id = ? AND c.sealed = 1)
      AND EXISTS (SELECT 1 FROM interview_contexts WHERE id = ? AND sealed = 1)`)
      .bind(id, id, id),
  ]);
  if (!result[0].meta.changes) throw new AttachmentError('expired');
}

export async function purgeAttachmentContexts(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  // Derived intent, answers and generated results may contain source facts too.
  // Purge these transient copies, leaving explicitly saved prompts untouched.
  await db.batch([
    db.prepare(`DELETE FROM interview_jobs WHERE json_extract(request_payload, '$.document_context_id') IN
      (SELECT id FROM interview_contexts WHERE expires_at <= ?)` ).bind(now),
    db.prepare('DELETE FROM interview_attachments WHERE context_id IN (SELECT id FROM interview_contexts WHERE expires_at <= ?)').bind(now),
    db.prepare('DELETE FROM interview_contexts WHERE expires_at <= ?').bind(now),
  ]);
}

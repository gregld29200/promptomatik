import { useRef, useState } from 'react';
import * as api from '../api';
import { ATTACHMENT_LIMITS as L, attachmentType, type AttachmentInfo } from '../../../shared/attachments';

export interface AttachmentItem {
  localId: string;
  name: string;
  size: number;
  state: 'reading' | 'ready' | 'error';
  document?: AttachmentInfo;
  error?: string;
}

export function useAttachments() {
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectionError, setSelectionError] = useState<string>();
  const errorCode = (code?: string) => code === 'network_error' || code === 'request_timeout' ? 'storage' : code ?? 'storage';
  const contextId = useRef<string | undefined>(undefined);
  const lock = useRef(false);
  const update = (localId: string, changes: Partial<AttachmentItem>) =>
    setItems(previous => previous.map(item => item.localId === localId ? { ...item, ...changes } : item));

  async function add(files: File[]) {
    if (lock.current || !files.length) return;
    if (items.length + files.length > L.files) { setSelectionError('count'); return; }
    setSelectionError(undefined);
    lock.current = true;
    setBusy(true);
    let total = items.reduce((sum, item) => sum + item.size, 0);
    const next = files.map(file => {
      total += file.size;
      const error = !attachmentType(file.name) ? 'format' : file.size > L.fileBytes ? 'file_size' : total > L.totalBytes ? 'total' : undefined;
      return { localId: crypto.randomUUID(), name: file.name, size: file.size,
        state: error ? 'error' as const : 'reading' as const, error };
    });
    setItems(previous => [...previous, ...next]);
    try {
      for (let i = 0; i < files.length; i++) {
        const item = next[i];
        if (item.error) continue;
        if (!contextId.current) {
          const context = await api.createAttachmentContext();
          if (context.error) { update(item.localId, { state: 'error', error: errorCode(context.error.code) }); continue; }
          contextId.current = context.data.contextId;
        }
        const result = await api.uploadInterviewAttachment(contextId.current, files[i]);
        update(item.localId, result.error
          ? { state: 'error', error: errorCode(result.error.code) }
          : { state: 'ready', document: result.data.document });
      }
    } catch {
      setItems(previous => previous.map(item => item.state === 'reading' ? { ...item, state: 'error', error: 'storage' } : item));
    } finally { lock.current = false; setBusy(false); }
  }

  async function remove(item: AttachmentItem) {
    if (lock.current) return;
    if (item.document && contextId.current) {
      lock.current = true;
      setBusy(true);
      try {
        const result = await api.removeInterviewAttachment(contextId.current, item.document.id);
        if (result.error) { update(item.localId, { state: 'error', error: errorCode(result.error.code) }); return; }
      } catch { update(item.localId, { state: 'error', error: 'storage' }); return;
      } finally { lock.current = false; setBusy(false); }
    }
    setItems(previous => previous.filter(row => row.localId !== item.localId));
    setSelectionError(undefined);
  }

  function reset() { contextId.current = undefined; setItems([]); setSelectionError(undefined); }
  return { items, busy, selectionError, add, remove, reset,
    clearSelectionError: () => setSelectionError(undefined),
    documentIds: items.flatMap(item => item.document ? [item.document.id] : []),
    contextId: items.some(item => item.document) ? contextId.current : undefined,
    blocked: busy || !!selectionError || items.some(item => item.state !== 'ready') };
}

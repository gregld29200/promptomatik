import { useRef } from 'react';
import { Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { useAttachments } from '@/lib/hooks/use-attachments';
import s from './attachments.module.css';

export function Attachments({ attachments: a }: { attachments: ReturnType<typeof useAttachments> }) {
  const input = useRef<HTMLInputElement>(null);
  return <section className={s.attachments} aria-label={t('attachments.title')}>
    <input ref={input} type="file" hidden multiple accept=".pdf,.docx,.txt,.md,.markdown"
      onChange={event => { void a.add(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    <Button type="button" variant="ghost" disabled={a.busy} onClick={() => input.current?.click()}>
      <Paperclip size={18} aria-hidden="true" /> {t('attachments.title')}
    </Button>
    <p className={s.note}>{t('attachments.limits')}</p>
    {a.selectionError && <div role="alert">
      <p>{t(`attachments.errors.${a.selectionError}`)}</p>
      <Button type="button" variant="ghost" onClick={a.clearSelectionError}>{t('attachments.clearSelection')}</Button>
    </div>}
    <ul className={s.list} aria-live="polite" aria-relevant="all">
      {a.items.map(item => <li key={item.localId} className={s.item}>
        <div>
          <strong>{item.name}</strong> · {item.size < 1024 ? `${item.size} B` : `${(item.size / 1024).toFixed(1)} KB`}
          <p>{t(`attachments.${item.state}`)}</p>
          {item.error && <p role="alert" className={s.error}>{t(`attachments.errors.${item.error}`)}</p>}
        </div>
        <Button type="button" variant="ghost" disabled={a.busy}
          aria-label={`${t('attachments.remove')} ${item.name}`} onClick={() => void a.remove(item)}>
          <X size={18} aria-hidden="true" />
        </Button>
      </li>)}
    </ul>
    <p className={s.note}>{t('attachments.privacy')}</p>
  </section>;
}

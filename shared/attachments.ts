/** Shared limits: uploads are sent and extracted one at a time. */
export const ATTACHMENT_LIMITS = {
  files: 5,
  fileBytes: 10 * 1024 * 1024,
  totalBytes: 20 * 1024 * 1024,
  characters: 100_000,
  modelInputBytes: 180_000,
  lifetimeSeconds: 24 * 60 * 60,
  pdfPages: 100,
  extractionMs: 15_000,
  archiveBytes: 20 * 1024 * 1024,
  archiveEntries: 500,
  xmlPartBytes: 2 * 1024 * 1024,
  xmlElements: 50_000,
  xmlDepth: 100,
} as const;

export interface AttachmentInfo {
  id: string;
  name: string;
  type: string;
  size: number;
  characters: number;
}

export interface AttachmentSource extends AttachmentInfo {
  text: string;
}

export function attachmentType(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext && ['pdf', 'docx', 'txt', 'md', 'markdown'].includes(ext) ? ext : null;
}

export class AttachmentError extends Error {
  constructor(public readonly code: string) { super(code); }
}

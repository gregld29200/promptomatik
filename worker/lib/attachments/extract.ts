import { Unzip, UnzipInflate } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { getResolvedPDFJS } from 'unpdf';
import { isBlankPdfPage } from './pdf-blank-page';
import { ATTACHMENT_LIMITS as L, attachmentType, type AttachmentSource } from '../../../shared/attachments';

import { AttachmentError } from './errors';
export { AttachmentError } from './errors';
const fail = (code: string): never => { throw new AttachmentError(code); };

function decode(bytes: Uint8Array): string {
  try {
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    const text = new TextDecoder(encoding, { fatal: true, ignoreBOM: false }).decode(bytes);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) fail('unreadable');
    return text.replace(/\r\n?/g, '\n');
  } catch { return fail('unreadable'); }
}

function checkText(text: string): string {
  if (text.length > L.characters) fail('characters');
  if (!text.trim()) fail('unreadable');
  return text.trim();
}

// Streaming ZIP inflation bounds actual output, not attacker-declared sizes.
function docxText(bytes: Uint8Array, deadline: number): string {
  const parts = new Map<string, Uint8Array[]>();
  let entries = 0;
  let expanded = 0;
  const unzip = new Unzip((entry) => {
    if (++entries > L.archiveEntries || Date.now() > deadline) fail('complex');
    if (/vbaProject|embeddings\//i.test(entry.name)) fail('unreadable');
    if (parts.has(entry.name)) fail('unreadable');
    const wanted = entry.name === '[Content_Types].xml' || /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(entry.name);
    if (!wanted) return;
    const chunks: Uint8Array[] = [];
    let partBytes = 0;
    parts.set(entry.name, chunks);
    entry.ondata = (error, data) => {
      if (error) { if (error instanceof AttachmentError) throw error; fail('unreadable'); }
      expanded += data.length;
      partBytes += data.length;
      if (expanded > L.archiveBytes || partBytes > L.xmlPartBytes || Date.now() > deadline) fail('complex');
      chunks.push(data);
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  }
  const readPart = (name: string): string => {
    const chunks = parts.get(name);
    if (!chunks) return fail('unreadable');
    const buffer = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    return decode(buffer);
  };
  if (!readPart('[Content_Types].xml').includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')) fail('unreadable');
  if (!parts.has('word/document.xml')) fail('unreadable');
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: true, trimValues: false, parseTagValue: false });
  const render = (nodes: unknown, depth = 0): string => {
    if (depth > L.xmlDepth || Date.now() > deadline) return fail('complex');
    if (!Array.isArray(nodes)) return '';
    let result = '';
    for (const node of nodes as Record<string, unknown>[]) {
      for (const [tag, value] of Object.entries(node)) {
        if (tag === '#text') result += typeof value === 'string' ? value : '';
        else if (tag === 'w:altChunk') fail('unreadable');
        else if (tag === 'w:tab') result += '\t';
        else if (tag === 'w:br' || tag === 'w:cr') result += '\n';
        else if (tag !== 'w:instrText' && tag !== 'w:del') {
          result += render(value, depth + 1);
          if (tag === 'w:p' || tag === 'w:tr') result += '\n';
          if (tag === 'w:tc') result += '\t';
        }
      }
      if (result.length > L.characters) fail('characters');
    }
    return result;
  };
  const texts: string[] = [];
  for (const name of ['word/document.xml', ...[...parts.keys()].filter(n => n !== 'word/document.xml' && n !== '[Content_Types].xml').sort()]) {
    const xml = readPart(name);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail('unreadable');
    let depth = 0;
    let elements = 0;
    for (const match of xml.matchAll(/<\/?[A-Za-z_][^>]*>/g)) {
      const tag = match[0];
      if (tag.startsWith('</')) depth--;
      else { elements++; if (!tag.endsWith('/>')) depth++; }
      if (depth > L.xmlDepth || elements > L.xmlElements) fail('complex');
    }
    if (XMLValidator.validate(xml) !== true) fail('unreadable');
    texts.push(render(parser.parse(xml)));
  }
  return checkText(texts.join('\n\n'));
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { getDocument, OPS } = await getResolvedPDFJS();
  const task = getDocument({ data: bytes, useWorkerFetch: false,
    disableFontFace: true, useSystemFonts: true, useWasm: false, stopAtErrors: true, verbosity: 0 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const pdf = await task.promise;
        if (pdf.numPages > L.pdfPages) fail('complex');
        const pages: string[] = [];
        let length = 0;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          let text = '';
          for (const item of content.items) {
            if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
            if (length + text.length > L.characters) fail('characters');
          }
          if (!text.trim()) {
            // Ignore genuinely blank pages, not scans or outlined text.
            if (!isBlankPdfPage(await page.getOperatorList(), OPS)) fail('unreadable');
            page.cleanup();
            continue;
          }
          pages.push(text);
          length += text.length + 2;
          page.cleanup();
        }
        return checkText(pages.join('\n\n'));
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new AttachmentError('complex')); }, L.extractionMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}

export async function extractAttachment(file: File): Promise<AttachmentSource> {
  const type = attachmentType(file.name);
  if (!type) fail('format');
  if (file.size > L.fileBytes) fail('file_size');
  if (!file.size || file.name.length > 200 || /[\u0000-\u001f\u007f]/.test(file.name)) fail('unreadable');
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    let text: string;
    if (type === 'pdf') {
      if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') fail('unreadable');
      text = await pdfText(bytes);
    } else if (type === 'docx') {
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) fail('unreadable');
      text = docxText(bytes, Date.now() + L.extractionMs);
    } else text = checkText(decode(bytes));
    return { id: crypto.randomUUID(), name: file.name, type: type!, size: file.size, characters: text.length, text };
  } catch (error) {
    if (error instanceof AttachmentError) throw error;
    // Parser exceptions can contain document fragments. Never expose or log them.
    return fail('unreadable');
  }
}

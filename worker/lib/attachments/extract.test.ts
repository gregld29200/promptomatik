import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { extractAttachment } from './extract';

const file = (name: string, text: string) => new File([text], name);

describe('attachment extraction', () => {
  it('preserves TXT and Markdown paragraphs', async () => {
    for (const name of ['learner.txt', 'learner.md']) {
      expect((await extractAttachment(file(name, '# Learner\n\nDuration: 90 minutes.'))).text)
        .toBe('# Learner\n\nDuration: 90 minutes.');
    }
  });
  it('rejects disguised binary, unsupported, empty and oversized text', async () => {
    for (const f of [file('a.txt', '\0binary'), file('a.exe', 'text'), file('a.txt', '  '), file('a.md', 'x'.repeat(100_001)), file('a.pdf', 'not a PDF')]) {
      await expect(extractAttachment(f)).rejects.toThrow();
    }
  });
  it('extracts DOCX paragraphs and table cells without executing markup', async () => {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8('<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Learner &amp; goals</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Duration</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>90 minutes</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'),
    });
    const result = await extractAttachment(new File([bytes], 'learner.docx'));
    expect(result.text).toContain('Learner & goals');
    expect(result.text).toContain('90 minutes');
    expect(result.text).toContain('\t');
  });
});

import { learnerPdf, learnerDocx, pdfWithStreams } from './fixtures';

it('ignores blank pages before, between and after readable pages, including white Google Docs backgrounds', async () => {
  const result = await extractAttachment(pdfWithStreams([
    '', 'BT /F1 12 Tf 50 750 Td (First page.) Tj ET',
    'q 1 1 1 rg 0 0 612 792 re f Q BT /F1 12 Tf 50 750 Td ( ) Tj ET',
    'BT /F1 12 Tf 50 750 Td (Second page.) Tj ET', '',
  ]));
  expect(result.text).toContain('First page.');
  expect(result.text).toContain('Second page.');
});

it.each([
  '0 0 0 rg 20 20 100 100 re f',
  'q 100 0 0 100 0 0 cm BI /W 1 /H 1 /BPC 8 /CS /G /F /AHx ID 00> EI Q',
])('does not silently omit non-text graphics or scans from a mixed PDF', async (stream) => {
  await expect(extractAttachment(pdfWithStreams([
    'BT /F1 12 Tf 50 750 Td (Readable text.) Tj ET', stream,
  ]))).rejects.toThrow('unreadable');
});

it('still rejects documents containing only blank pages', async () => {
  await expect(extractAttachment(pdfWithStreams(['', '1 1 1 rg 0 0 612 792 re f'])))
    .rejects.toThrow('unreadable');
});
it('extracts a real PDF in workerd and rejects a page without text', async () => {
  expect((await extractAttachment(learnerPdf())).text).toContain('90 minutes');
  await expect(extractAttachment(learnerPdf(''))).rejects.toThrow('unreadable');
});
it('rejects XML entities and missing Word document parts', async () => {
  await expect(extractAttachment(learnerDocx('<!DOCTYPE x>'))).rejects.toThrow('unreadable');
  const bytes = zipSync({ 'not-word.xml': strToU8('hello') });
  await expect(extractAttachment(new File([bytes], 'fake.docx'))).rejects.toThrow('unreadable');
});
it('bounds actual expanded archive output', async () => {
  const bytes = zipSync({ 'word/document.xml': strToU8('x'.repeat(21 * 1024 * 1024)) });
  await expect(extractAttachment(new File([bytes], 'bomb.docx'))).rejects.toThrow('complex');
});
it('enforces the original file byte limit before extraction', async () => {
  await expect(extractAttachment(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.pdf'))).rejects.toThrow('file_size');
});
it('rejects deeply nested XML before constructing a large document tree', async () => {
  await expect(extractAttachment(learnerDocx('<w:r>'.repeat(110) + 'content' + '</w:r>'.repeat(110)))).rejects.toThrow('complex');
});

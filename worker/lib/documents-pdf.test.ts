import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';

const browserMocks = vi.hoisted(() => ({
  launch: vi.fn(),
  setContent: vi.fn(),
  pdf: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@cloudflare/puppeteer', () => ({
  default: { launch: browserMocks.launch },
}));

import { renderMaterialPdf } from './documents/pdf';

describe('simple document PDF export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserMocks.pdf.mockResolvedValue(new Uint8Array([1, 2, 3]));
    browserMocks.launch.mockResolvedValue({
      newPage: async () => ({
        setContent: browserMocks.setContent,
        pdf: browserMocks.pdf,
      }),
      close: browserMocks.close,
    });
  });

  it('exports a titled A4 document with quiet page numbering', async () => {
    await renderMaterialPdf(
      { BROWSER: {} } as Env,
      '<!doctype html><html><head></head><body>Teacher content</body></html>',
      { title: 'Supplier Performance', pageNumbers: true },
    );

    expect(browserMocks.setContent.mock.calls[0][0]).toContain('<title>Supplier Performance</title>');
    expect(browserMocks.pdf).toHaveBeenCalledWith(expect.objectContaining({
      format: 'A4',
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: expect.stringContaining('class="pageNumber"'),
    }));
    expect(browserMocks.pdf.mock.calls[0][0].footerTemplate).toContain('class="totalPages"');
    expect(browserMocks.close).toHaveBeenCalledOnce();
  });
});

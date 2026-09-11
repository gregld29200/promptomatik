/** Conservative check for empty pages, including white export backgrounds.
 * Images and vector content without extractible text must not be discarded.
 */
export function isBlankPdfPage(
  list: { fnArray: number[]; argsArray: unknown[] },
  ops: Record<string, number>,
): boolean {
  const names = new Map(Object.entries(ops).map(([name, code]) => [code, name]));
  let whiteFill = false;
  const stack: boolean[] = [];
  for (let i = 0; i < list.fnArray.length; i++) {
    const name = names.get(list.fnArray[i]) ?? '';
    const args = list.argsArray[i] as unknown[] | null;
    if (name === 'save' || name === 'paintFormXObjectBegin') stack.push(whiteFill);
    else if (name === 'restore' || name === 'paintFormXObjectEnd') whiteFill = stack.pop() ?? false;
    else if (name.startsWith('setFill')) {
      whiteFill = name === 'setFillRGBColor' && args?.[0] === '#ffffff';
    } else if (name === 'setGState') {
      // Nonstandard blend modes can make a white fill visible.
      const states = args?.[0];
      if (!Array.isArray(states) || states.some(state =>
        Array.isArray(state) && state[0] === 'BM' && !['Normal', 'source-over'].includes(state[1]),
      )) return false;
    } else if (name === 'showText') {
      const glyphs = args?.[0];
      if (!Array.isArray(glyphs) || glyphs.some(glyph =>
        typeof glyph !== 'number' && (!glyph || typeof glyph.unicode !== 'string' || glyph.unicode.trim()),
      )) return false;
    } else if (name === 'constructPath') {
      // PDF.js combines path construction and painting in this operator.
      const paint = args?.[0];
      if (paint !== ops.endPath && !(whiteFill && (paint === ops.fill || paint === ops.eoFill))) return false;
    } else if (name === 'fill' || name === 'eoFill') {
      if (!whiteFill) return false;
    } else if (
      (name.startsWith('paint') && name !== 'paintFormXObjectBegin' && name !== 'paintFormXObjectEnd') ||
      name === 'beginAnnotation' ||
      (/stroke|shadingFill|rawFillPath|ShowText/i.test(name) && !name.startsWith('set'))
    ) return false;
  }
  return true;
}

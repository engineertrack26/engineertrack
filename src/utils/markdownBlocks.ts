/** Block kinds the internship report can contain. Deliberately a small,
 *  closed set matched to what build_internship_report ever emits (see
 *  docs/superpowers/specs/2026-09-16-internship-closure-design.md §5) --
 *  not a general Markdown grammar. */
export interface Block {
  type: 'h1' | 'h2' | 'p' | 'table' | 'note';
  text?: string;
  rows?: string[][];
}

/** A table separator row, e.g. `---` or `:---:`. Dropped rather than
 *  rendered as data. Uses ASCII hyphen-minus only, so a cell holding an
 *  em dash ("—", a real "no value" marker in the report) is never
 *  mistaken for one. */
const SEPARATOR_CELL = /^:?-+:?$/;

function splitRow(line: string): string[] {
  const cells = line.trim().split('|').map((c) => c.trim());
  if (cells.length && cells[0] === '') cells.shift();
  if (cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/** Turns the server-built report Markdown into a small set of blocks for
 *  MarkdownView to render -- no general Markdown parsing, just the shapes
 *  build_internship_report ever produces: headings, tables and the
 *  trailing italic note. Pure so it can be unit tested independent of
 *  React Native. */
export function parseMarkdownBlocks(md: string): Block[] {
  const lines = (md || '').split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed === '') {
      i++;
      continue;
    }

    if (trimmed.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = splitRow(lines[i]);
        const isSeparator = cells.length > 0 && cells.every((c) => SEPARATOR_CELL.test(c));
        if (!isSeparator) rows.push(cells);
        i++;
      }
      blocks.push({ type: 'table', rows });
      continue;
    }

    if (trimmed.startsWith('## ')) {
      blocks.push({ type: 'h2', text: trimmed.slice(3).trim() });
      i++;
      continue;
    }

    if (trimmed.startsWith('# ')) {
      blocks.push({ type: 'h1', text: trimmed.slice(2).trim() });
      i++;
      continue;
    }

    if (trimmed.length > 1 && trimmed.startsWith('_') && trimmed.endsWith('_')) {
      blocks.push({ type: 'note', text: trimmed.slice(1, -1) });
      i++;
      continue;
    }

    blocks.push({ type: 'p', text: trimmed });
    i++;
  }
  return blocks;
}

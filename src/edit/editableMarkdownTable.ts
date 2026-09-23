/**
 * Phase 5E-3b ("Markdown Table parser / serializer 基盤"): a pure,
 * Obsidian-free round-trip converter between a Markdown pipe-table's raw
 * text and a structured, editable representation, laying the groundwork
 * for Phase 5E-3c's lightweight cell/row/column Table Mode.
 *
 * Scope (ticket §実装上の制約): this module does not touch the Partial
 * Edit save path (applySubtreeEdit/dispatchAndApply), conflict detection,
 * Outline Tree projection, or the range parser. It has no wiring into
 * view/PartialEditView.ts or view/OutlineTreeView.ts yet — parseMarkdown
 * Table/serializeMarkdownTable are standalone pure functions, exercised
 * only by this file's own tests until Phase 5E-3c consumes them.
 */

/** A table column's GFM alignment, as declared by its delimiter-row cell (`---`/`:---`/`---:`/`:---:`). */
export type TableColumnAlignment = "left" | "center" | "right" | "none";

/**
 * A Markdown pipe-table's structural content, decoupled from its raw
 * Markdown syntax (pipes, delimiter-row dashes, escaping, padding).
 *
 * NOT a storage/save format: this is a TEMPORARY, in-memory shape meant to
 * live only for the lifetime of a single Partial Edit session (Phase
 * 5E-3c) — the Markdown note itself remains the single source of truth at
 * all times, exactly like every other Partial Edit projection in this
 * codebase (see e.g. edit/listMarkerProjection.ts). Nothing persists an
 * EditableMarkdownTable; serializeMarkdownTable always converts it back to
 * raw Markdown lines before any write.
 *
 * `headers.length === alignments.length`, and every entry of `rows` has
 * exactly that same length — parseMarkdownTable only ever returns a value
 * satisfying this invariant, but it is not otherwise enforced at the type
 * level (a hand-constructed value could violate it; serializeMarkdownTable
 * does not validate it either, it simply serializes whatever it is given
 * row by row).
 */
export interface EditableMarkdownTable {
  /** One entry per column, in order — the header row's cell text (already unescaped/trimmed, see parseMarkdownTable). */
  headers: string[];
  /** One entry per column, in the same order as `headers`. */
  alignments: TableColumnAlignment[];
  /** One entry per data row (in document order); each row has `headers.length` cells, in column order. */
  rows: string[][];
}

/** Why parseMarkdownTable rejected an input — see this module's top doc comment and each call site below for exactly when each is returned. */
export type MarkdownTableParseFailureReason =
  | "no-header-row"
  | "no-delimiter-row"
  | "invalid-delimiter-row"
  | "column-count-mismatch"
  | "ambiguous-inline-code";

export type ParseMarkdownTableResult =
  | { ok: true; table: EditableMarkdownTable }
  | { ok: false; reason: MarkdownTableParseFailureReason };

/**
 * The same delimiter-cell shape parser/complexBlocks.ts's own
 * DELIMITER_CELL_RE and edit/partialEdit.ts's own TABLE_DELIMITER_CELL_RE
 * recognize (`^:?-+:?$` — one or more hyphens, with an optional leading
 * and/or trailing colon for GFM column-alignment syntax, and nothing
 * else) — deliberately NOT imported (both are module-private to their own
 * files), but kept byte-identical in shape, same "duplicated, not
 * imported" convention already used throughout this codebase for this
 * exact regex.
 */
const DELIMITER_CELL_RE = /^:?-+:?$/;

function parseAlignment(cell: string): TableColumnAlignment | null {
  if (!DELIMITER_CELL_RE.test(cell)) return null;
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (left) return "left";
  if (right) return "right";
  return "none";
}

/**
 * Splits one raw table row into trimmed, unescaped cell strings.
 *
 * Unlike edit/partialEdit.ts's own splitPipeRowForValidation (a naive
 * `split("|")`, sufficient for that module's narrower Apply-time shape
 * check), this walks the row character by character so it can tell a
 * genuine column-separator `|` apart from:
 *   - a backslash-escaped pipe (`\|`) — consumed as a single literal `|`
 *     in the cell's text, never a separator (the backslash itself is
 *     dropped; serializeMarkdownTable re-inserts it on the way back out).
 *   - a `|` inside an inline code span (one or more backticks, closed by
 *     a backtick run of the exact same length) — copied through verbatim,
 *     backticks included, never a separator and never unescaped.
 *
 * Nested code spans and mismatched-length backtick runs are explicitly
 * out of scope (ticket §2): encountering a backtick run of a DIFFERENT
 * length while already inside a span, or reaching the end of the row
 * still inside an unterminated span, makes the whole row's parse
 * "解析が不確実" and this returns `{ ok: false }`, which
 * parseMarkdownTable turns into `reason: "ambiguous-inline-code"`.
 */
function splitTableRowCells(rowBody: string): { ok: true; cells: string[] } | { ok: false } {
  const cells: string[] = [];
  let current = "";
  let inCode = false;
  let openLen = 0;
  let i = 0;
  while (i < rowBody.length) {
    const ch = rowBody[i];
    if (!inCode && ch === "\\" && rowBody[i + 1] === "|") {
      current += "|";
      i += 2;
      continue;
    }
    if (ch === "`") {
      let j = i;
      while (j < rowBody.length && rowBody[j] === "`") j++;
      const runLen = j - i;
      if (!inCode) {
        inCode = true;
        openLen = runLen;
      } else if (runLen === openLen) {
        inCode = false;
        openLen = 0;
      } else {
        // A second, differently-sized backtick run while already inside a
        // span — nested/multi-backtick code spans are out of scope; this
        // row can't be parsed with confidence.
        return { ok: false };
      }
      current += rowBody.slice(i, j);
      i = j;
      continue;
    }
    if (!inCode && ch === "|") {
      cells.push(current.trim());
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (inCode) {
    // Unterminated inline code span — likewise not parseable with
    // confidence.
    return { ok: false };
  }
  cells.push(current.trim());
  return { ok: true, cells };
}

/** Strips a single optional leading/trailing `|` (ticket §2: "行頭・行末のパイプは任意"), then delegates to splitTableRowCells. */
function splitTableRowLine(line: string): { ok: true; cells: string[] } | { ok: false } {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return splitTableRowCells(body);
}

/**
 * Parses a table block's raw Markdown (the table's own lines only — no
 * surrounding blank lines or indentation, ticket §2) into an
 * EditableMarkdownTable.
 *
 * Line 1 is the header row, line 2 the delimiter row, every line after
 * that a data row. Every row (header, delimiter, and data) must split
 * into exactly the same number of cells or the whole parse is rejected
 * with `"column-count-mismatch"`. A single trailing blank line (from a
 * caller that included the raw text's final newline) is tolerated and
 * ignored; a blank line anywhere else in the middle is treated as an
 * ordinary too-short row and rejected the same way any other column-count
 * mismatch is.
 */
export function parseMarkdownTable(raw: string): ParseMarkdownTableResult {
  const rawLines = raw.split("\n");
  const lines =
    rawLines.length > 1 && rawLines[rawLines.length - 1] === "" ? rawLines.slice(0, -1) : rawLines;

  if (lines.length === 0 || lines[0].trim() === "") {
    return { ok: false, reason: "no-header-row" };
  }
  if (lines.length < 2) {
    return { ok: false, reason: "no-delimiter-row" };
  }

  const headerSplit = splitTableRowLine(lines[0]);
  if (!headerSplit.ok) return { ok: false, reason: "ambiguous-inline-code" };
  const headers = headerSplit.cells;

  const delimiterSplit = splitTableRowLine(lines[1]);
  if (!delimiterSplit.ok) return { ok: false, reason: "ambiguous-inline-code" };
  if (delimiterSplit.cells.length !== headers.length) {
    return { ok: false, reason: "column-count-mismatch" };
  }
  const alignments: TableColumnAlignment[] = [];
  for (const cell of delimiterSplit.cells) {
    const alignment = parseAlignment(cell);
    if (alignment === null) return { ok: false, reason: "invalid-delimiter-row" };
    alignments.push(alignment);
  }

  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    const rowSplit = splitTableRowLine(lines[i]);
    if (!rowSplit.ok) return { ok: false, reason: "ambiguous-inline-code" };
    if (rowSplit.cells.length !== headers.length) {
      return { ok: false, reason: "column-count-mismatch" };
    }
    rows.push(rowSplit.cells);
  }

  return { ok: true, table: { headers, alignments, rows } };
}

/**
 * Re-escapes a structured cell's text for embedding in a raw table row:
 * every `|` OUTSIDE an inline code span becomes `\|`; a `|` inside a
 * backtick-delimited span (backticks and all) is left completely
 * untouched, since it is already protected by the span rather than by
 * escaping. This is splitTableRowCells's exact inverse for the pipe/code
 * handling described on that function's own doc comment, which is what
 * makes `parseMarkdownTable(serializeMarkdownTable(table).join("\n"))`
 * reproduce `table` exactly (see this module's round-trip tests).
 *
 * Total (never rejects): a cell text with an unterminated code span just
 * has the rest of the string treated as still "inside" it, matching
 * splitTableRowCells's own unterminated-span handling. In practice this
 * function only ever receives cell text that either came out of a
 * successful parseMarkdownTable call (where this can't happen — such a
 * row would have failed to parse in the first place) or was constructed
 * by a caller directly; in the latter case this best-effort behavior is a
 * deliberate, harmless fallback rather than a contract this module makes
 * any stronger guarantee about.
 */
function escapeTableCellText(cellText: string): string {
  let result = "";
  let inCode = false;
  let openLen = 0;
  let i = 0;
  while (i < cellText.length) {
    const ch = cellText[i];
    if (ch === "`") {
      let j = i;
      while (j < cellText.length && cellText[j] === "`") j++;
      const runLen = j - i;
      if (!inCode) {
        inCode = true;
        openLen = runLen;
      } else if (runLen === openLen) {
        inCode = false;
        openLen = 0;
      }
      // A differently-sized run while already inCode is passed through
      // untouched, staying inCode — see this function's own doc comment.
      result += cellText.slice(i, j);
      i = j;
      continue;
    }
    if (!inCode && ch === "|") {
      result += "\\|";
      i++;
      continue;
    }
    result += ch;
    i++;
  }
  return result;
}

function buildDelimiterCell(alignment: TableColumnAlignment): string {
  switch (alignment) {
    case "left":
      return ":---";
    case "right":
      return "---:";
    case "center":
      return ":---:";
    case "none":
      return "---";
  }
}

function buildTableRowLine(cells: string[]): string {
  return "| " + cells.map((c) => escapeTableCellText(c)).join(" | ") + " |";
}

/**
 * Serializes an EditableMarkdownTable back to raw Markdown table lines:
 * `| header | ... |`, `| :--- | ... |` (per-column, from `alignments`),
 * then one `| cell | ... |` line per row of `rows` — always with a
 * leading/trailing pipe and single-space cell padding (ticket §3), and
 * never column-width-aligned padding beyond that single space (this
 * module only guarantees minimally-valid Markdown, not pretty-printed
 * column alignment).
 *
 * Returns the lines without trailing newlines; joining them with `"\n"`
 * (or however the caller assembles a note's lines) is the caller's own
 * choice, same convention as edit/insertStructuredBlock.ts's
 * buildFencedCodeBlockLines/buildTableTemplateLines.
 */
export function serializeMarkdownTable(table: EditableMarkdownTable): string[] {
  const lines: string[] = [buildTableRowLine(table.headers)];
  lines.push("| " + table.alignments.map((a) => buildDelimiterCell(a)).join(" | ") + " |");
  for (const row of table.rows) {
    lines.push(buildTableRowLine(row));
  }
  return lines;
}

/**
 * Phase 5E-3c ("軽量 Table Mode"): pure, Obsidian-free operations over an
 * `EditableMarkdownTable` (src/edit/editableMarkdownTable.ts) — cell edit,
 * alignment change, row add/delete/move, column add/delete. Every
 * operation here is a pure function: `(table, ...) => TableModeOpResult`,
 * never touching the DOM, Partial Edit session state, or the Markdown
 * note itself. view/PartialEditView.ts's Table Mode UI is the only
 * caller; it holds the CURRENT `EditableMarkdownTable` as in-memory
 * session state (see that type's own doc comment — never a save format)
 * and replaces it with the `table` this module returns on every
 * successful operation, exactly like a reducer. Apply-time write-back
 * still goes exclusively through `serializeMarkdownTable` and the
 * existing `applySubtreeEdit`/`dispatchAndApply` path — this module never
 * writes anything itself.
 *
 * Rejection boundary (ticket §拒否条件): deleting the last row (0 rows
 * left) or the last column (0 columns left) is refused here, at the pure-
 * function level, so the UI layer never has to re-derive that guard
 * itself — it only needs to show the refusal.
 */

import { EditableMarkdownTable, TableColumnAlignment } from "./editableMarkdownTable";

export type TableModeOpFailureReason = "last-row" | "last-column" | "out-of-range";

export type TableModeOpResult =
  | { ok: true; table: EditableMarkdownTable }
  | { ok: false; reason: TableModeOpFailureReason };

function inRange(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

/** Replaces one header cell's text. `columnIndex` out of range is a no-op-safe rejection ("out-of-range"). */
export function setHeaderCellText(
  table: EditableMarkdownTable,
  columnIndex: number,
  text: string
): TableModeOpResult {
  if (!inRange(columnIndex, table.headers.length)) return { ok: false, reason: "out-of-range" };
  const headers = table.headers.slice();
  headers[columnIndex] = text;
  return { ok: true, table: { ...table, headers } };
}

/** Replaces one data-row cell's text. Either index out of range is rejected ("out-of-range"). */
export function setDataCellText(
  table: EditableMarkdownTable,
  rowIndex: number,
  columnIndex: number,
  text: string
): TableModeOpResult {
  if (!inRange(rowIndex, table.rows.length)) return { ok: false, reason: "out-of-range" };
  if (!inRange(columnIndex, table.headers.length)) return { ok: false, reason: "out-of-range" };
  const rows = table.rows.map((row, i) => (i === rowIndex ? replaceAt(row, columnIndex, text) : row));
  return { ok: true, table: { ...table, rows } };
}

function replaceAt<T>(arr: T[], index: number, value: T): T[] {
  const copy = arr.slice();
  copy[index] = value;
  return copy;
}

/** Sets one column's alignment (the ヘッダー行 alignment toggle). */
export function setColumnAlignment(
  table: EditableMarkdownTable,
  columnIndex: number,
  alignment: TableColumnAlignment
): TableModeOpResult {
  if (!inRange(columnIndex, table.alignments.length)) return { ok: false, reason: "out-of-range" };
  const alignments = replaceAt(table.alignments, columnIndex, alignment);
  return { ok: true, table: { ...table, alignments } };
}

/** Appends one empty data row (all cells `""`) at the end of the table. Always succeeds. */
export function addRow(table: EditableMarkdownTable): TableModeOpResult {
  const newRow = table.headers.map(() => "");
  return { ok: true, table: { ...table, rows: [...table.rows, newRow] } };
}

/**
 * Deletes the data row at `rowIndex`. Refused ("last-row") when this
 * would leave the table with zero data rows — ticket §拒否条件's
 * "行削除操作によって行数が0になる場合（最後の1行は削除できない）".
 */
export function deleteRow(table: EditableMarkdownTable, rowIndex: number): TableModeOpResult {
  if (!inRange(rowIndex, table.rows.length)) return { ok: false, reason: "out-of-range" };
  if (table.rows.length <= 1) return { ok: false, reason: "last-row" };
  const rows = table.rows.filter((_, i) => i !== rowIndex);
  return { ok: true, table: { ...table, rows } };
}

/**
 * Moves the data row at `rowIndex` one position up (`direction ===
 * "up"`) or down (`direction === "down"`). A move that would go past
 * either end of `rows` is a no-op success (the table is returned
 * unchanged) rather than a rejection — mirrors how a disabled "move
 * up"/"move down" button at either boundary behaves in the UI, never a
 * user-facing error.
 */
export function moveRow(
  table: EditableMarkdownTable,
  rowIndex: number,
  direction: "up" | "down"
): TableModeOpResult {
  if (!inRange(rowIndex, table.rows.length)) return { ok: false, reason: "out-of-range" };
  const targetIndex = direction === "up" ? rowIndex - 1 : rowIndex + 1;
  if (!inRange(targetIndex, table.rows.length)) return { ok: true, table };
  const rows = table.rows.slice();
  const [moved] = rows.splice(rowIndex, 1);
  rows.splice(targetIndex, 0, moved);
  return { ok: true, table: { ...table, rows } };
}

/**
 * Appends one empty column at the right edge: an empty header cell,
 * `"none"` alignment, and one empty data cell per existing row (ticket
 * §2 「列操作」: 「押すと空のヘッダーセルと空のデータセルを各行末尾に追加
 * する」). Always succeeds.
 */
export function addColumn(table: EditableMarkdownTable): TableModeOpResult {
  return {
    ok: true,
    table: {
      headers: [...table.headers, ""],
      alignments: [...table.alignments, "none"],
      rows: table.rows.map((row) => [...row, ""]),
    },
  };
}

/**
 * Deletes the column at `columnIndex` (its header cell, its alignment,
 * and that cell from every data row). Refused ("last-column") when this
 * would leave the table with zero columns — ticket §拒否条件's
 * 「削除操作によって列数が0になる場合（列削除を拒否する）」.
 */
export function deleteColumn(table: EditableMarkdownTable, columnIndex: number): TableModeOpResult {
  if (!inRange(columnIndex, table.headers.length)) return { ok: false, reason: "out-of-range" };
  if (table.headers.length <= 1) return { ok: false, reason: "last-column" };
  const headers = table.headers.filter((_, i) => i !== columnIndex);
  const alignments = table.alignments.filter((_, i) => i !== columnIndex);
  const rows = table.rows.map((row) => row.filter((_, i) => i !== columnIndex));
  return { ok: true, table: { headers, alignments, rows } };
}

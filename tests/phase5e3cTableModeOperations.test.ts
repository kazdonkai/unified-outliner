/**
 * Phase 5E-3c: pure-function tests for edit/tableModeOperations.ts (cell
 * edit, alignment, row add/delete/move, column add/delete), plus
 * Apply-time-shape tests confirming serializeMarkdownTable's output after
 * these operations round-trips through parseMarkdownTable as valid
 * Markdown. Raw -> Table -> Raw round-trip stability itself is already
 * covered by tests/phase5e3bTableParserSerializer.test.ts and is not
 * re-tested here.
 */
import { describe, expect, it } from "vitest";
import { EditableMarkdownTable, parseMarkdownTable, serializeMarkdownTable } from "../src/edit/editableMarkdownTable";
import {
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  moveRow,
  setColumnAlignment,
  setDataCellText,
  setHeaderCellText,
} from "../src/edit/tableModeOperations";

function baseTable(): EditableMarkdownTable {
  return {
    headers: ["A", "B"],
    alignments: ["none", "left"],
    rows: [
      ["1", "2"],
      ["3", "4"],
    ],
  };
}

function expectOkTable(result: { ok: boolean; table?: EditableMarkdownTable }): EditableMarkdownTable {
  if (!result.ok || !result.table) throw new Error("expected ok result");
  return result.table;
}

describe("setHeaderCellText", () => {
  it("replaces the header cell at the given column, leaving everything else untouched", () => {
    const table = expectOkTable(setHeaderCellText(baseTable(), 1, "Bee"));
    expect(table.headers).toEqual(["A", "Bee"]);
    expect(table.alignments).toEqual(["none", "left"]);
    expect(table.rows).toEqual(baseTable().rows);
  });

  it("rejects an out-of-range column index", () => {
    const result = setHeaderCellText(baseTable(), 5, "x");
    expect(result).toEqual({ ok: false, reason: "out-of-range" });
  });

  it("does not mutate the input table", () => {
    const original = baseTable();
    setHeaderCellText(original, 0, "changed");
    expect(original.headers).toEqual(["A", "B"]);
  });
});

describe("setDataCellText", () => {
  it("replaces one data cell only", () => {
    const table = expectOkTable(setDataCellText(baseTable(), 1, 0, "X"));
    expect(table.rows).toEqual([
      ["1", "2"],
      ["X", "4"],
    ]);
  });

  it("preserves cell text verbatim, including pipe characters (ticket §4: no inline transformation)", () => {
    const table = expectOkTable(setDataCellText(baseTable(), 0, 0, "a|b `code|x` c"));
    expect(table.rows[0][0]).toBe("a|b `code|x` c");
  });

  it("rejects an out-of-range row index", () => {
    expect(setDataCellText(baseTable(), 9, 0, "x")).toEqual({ ok: false, reason: "out-of-range" });
  });

  it("rejects an out-of-range column index", () => {
    expect(setDataCellText(baseTable(), 0, 9, "x")).toEqual({ ok: false, reason: "out-of-range" });
  });
});

describe("setColumnAlignment", () => {
  it("sets a single column's alignment", () => {
    const table = expectOkTable(setColumnAlignment(baseTable(), 0, "center"));
    expect(table.alignments).toEqual(["center", "left"]);
  });

  it("rejects an out-of-range column index", () => {
    expect(setColumnAlignment(baseTable(), 9, "right")).toEqual({ ok: false, reason: "out-of-range" });
  });
});

describe("addRow", () => {
  it("appends one empty row matching the column count", () => {
    const table = expectOkTable(addRow(baseTable()));
    expect(table.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
      ["", ""],
    ]);
  });

  it("always succeeds, even for a table with zero existing rows", () => {
    const empty: EditableMarkdownTable = { headers: ["A"], alignments: ["none"], rows: [] };
    const table = expectOkTable(addRow(empty));
    expect(table.rows).toEqual([[""]]);
  });
});

describe("deleteRow", () => {
  it("removes exactly the targeted row", () => {
    const table = expectOkTable(deleteRow(baseTable(), 0));
    expect(table.rows).toEqual([["3", "4"]]);
  });

  it("rejects deleting the last remaining row (last-row)", () => {
    const oneRow: EditableMarkdownTable = { headers: ["A"], alignments: ["none"], rows: [["1"]] };
    expect(deleteRow(oneRow, 0)).toEqual({ ok: false, reason: "last-row" });
  });

  it("rejects an out-of-range row index", () => {
    expect(deleteRow(baseTable(), 9)).toEqual({ ok: false, reason: "out-of-range" });
  });
});

describe("moveRow", () => {
  it("moves a row up, swapping with its predecessor", () => {
    const three: EditableMarkdownTable = {
      headers: ["A"],
      alignments: ["none"],
      rows: [["1"], ["2"], ["3"]],
    };
    const table = expectOkTable(moveRow(three, 1, "up"));
    expect(table.rows).toEqual([["2"], ["1"], ["3"]]);
  });

  it("moves a row down, swapping with its successor", () => {
    const three: EditableMarkdownTable = {
      headers: ["A"],
      alignments: ["none"],
      rows: [["1"], ["2"], ["3"]],
    };
    const table = expectOkTable(moveRow(three, 1, "down"));
    expect(table.rows).toEqual([["1"], ["3"], ["2"]]);
  });

  it("moving the first row up is a no-op success (already at the top boundary)", () => {
    const table = expectOkTable(moveRow(baseTable(), 0, "up"));
    expect(table.rows).toEqual(baseTable().rows);
  });

  it("moving the last row down is a no-op success (already at the bottom boundary)", () => {
    const table = expectOkTable(moveRow(baseTable(), 1, "down"));
    expect(table.rows).toEqual(baseTable().rows);
  });

  it("rejects an out-of-range row index", () => {
    expect(moveRow(baseTable(), 9, "up")).toEqual({ ok: false, reason: "out-of-range" });
  });
});

describe("addColumn", () => {
  it("appends an empty header cell, 'none' alignment, and one empty data cell per row", () => {
    const table = expectOkTable(addColumn(baseTable()));
    expect(table.headers).toEqual(["A", "B", ""]);
    expect(table.alignments).toEqual(["none", "left", "none"]);
    expect(table.rows).toEqual([
      ["1", "2", ""],
      ["3", "4", ""],
    ]);
  });

  it("works on a table with zero data rows", () => {
    const empty: EditableMarkdownTable = { headers: ["A"], alignments: ["none"], rows: [] };
    const table = expectOkTable(addColumn(empty));
    expect(table.headers).toEqual(["A", ""]);
    expect(table.rows).toEqual([]);
  });
});

describe("deleteColumn", () => {
  it("removes the targeted column's header, alignment, and every row's cell", () => {
    const table = expectOkTable(deleteColumn(baseTable(), 0));
    expect(table.headers).toEqual(["B"]);
    expect(table.alignments).toEqual(["left"]);
    expect(table.rows).toEqual([["2"], ["4"]]);
  });

  it("rejects deleting the last remaining column (last-column)", () => {
    const oneCol: EditableMarkdownTable = { headers: ["A"], alignments: ["none"], rows: [["1"], ["2"]] };
    expect(deleteColumn(oneCol, 0)).toEqual({ ok: false, reason: "last-column" });
  });

  it("rejects an out-of-range column index", () => {
    expect(deleteColumn(baseTable(), 9)).toEqual({ ok: false, reason: "out-of-range" });
  });
});

describe("Apply-time validity: serializeMarkdownTable output after Table Mode operations", () => {
  function assertValidMarkdown(table: EditableMarkdownTable): void {
    const raw = serializeMarkdownTable(table).join("\n");
    const reparsed = parseMarkdownTable(raw);
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) expect(reparsed.table).toEqual(table);
  }

  it("cell edit -> valid Markdown", () => {
    assertValidMarkdown(expectOkTable(setDataCellText(baseTable(), 0, 0, "a|b")));
  });

  it("add row -> valid Markdown", () => {
    assertValidMarkdown(expectOkTable(addRow(baseTable())));
  });

  it("delete row -> valid Markdown", () => {
    assertValidMarkdown(expectOkTable(deleteRow(baseTable(), 0)));
  });

  it("move row -> valid Markdown", () => {
    assertValidMarkdown(expectOkTable(moveRow(baseTable(), 0, "down")));
  });

  it("add column -> valid Markdown", () => {
    assertValidMarkdown(expectOkTable(addColumn(baseTable())));
  });

  it("delete column -> valid Markdown", () => {
    assertValidMarkdown(expectOkTable(deleteColumn(baseTable(), 1)));
  });

  it("alignment change -> valid Markdown", () => {
    assertValidMarkdown(expectOkTable(setColumnAlignment(baseTable(), 1, "center")));
  });

  it("chained operations (add column, add row, edit, delete row) -> valid Markdown", () => {
    let table = baseTable();
    table = expectOkTable(addColumn(table));
    table = expectOkTable(addRow(table));
    table = expectOkTable(setHeaderCellText(table, 2, "C"));
    table = expectOkTable(setDataCellText(table, 2, 2, "x"));
    table = expectOkTable(deleteRow(table, 0));
    assertValidMarkdown(table);
  });

  it("empty header/data cell text still serializes to valid Markdown", () => {
    assertValidMarkdown(expectOkTable(setDataCellText(baseTable(), 0, 0, "")));
  });
});

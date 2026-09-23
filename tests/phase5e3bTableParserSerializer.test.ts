/**
 * Phase 5E-3b: round-trip and rejection tests for the pure Markdown table
 * parser/serializer (edit/editableMarkdownTable.ts). No Obsidian, no UI —
 * see that module's own top doc comment for scope.
 */
import { describe, expect, it } from "vitest";
import {
  EditableMarkdownTable,
  MarkdownTableParseFailureReason,
  parseMarkdownTable,
  serializeMarkdownTable,
} from "../src/edit/editableMarkdownTable";

function expectOk(raw: string): EditableMarkdownTable {
  const result = parseMarkdownTable(raw);
  if (!result.ok) throw new Error(`expected ok, got reason: ${result.reason}`);
  return result.table;
}

function expectFail(raw: string): MarkdownTableParseFailureReason {
  const result = parseMarkdownTable(raw);
  if (result.ok) throw new Error("expected failure, got ok");
  return result.reason;
}

describe("parseMarkdownTable: basic structure", () => {
  it("parses a minimal 2x1 table with no alignment", () => {
    const table = expectOk(["| A | B |", "| --- | --- |", "| 1 | 2 |"].join("\n"));
    expect(table).toEqual({
      headers: ["A", "B"],
      alignments: ["none", "none"],
      rows: [["1", "2"]],
    });
  });

  it("parses all four alignment forms", () => {
    const table = expectOk(
      ["| a | b | c | d |", "| --- | :--- | ---: | :---: |", "| 1 | 2 | 3 | 4 |"].join("\n")
    );
    expect(table.alignments).toEqual(["none", "left", "right", "center"]);
  });

  it("tolerates missing leading/trailing pipes", () => {
    const table = expectOk(["A | B", "--- | ---", "1 | 2"].join("\n"));
    expect(table).toEqual({
      headers: ["A", "B"],
      alignments: ["none", "none"],
      rows: [["1", "2"]],
    });
  });

  it("trims cell whitespace", () => {
    const table = expectOk(["|  A  |  B  |", "| --- | --- |", "|  1  |  2  |"].join("\n"));
    expect(table.headers).toEqual(["A", "B"]);
    expect(table.rows).toEqual([["1", "2"]]);
  });

  it("supports a header-only table (no data rows)", () => {
    const table = expectOk(["| A | B |", "| --- | --- |"].join("\n"));
    expect(table.rows).toEqual([]);
  });

  it("supports multiple data rows in order", () => {
    const table = expectOk(
      ["| A |", "| --- |", "| 1 |", "| 2 |", "| 3 |"].join("\n")
    );
    expect(table.rows).toEqual([["1"], ["2"], ["3"]]);
  });

  it("tolerates a single trailing blank line from a caller-included final newline", () => {
    const table = expectOk(["| A |", "| --- |", "| 1 |", ""].join("\n"));
    expect(table.rows).toEqual([["1"]]);
  });
});

describe("parseMarkdownTable: escaped pipes and inline code", () => {
  it("unescapes a backslash-escaped pipe into a literal pipe in cell text", () => {
    const table = expectOk(["| A |", "| --- |", "| a\\|b |"].join("\n"));
    expect(table.rows).toEqual([["a|b"]]);
  });

  it("does not split on a pipe inside a single-backtick inline code span", () => {
    const table = expectOk(["| A |", "| --- |", "| `a\\|b` |"].join("\n"));
    // The pipe inside the code span is literal Markdown content, not an
    // escape — it is preserved verbatim, backslash included, since escapes
    // are not interpreted inside inline code.
    expect(table.rows).toEqual([["`a\\|b`"]]);
  });

  it("does not split a row on a bare pipe inside inline code, and keeps other columns intact", () => {
    const table = expectOk(["| A | B |", "| --- | --- |", "| `x|y` | z |"].join("\n"));
    expect(table.rows).toEqual([["`x|y`", "z"]]);
  });

  it("supports a double-backtick-delimited code span (no embedded backticks) containing a pipe", () => {
    const table = expectOk(["| A |", "| --- |", "| `` a|b `` |"].join("\n"));
    expect(table.rows).toEqual([["`` a|b ``"]]);
  });

  it("rejects a double-backtick-delimited span whose content itself contains a single backtick, as ambiguous (nested/multi-backtick spans are out of scope)", () => {
    expect(expectFail(["| A |", "| --- |", "| `` a`b `` |"].join("\n"))).toBe(
      "ambiguous-inline-code"
    );
  });
});

describe("parseMarkdownTable: rejections", () => {
  it("rejects empty input as no-header-row", () => {
    expect(expectFail("")).toBe("no-header-row");
  });

  it("rejects a blank-only header line as no-header-row", () => {
    expect(expectFail("   \n| --- |\n| 1 |")).toBe("no-header-row");
  });

  it("rejects a header row with no delimiter row at all", () => {
    expect(expectFail("| A | B |")).toBe("no-delimiter-row");
  });

  it("rejects a header row with only a trailing newline and nothing else", () => {
    expect(expectFail("| A | B |\n")).toBe("no-delimiter-row");
  });

  it("rejects a delimiter row with numeric-only cells", () => {
    expect(expectFail(["| A | B |", "| 1 | 2 |", "| x | y |"].join("\n"))).toBe(
      "invalid-delimiter-row"
    );
  });

  it("rejects a delimiter row with an empty cell", () => {
    expect(expectFail(["| A | B |", "|  |  |", "| x | y |"].join("\n"))).toBe(
      "invalid-delimiter-row"
    );
  });

  it("rejects mismatched column counts between header and delimiter", () => {
    expect(expectFail(["| A | B |", "| --- |", "| 1 | 2 |"].join("\n"))).toBe(
      "column-count-mismatch"
    );
  });

  it("rejects mismatched column counts in a data row", () => {
    expect(expectFail(["| A | B |", "| --- | --- |", "| 1 |"].join("\n"))).toBe(
      "column-count-mismatch"
    );
  });

  it("rejects mismatched column counts from a data row with too many cells", () => {
    expect(expectFail(["| A | B |", "| --- | --- |", "| 1 | 2 | 3 |"].join("\n"))).toBe(
      "column-count-mismatch"
    );
  });

  it("rejects an unterminated inline code span as ambiguous", () => {
    expect(expectFail(["| A |", "| --- |", "| `unterminated |"].join("\n"))).toBe(
      "ambiguous-inline-code"
    );
  });

  it("rejects a mismatched-length backtick run inside an already-open code span as ambiguous", () => {
    expect(expectFail(["| A |", "| --- |", "| `a `` b` |"].join("\n"))).toBe(
      "ambiguous-inline-code"
    );
  });
});

describe("serializeMarkdownTable: output shape", () => {
  it("emits leading/trailing pipes and single-space padding", () => {
    const lines = serializeMarkdownTable({
      headers: ["A", "B"],
      alignments: ["none", "none"],
      rows: [["1", "2"]],
    });
    expect(lines).toEqual(["| A | B |", "| --- | --- |", "| 1 | 2 |"]);
  });

  it("emits the correct delimiter syntax for every alignment", () => {
    const lines = serializeMarkdownTable({
      headers: ["a", "b", "c", "d"],
      alignments: ["none", "left", "right", "center"],
      rows: [],
    });
    expect(lines[1]).toBe("| --- | :--- | ---: | :---: |");
  });

  it("re-escapes a literal pipe in cell text", () => {
    const lines = serializeMarkdownTable({
      headers: ["A"],
      alignments: ["none"],
      rows: [["a|b"]],
    });
    expect(lines[2]).toBe("| a\\|b |");
  });

  it("does not escape a pipe already protected by an inline code span", () => {
    const lines = serializeMarkdownTable({
      headers: ["A"],
      alignments: ["none"],
      rows: [["`a|b`"]],
    });
    expect(lines[2]).toBe("| `a|b` |");
  });

  it("returns lines with no trailing newline", () => {
    const lines = serializeMarkdownTable({ headers: ["A"], alignments: ["none"], rows: [] });
    for (const line of lines) {
      expect(line.endsWith("\n")).toBe(false);
    }
  });
});

describe("round-trip stability", () => {
  const models: EditableMarkdownTable[] = [
    { headers: ["A", "B"], alignments: ["none", "none"], rows: [["1", "2"]] },
    {
      headers: ["Name", "Age", "Notes"],
      alignments: ["left", "right", "center"],
      rows: [
        ["Alice", "30", "n/a"],
        ["Bob", "25", "likes | pipes"],
      ],
    },
    { headers: ["Code"], alignments: ["none"], rows: [["`a|b|c`"]] },
    { headers: ["Mixed"], alignments: ["none"], rows: [["has \\ backslash and `code|here`"]] },
    { headers: ["Empty col"], alignments: ["none"], rows: [[""]] },
    { headers: ["No rows"], alignments: ["center"], rows: [] },
  ];

  it.each(models.map((m, i) => [i, m] as const))(
    "parse(serialize(model)) reproduces model %#",
    (_i, model) => {
      const raw = serializeMarkdownTable(model).join("\n");
      const reparsed = parseMarkdownTable(raw);
      expect(reparsed.ok).toBe(true);
      if (reparsed.ok) expect(reparsed.table).toEqual(model);
    }
  );

  const rawSamples: string[] = [
    "| A | B |\n| --- | --- |\n| 1 | 2 |",
    "A | B\n--- | ---\n1 | 2",
    "| A |\n| :---: |\n| `x\\|y` |\n| plain |",
    "|  Spaced  |\n|  :---  |\n|  cell text  |",
  ];

  it.each(rawSamples.map((r, i) => [i, r] as const))(
    "serialize(parse(raw)) re-parses to the same structure %#",
    (_i, raw) => {
      const parsed = parseMarkdownTable(raw);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const reserialized = serializeMarkdownTable(parsed.table).join("\n");
      const reparsed = parseMarkdownTable(reserialized);
      expect(reparsed.ok).toBe(true);
      if (reparsed.ok) expect(reparsed.table).toEqual(parsed.table);
    }
  );
});

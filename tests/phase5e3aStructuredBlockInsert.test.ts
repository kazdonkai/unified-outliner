/**
 * Phase 5E-3a ("ツリーペインでの fenced-code / table 新規挿入"): pure-layer
 * tests for src/edit/codeBlockPresets.ts and src/edit/insertStructuredBlock.ts.
 * Real parse -> scan -> match pipeline, no mocking, no Editor.
 */
import { describe, expect, it } from "vitest";
import {
  buildFencedCodeBlockLines,
  buildTableTemplateLines,
  CODE_BLOCK_PRESETS,
  DEFAULT_TABLE_COLUMNS,
  findCodeBlockPreset,
  MAX_TABLE_COLUMNS,
  validateCustomInfoString,
} from "../src/edit/codeBlockPresets";
import {
  computeRequiredBlankLines,
  findInsertedStructuredBlockId,
  insertBlockAtPosition,
  insertStructuredBlockBelowNode,
  resolveStructuredInsertionPoint,
  StructuredBlockKind,
} from "../src/edit/insertStructuredBlock";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { extractSubtreeText, applySubtreeEdit } from "../src/edit/partialEdit";
import { getEnabledCompositeBlockRules, DEFAULT_COMPOSITE_BLOCK_SETTINGS } from "../src/settingsDefaults";

const RULES = getEnabledCompositeBlockRules(DEFAULT_COMPOSITE_BLOCK_SETTINGS);

function nodeIdAtLine(text: string, line: number): string {
  const doc = parseDocument(text);
  for (const n of doc.nodes.values()) if (n.range.startLine === line) return n.id;
  throw new Error(`no node at line ${line}`);
}

function insert(text: string, line: number, kind: StructuredBlockKind, blockLines: string[]) {
  return insertStructuredBlockBelowNode(text, nodeIdAtLine(text, line), kind, blockLines, RULES);
}

/** Asserts that removing the inserted segment restores the original text byte-for-byte. */
function expectOnlyInserted(original: string, result: string[], from: number, count: number): void {
  const restored = [...result.slice(0, from), ...result.slice(from + count)];
  expect(restored.join("\n")).toBe(original);
}

describe("CodeBlockPreset registry", () => {
  it("covers every preset the ticket requires, in the Phase 5E-3 selector order", () => {
    const ids = CODE_BLOCK_PRESETS.map((p) => p.id);
    for (const required of ["", "mermaid", "dataview", "dataviewjs", "javascript", "typescript", "python", "yaml", "json", "sql"]) {
      expect(ids).toContain(required);
    }
    expect(ids).toEqual(["", "mermaid", "dataview", "dataviewjs", "javascript", "typescript", "python", "bash", "sql", "json", "yaml", "css", "html"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Mermaid carries the flowchart template", () => {
    expect(findCodeBlockPreset("mermaid")?.bodyTemplate).toBe("flowchart TD\n");
  });

  it.each(CODE_BLOCK_PRESETS.map((p) => [p.id === "" ? "(plain)" : p.id, p] as const))(
    "preset %s builds a fenced block that scans as a supported fenced-code with its info string",
    (_label, preset) => {
      const lines = buildFencedCodeBlockLines(preset.infoString, preset.bodyTemplate);
      expect(lines[0]).toBe("```" + preset.infoString);
      expect(lines[lines.length - 1]).toBe("```");
      const scan = scanComplexBlocks(parseDocument(lines.join("\n")));
      const fenced = scan.blocks.filter((b) => b.kind === "fenced-code");
      expect(fenced).toHaveLength(1);
      expect(fenced[0].editability).toBe("supported");
      expect(fenced[0].infoString).toBe(preset.infoString);
      expect(fenced[0].range).toEqual({ startLine: 0, endLine: lines.length - 1 });
    }
  );

  it("plain = open fence, one empty body line, close fence; mermaid = template lines", () => {
    expect(buildFencedCodeBlockLines("", "")).toEqual(["```", "", "```"]);
    expect(buildFencedCodeBlockLines("mermaid", "flowchart TD\n")).toEqual(["```mermaid", "flowchart TD", "", "```"]);
  });

  it("validates custom info strings", () => {
    expect(validateCustomInfoString("  rust  ")).toEqual({ ok: true, infoString: "rust" });
    expect(validateCustomInfoString("")).toEqual({ ok: true, infoString: "" });
    expect(validateCustomInfoString("js {.line-numbers}")).toEqual({ ok: true, infoString: "js {.line-numbers}" });
    expect(validateCustomInfoString("a`b")).toEqual({ ok: false, reason: "contains-backtick" });
    expect(validateCustomInfoString("a\nb")).toEqual({ ok: false, reason: "contains-newline" });
    expect(validateCustomInfoString("x".repeat(65))).toEqual({ ok: false, reason: "too-long" });
  });
});

describe("table template", () => {
  it("default is 2 columns x 1 row", () => {
    expect(DEFAULT_TABLE_COLUMNS).toBe(2);
    expect(buildTableTemplateLines(2)).toEqual(["| Column 1 | Column 2 |", "| --- | --- |", "|  |  |"]);
  });

  it.each(Array.from({ length: MAX_TABLE_COLUMNS }, (_, i) => i + 1))(
    "%i column(s) scans as one supported table with matching cell counts",
    (columns) => {
      const lines = buildTableTemplateLines(columns)!;
      expect(lines).toHaveLength(3);
      for (const line of lines) expect(line.split("|").length - 2).toBe(columns);
      const scan = scanComplexBlocks(parseDocument(lines.join("\n")));
      const tables = scan.blocks.filter((b) => b.kind === "table");
      expect(tables).toHaveLength(1);
      expect(tables[0].editability).toBe("supported");
      expect(tables[0].range).toEqual({ startLine: 0, endLine: 2 });
    }
  );

  it.each([0, 9, -1, 2.5, Number.NaN])("rejects column count %s", (columns) => {
    expect(buildTableTemplateLines(columns)).toBeNull();
  });
});

describe("insertBlockAtPosition (shared pure splice)", () => {
  const base = ["a", "", "", "b", "c"];

  it("inserts with the requested padding and reports the block's own range", () => {
    const r = insertBlockAtPosition(base, 4, "X\nY", 1, 1)!;
    expect(r.lines).toEqual(["a", "", "", "b", "", "X", "Y", "", "c"]);
    expect(r.range).toEqual({ startLine: 5, endLine: 6 });
  });

  it("never normalizes existing blank runs (double blank survives)", () => {
    const r = insertBlockAtPosition(base, 2, "X", 0, 0)!;
    expect(r.lines).toEqual(["a", "", "X", "", "b", "c"]);
    const back = [...r.lines.slice(0, 2), ...r.lines.slice(3)];
    expect(back).toEqual(base);
  });

  it("supports start / end of document", () => {
    expect(insertBlockAtPosition(base, 0, "X", 0, 1)!.lines.slice(0, 3)).toEqual(["X", "", "a"]);
    const end = insertBlockAtPosition(base, base.length, "X", 1, 0)!;
    expect(end.lines.slice(-2)).toEqual(["", "X"]);
    expect(end.range).toEqual({ startLine: 6, endLine: 6 });
  });

  it("does not mutate its input and rejects invalid arguments", () => {
    const copy = [...base];
    insertBlockAtPosition(base, 1, "X", 1, 1);
    expect(base).toEqual(copy);
    expect(insertBlockAtPosition(base, -1, "X", 0, 0)).toBeNull();
    expect(insertBlockAtPosition(base, 6, "X", 0, 0)).toBeNull();
    expect(insertBlockAtPosition(base, 1, "X", -1, 0)).toBeNull();
    expect(insertBlockAtPosition(base, 1, "", 0, 0)).toBeNull();
  });

  it("computeRequiredBlankLines only pads against non-blank neighbours", () => {
    expect(computeRequiredBlankLines(base, 0)).toEqual({ before: 0, after: 1 });
    expect(computeRequiredBlankLines(base, 1)).toEqual({ before: 1, after: 0 });
    expect(computeRequiredBlankLines(base, 2)).toEqual({ before: 0, after: 0 });
    expect(computeRequiredBlankLines(base, 4)).toEqual({ before: 1, after: 1 });
    expect(computeRequiredBlankLines(base, 5)).toEqual({ before: 1, after: 0 });
  });
});

const CODE = buildFencedCodeBlockLines("mermaid", "flowchart TD\n");
const TABLE = buildTableTemplateLines(2)!;

describe("insert below a section heading", () => {
  const text = ["# Title", "intro paragraph", "", "## Sub", "- a", "- b", "", "tail"].join("\n");

  it("fenced-code goes right after the heading, padded, rest of the note untouched", () => {
    const out = insert(text, 0, "fenced-code", CODE);
    expect(out.changed).toBe(true);
    expect(out.lines.slice(0, 7)).toEqual(["# Title", "", "```mermaid", "flowchart TD", "", "```", ""]);
    expect(out.insertedRange).toEqual({ startLine: 2, endLine: 5 });
    expect(out.newStartLine).toBe(2);
    expectOnlyInserted(text, out.lines, 1, 6);
  });

  it("table after a heading followed by a blank line adds only the leading blank", () => {
    const t = ["## H", "", "para"].join("\n");
    const out = insert(t, 0, "table", TABLE);
    expect(out.lines).toEqual(["## H", "", ...TABLE, "", "para"]);
    expectOnlyInserted(t, out.lines, 1, 4);
  });

  it("heading as the last line (no trailing newline)", () => {
    const t = "text\n\n## Last";
    const out = insert(t, 2, "table", TABLE);
    expect(out.lines).toEqual(["text", "", "## Last", "", ...TABLE]);
    expectOnlyInserted(t, out.lines, 3, 4);
  });

  it("heading immediately followed by an existing fence keeps both fences paired", () => {
    const t = ["## H", "```js", "x", "```", "after"].join("\n");
    const out = insert(t, 0, "fenced-code", buildFencedCodeBlockLines("", ""));
    expect(out.changed).toBe(true);
    expect(out.lines).toEqual(["## H", "", "```", "", "```", "", "```js", "x", "```", "after"]);
    const fenced = scanComplexBlocks(parseDocument(out.lines.join("\n"))).blocks.filter((b) => b.kind === "fenced-code");
    expect(fenced.map((b) => [b.range.startLine, b.range.endLine, b.editability])).toEqual([
      [2, 4, "supported"],
      [6, 8, "supported"],
    ]);
  });

  it("new block id can be found fresh and opens in Partial Edit (fenced body excludes fences)", () => {
    const out = insert(text, 3, "fenced-code", CODE);
    const after = out.lines.join("\n");
    const id = findInsertedStructuredBlockId(after, "fenced-code", out.insertedRange!);
    expect(id).not.toBeNull();
    const extracted = extractSubtreeText(parseDocument(after), id!);
    expect(extracted.ok).toBe(true);
    expect(extracted.kind).toBe("fenced-code");
    expect(extracted.text).toBe("flowchart TD\n");
  });

  it("inserted table round-trips through the raw table Partial Edit Apply", () => {
    const out = insert(text, 0, "table", TABLE);
    const after = out.lines.join("\n");
    const id = findInsertedStructuredBlockId(after, "table", out.insertedRange!)!;
    const extracted = extractSubtreeText(parseDocument(after), id);
    expect(extracted.ok).toBe(true);
    expect(extracted.kind).toBe("table");
    const edited = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const applied = applySubtreeEdit(parseDocument(after), id, extracted.text, edited);
    expect(applied.reason).toBeUndefined();
    expect(applied.changed).toBe(true);
    expect(applied.lines.slice(out.insertedRange!.startLine, out.insertedRange!.endLine + 1)).toEqual(edited.split("\n"));
  });
});

describe("insert below a list item", () => {
  it("after the last root item of a list: block follows the list, list untouched", () => {
    const t = ["## S", "- a", "- b", "  - b1", "", "para"].join("\n");
    const out = insert(t, 2, "fenced-code", CODE);
    expect(out.changed).toBe(true);
    expect(out.lines).toEqual(["## S", "- a", "- b", "  - b1", "", ...CODE, "", "para"]);
    expectOnlyInserted(t, out.lines, 5, CODE.length + 1);
  });

  it("last item at end of document (trailing newline preserved)", () => {
    const t = "- a\n- b\n";
    const out = insert(t, 1, "table", TABLE);
    expect(out.lines).toEqual(["- a", "- b", "", ...TABLE, ""]);
  });

  it("followed directly by a heading", () => {
    const t = ["- a", "## Next"].join("\n");
    const out = insert(t, 0, "table", TABLE);
    expect(out.lines).toEqual(["- a", "", ...TABLE, "", "## Next"]);
  });

  it("refuses a middle item (would split the list)", () => {
    const t = ["- a", "- b", "- c"].join("\n");
    const out = insert(t, 1, "fenced-code", CODE);
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("structured-insert-inside-list");
    expect(out.lines.join("\n")).toBe(t);
  });

  it("refuses a loose-list item followed by another item after a blank line", () => {
    const t = ["- a", "", "- b"].join("\n");
    expect(insert(t, 0, "table", TABLE).reason).toBe("structured-insert-inside-list");
  });

  it("refuses a nested item (inside a list)", () => {
    const t = ["- a", "  - a1"].join("\n");
    expect(insert(t, 1, "table", TABLE).reason).toBe("structured-insert-inside-list");
  });

  it("an indented continuation the parser attributes to the item stays inside it (block goes after)", () => {
    const t = ["- a", "", "   continued"].join("\n");
    const out = insert(t, 0, "table", TABLE);
    expect(out.changed).toBe(true);
    expect(out.lines).toEqual(["- a", "", "   continued", "", ...TABLE]);
  });
});

describe("rejections keep the note byte-identical", () => {
  it("unknown node id", () => {
    const t = "# A\n";
    const out = insertStructuredBlockBelowNode(t, "no-such-id", "table", TABLE, RULES);
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("resolve-failed");
    expect(out.lines.join("\n")).toBe(t);
  });

  it("invalid template lines", () => {
    const t = "# A\n";
    const id = nodeIdAtLine(t, 0);
    expect(insertStructuredBlockBelowNode(t, id, "table", [], RULES).reason).toBe("structured-insert-invalid-template");
    expect(insertStructuredBlockBelowNode(t, id, "table", ["a\nb"], RULES).reason).toBe("structured-insert-invalid-template");
  });

  it("a block that would not be recognized as the requested kind is refused", () => {
    const t = "# A\n";
    const out = insertStructuredBlockBelowNode(t, nodeIdAtLine(t, 0), "table", ["not a table"], RULES);
    expect(out.reason).toBe("structured-insert-not-recognized");
  });

  it("a template that would break an existing fence pairing is refused", () => {
    // An unterminated open fence template would swallow the rest of the note.
    const t = ["# A", "```js", "x", "```"].join("\n");
    const out = insertStructuredBlockBelowNode(t, nodeIdAtLine(t, 0), "fenced-code", ["```", "y"], RULES);
    expect(out.changed).toBe(false);
    expect(out.lines.join("\n")).toBe(t);
  });

  it("inserting between a list item and the callout it forms a composite with is refused", () => {
    const t = ["## S", "- see note", "> [!note]", "> body"].join("\n");
    const doc = parseDocument(t);
    const composites = matchCompositeBlocks(doc, scanComplexBlocks(doc), RULES);
    expect(composites).toHaveLength(1);
    const out = insert(t, 1, "table", TABLE);
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("structured-insert-structure-changed");
    expect(out.lines.join("\n")).toBe(t);
  });

  it("pre-existing tables / fences / callouts elsewhere survive a section-start insert unchanged", () => {
    const t = ["# A", "para", "", "| x | y |", "| - | - |", "| 1 | 2 |", "", "```py", "print(1)", "```", "", "> [!tip]", "> hi"].join("\n");
    const out = insert(t, 0, "fenced-code", buildFencedCodeBlockLines("sql", ""));
    expect(out.changed).toBe(true);
    expectOnlyInserted(t, out.lines, 1, 5);
  });

  it("resolveStructuredInsertionPoint agrees with the insert for menu gating", () => {
    const t = ["# A", "- a", "- b"].join("\n");
    const doc = parseDocument(t);
    expect(resolveStructuredInsertionPoint(doc, nodeIdAtLine(t, 0))).toEqual({ ok: true, insertAt: 1 });
    expect(resolveStructuredInsertionPoint(doc, nodeIdAtLine(t, 1)).ok).toBe(false);
    expect(resolveStructuredInsertionPoint(doc, nodeIdAtLine(t, 2))).toEqual({ ok: true, insertAt: 3 });
  });
});

/**
 * Phase 5E-0 ("Fenced Code Block / Markdown Table 読み取り専用 Outline Tree
 * 投影基盤"): tests for the read-only standalone Tree projection of
 * fenced-code and table ComplexBlockInfo values — tree/buildOutlineTree.ts's
 * widened isStandaloneComplexBlockEligible / standaloneComplexBlockLabel /
 * buildStandaloneComplexNode, and the two new independent opt-in flags
 * (BuildOutlineTreeOptions.standaloneComplexBlocks.includeFencedCode/
 * includeTables).
 *
 * Mirrors the existing "buildOutlineTree (Phase 5C-2: standalone
 * callout/blockquote projection...)" and "standaloneComplexBlockLabel
 * (Phase 5C-2, ラベル生成)" describe blocks in tests/buildOutlineTree.test.ts
 * in both shape and spirit — this file adds the fenced-code/table
 * equivalents rather than folding into those existing, callout/blockquote-
 * scoped blocks.
 *
 * Category coverage (per this ticket's own required test plan):
 *   A. Projection + label generation
 *   B. Parent/child placement
 *   C. Rejection / non-projection (unterminated fence, malformed table,
 *      unsupported editability)
 *   Settings gating: each opt-in flag independently controls its own kind,
 *   off by default.
 *
 * Navigation (D) lives in phase5e0FencedCodeTableNavigation.test.ts;
 * read-only UI-entry-point defense (E) and regression (F) live in
 * phase5e0FencedCodeTableUiWiring.test.ts — same file-per-concern split the
 * rest of this suite already uses.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { ComplexBlockInfo } from "../src/model/complexBlock";
import { createTranslator } from "../src/i18n";
import {
  buildOutlineTree,
  flattenOutlineTree,
  isOutlineComplexMemberNode,
  isOutlineListNode,
  isOutlineSectionNode,
  standaloneComplexBlockLabel,
  STANDALONE_FENCED_CODE_PREFIX,
  STANDALONE_TABLE_PREFIX,
} from "../src/tree/buildOutlineTree";

/**
 * Builds a tree with fenced-code/table standalone projection turned on —
 * defaults both flags to true (most tests in this file want both kinds
 * exercisable); a handful of tests below pass an explicit narrower `opts`
 * to check each flag's independence.
 */
function treeWithCodeTable(
  text: string,
  opts: { includeLists?: boolean; includeFencedCode?: boolean; includeTables?: boolean } = {}
) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const tree = buildOutlineTree(doc, {
    includeLists: opts.includeLists ?? false,
    standaloneComplexBlocks: {
      blocks: complexScan.blocks,
      includeFencedCode: opts.includeFencedCode ?? true,
      includeTables: opts.includeTables ?? true,
    },
    t: createTranslator("en"),
  });
  return { doc, complexScan, tree };
}

describe("buildOutlineTree (Phase 5E-0: fenced-code/table standalone projection — settings gating)", () => {
  it("projects NEITHER kind when standaloneComplexBlocks is entirely omitted (pre-Phase-5E-0 default, no regression)", () => {
    const text = ["# H", "```ts", "code", "```", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const doc = parseDocument(text);
    const tree = buildOutlineTree(doc, { t: createTranslator("en") });
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children).toHaveLength(0);
  });

  it("projects NEITHER kind when includeFencedCode/includeTables are both omitted/false (opt-in default off)", () => {
    const text = ["# H", "```ts", "code", "```", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const { tree } = treeWithCodeTable(text, { includeFencedCode: false, includeTables: false });
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children).toHaveLength(0);
  });

  it("includeFencedCode and includeTables are independent — code on/table off projects only the code row", () => {
    const text = ["# H", "```ts", "code", "```", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const { tree } = treeWithCodeTable(text, { includeFencedCode: true, includeTables: false });
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const rows = section.children.filter(isOutlineComplexMemberNode);
    expect(rows.map((r) => r.complexKind)).toEqual(["fenced-code"]);
  });

  it("includeFencedCode and includeTables are independent — table on/code off projects only the table row", () => {
    const text = ["# H", "```ts", "code", "```", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const { tree } = treeWithCodeTable(text, { includeFencedCode: false, includeTables: true });
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const rows = section.children.filter(isOutlineComplexMemberNode);
    expect(rows.map((r) => r.complexKind)).toEqual(["table"]);
  });

  it("STANDALONE_FENCED_CODE_PREFIX / STANDALONE_TABLE_PREFIX are fixed display constants, not i18n keys, distinct from every existing prefix", () => {
    expect(STANDALONE_FENCED_CODE_PREFIX).toBe("◫ ");
    expect(STANDALONE_TABLE_PREFIX).toBe("▦ ");
  });
});

describe("buildOutlineTree (Phase 5E-0: fenced-code/table standalone projection — placement / category B)", () => {
  it("projects a section-direct fenced-code block as that section's own child row, with the fenced-code prefix", () => {
    const text = ["# H", "```ts", "const x = 1;", "```"].join("\n");
    const { tree } = treeWithCodeTable(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children).toHaveLength(1);
    const [row] = section.children;
    if (!isOutlineComplexMemberNode(row)) throw new Error("expected complex-member");
    expect(row.isStandalone).toBe(true);
    expect(row.complexKind).toBe("fenced-code");
    expect(row.prefix).toBe(STANDALONE_FENCED_CODE_PREFIX);
    expect(row.line).toBe(1);
  });

  it("projects a section-direct table block as that section's own child row, with the table prefix", () => {
    const text = ["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const { tree } = treeWithCodeTable(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const [row] = section.children;
    if (!isOutlineComplexMemberNode(row)) throw new Error("expected complex-member");
    expect(row.complexKind).toBe("table");
    expect(row.prefix).toBe(STANDALONE_TABLE_PREFIX);
  });

  it("projects a fenced-code/table block with no enclosing section as a top-level (root) row", () => {
    const text = ["```", "top-level code", "```"].join("\n");
    const { tree } = treeWithCodeTable(text);
    expect(tree).toHaveLength(1);
    const [row] = tree;
    if (!isOutlineComplexMemberNode(row)) throw new Error("expected complex-member");
    expect(row.complexKind).toBe("fenced-code");
  });

  it("orders multiple standalone code/table siblings by their own document line order", () => {
    const text = [
      "# H",
      "```ts",
      "first",
      "```",
      "| a |",
      "|---|",
      "| 1 |",
      "```py",
      "second",
      "```",
    ].join("\n");
    const { tree } = treeWithCodeTable(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    const rows = section.children.filter(isOutlineComplexMemberNode);
    expect(rows.map((r) => r.complexKind)).toEqual(["fenced-code", "table", "fenced-code"]);
  });

  it("projects a fenced-code block nested in a list item's continuation as that list item's own child when includeLists is on", () => {
    const text = ["# H", "- item text", "  ```ts", "  code in list", "  ```"].join("\n");
    const { tree } = treeWithCodeTable(text, { includeLists: true });
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children.map((n) => n.kind)).toEqual(["list"]);
    const [listNode] = section.children;
    if (!isOutlineListNode(listNode)) throw new Error("expected list node");
    expect(listNode.children).toHaveLength(1);
    const [codeNode] = listNode.children;
    if (!isOutlineComplexMemberNode(codeNode)) throw new Error("expected complex-member");
    expect(codeNode.complexKind).toBe("fenced-code");
    expect(codeNode.isStandalone).toBe(true);
  });

  it("a list-nested fenced-code block is display-omitted (not shown at the section level either) when includeLists is off — display-only omission, never a parent-relationship reinterpretation", () => {
    const text = ["# H", "- item text", "  ```ts", "  code in list", "  ```"].join("\n");
    const { tree } = treeWithCodeTable(text, { includeLists: false });
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(flattenOutlineTree(section.children).filter(isOutlineComplexMemberNode)).toHaveLength(0);
  });

  it("does not double-project a fenced-code/table block that already has a Tree row via any other mechanism (sanity: these kinds are never CompositeBlock members)", () => {
    const text = ["# H", "```ts", "code", "```"].join("\n");
    const { tree } = treeWithCodeTable(text);
    const flat = flattenOutlineTree(tree);
    const codeRows = flat.filter(isOutlineComplexMemberNode).filter((n) => n.complexKind === "fenced-code");
    expect(codeRows).toHaveLength(1);
  });
});

describe("buildOutlineTree (Phase 5E-0: fenced-code/table standalone projection — rejection / category C)", () => {
  it("never projects an unterminated fence (editability 'ambiguous', never merely hidden-but-eligible)", () => {
    const text = ["# H", "```ts", "const x = 1;"].join("\n");
    const { tree } = treeWithCodeTable(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children).toHaveLength(0);
  });

  it("never projects a malformed table (header/delimiter column-count mismatch, editability 'ambiguous')", () => {
    const text = ["# H", "| a | b | c |", "|---|---|"].join("\n");
    const { tree } = treeWithCodeTable(text);
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children).toHaveLength(0);
  });

  it("never projects any fenced-code/table ComplexBlockInfo whose editability is not 'supported', regardless of kind", () => {
    const doc = parseDocument(["# H", "placeholder"].join("\n"));
    const sectionId = doc.topLevelIds[0];
    const unsupportedCode: ComplexBlockInfo = {
      id: "code-unsupported",
      kind: "fenced-code",
      range: { startLine: 1, endLine: 1 },
      parentId: sectionId,
      childIds: [],
      editability: "unsupported",
      reason: "x",
      infoString: "",
    };
    const readOnlyTable: ComplexBlockInfo = {
      id: "table-readonly",
      kind: "table",
      range: { startLine: 1, endLine: 1 },
      parentId: sectionId,
      childIds: [],
      editability: "read-only",
      reason: "x",
    };
    const doc2 = parseDocument(["# H", "placeholder"].join("\n"));
    const tree = buildOutlineTree(doc2, {
      standaloneComplexBlocks: {
        blocks: [unsupportedCode, readOnlyTable],
        includeFencedCode: true,
        includeTables: true,
      },
      t: createTranslator("en"),
    });
    const section = tree[0];
    if (!isOutlineSectionNode(section)) throw new Error("expected section");
    expect(section.children).toHaveLength(0);
  });
});

describe("standaloneComplexBlockLabel (Phase 5E-0: fenced-code labels)", () => {
  it("uses a literal 'Mermaid:' prefix plus the first non-empty body line", () => {
    const doc = parseDocument(["```mermaid", "graph TD; A-->B;", "```"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(standaloneComplexBlockLabel(doc, info)).toBe("Mermaid: graph TD; A-->B;");
  });

  it("uses a literal 'Dataview:'/'DataviewJS:' prefix for those languages", () => {
    const dv = parseDocument(["```dataview", "TABLE x", "```"].join("\n"));
    expect(standaloneComplexBlockLabel(dv, scanComplexBlocks(dv).blocks[0])).toBe("Dataview: TABLE x");
    const dvjs = parseDocument(["```dataviewjs", "dv.pages()", "```"].join("\n"));
    expect(standaloneComplexBlockLabel(dvjs, scanComplexBlocks(dvjs).blocks[0])).toBe(
      "DataviewJS: dv.pages()"
    );
  });

  it("uses the info string verbatim as the prefix for any other language", () => {
    const doc = parseDocument(["```ts", "const x = 1;", "```"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(standaloneComplexBlockLabel(doc, info)).toBe("ts: const x = 1;");
  });

  it("falls back to the translated 'Code block' text as the prefix when the info string is empty", () => {
    const doc = parseDocument(["```", "no language here", "```"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(standaloneComplexBlockLabel(doc, info, createTranslator("en"))).toBe(
      "Code block: no language here"
    );
    expect(standaloneComplexBlockLabel(doc, info, createTranslator("ja"))).toBe(
      "コードブロック: no language here"
    );
  });

  it("returns just the prefix (no ': ' body) for an entirely empty code block", () => {
    const doc = parseDocument(["```ts", "```"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(standaloneComplexBlockLabel(doc, info)).toBe("ts");
    const doc2 = parseDocument(["```", "```"].join("\n"));
    expect(standaloneComplexBlockLabel(doc2, scanComplexBlocks(doc2).blocks[0], createTranslator("en"))).toBe(
      "Code block"
    );
  });

  it("skips blank lines to find the first non-empty body line", () => {
    const doc = parseDocument(["```ts", "", "  ", "const x = 1;", "```"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(standaloneComplexBlockLabel(doc, info)).toBe("ts: const x = 1;");
  });

  it("normalizes embedded whitespace/newlines in the summarized body line to single spaces", () => {
    const doc = parseDocument(["```ts", "const   x   =   1;", "```"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(standaloneComplexBlockLabel(doc, info)).toBe("ts: const x = 1;");
  });

  it("never uses the opening or closing fence line itself as the body summary (only the info string feeds the prefix, verbatim)", () => {
    const doc = parseDocument(["```ts title=x", "actual code", "```"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(info.infoString).toBe("ts title=x");
    const label = standaloneComplexBlockLabel(doc, info);
    // The whole info string is the (untranslated, literal) prefix — but the
    // BODY half of the label is always the first body line, never a second
    // copy of anything from the opening fence line itself.
    expect(label).toBe("ts title=x: actual code");
  });

  it("truncates an overly long summarized label to 80 characters with a trailing ellipsis", () => {
    const longBody = "x".repeat(120);
    const doc = parseDocument(["```", longBody, "```"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    const label = standaloneComplexBlockLabel(doc, info);
    expect(label.length).toBe(80);
    expect(label.endsWith("…")).toBe(true);
  });

  it("does not execute, render, or otherwise interpret the code body (label is plain string scanning only)", () => {
    const doc = parseDocument(["```js", "throw new Error('should never run');", "```"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(() => standaloneComplexBlockLabel(doc, info)).not.toThrow();
    expect(standaloneComplexBlockLabel(doc, info)).toContain("throw new Error");
  });
});

describe("standaloneComplexBlockLabel (Phase 5E-0: table labels)", () => {
  it("summarizes the header row's column names, joined with ' / '", () => {
    const doc = parseDocument(["| Name | Age | City |", "|---|---|---|", "| a | 1 | x |"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(standaloneComplexBlockLabel(doc, info, createTranslator("en"))).toBe(
      "Table: Name / Age / City"
    );
  });

  it("uses the translated 'Table' word as the prefix, in both locales", () => {
    const doc = parseDocument(["| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(standaloneComplexBlockLabel(doc, info, createTranslator("en"))).toBe("Table: a / b");
    expect(standaloneComplexBlockLabel(doc, info, createTranslator("ja"))).toBe("テーブル: a / b");
  });

  it("drops empty header cells from the summary rather than showing blank slots", () => {
    const doc = parseDocument(["| a |  | c |", "|---|---|---|", "| 1 | 2 | 3 |"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(standaloneComplexBlockLabel(doc, info, createTranslator("en"))).toBe("Table: a / c");
  });

  it("falls back to the fixed 'Table' label when every header cell is empty (nothing usable to summarize)", () => {
    const doc = parseDocument(["|  |  |", "|---|---|", "| 1 | 2 |"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    expect(standaloneComplexBlockLabel(doc, info, createTranslator("en"))).toBe("Table");
  });

  it("never introduces a full table parser dependency — a header cell containing a backslash-pipe sequence still produces a safe, non-throwing label (no escaped-pipe handling, by design — the escaped pipe is naively split like any other, matching the scanner's own splitTableRow exactly, which is why the delimiter row below needs 4 columns, not 3)", () => {
    const doc = parseDocument(
      ["| weird \\| cell | b | c |", "|---|---|---|---|", "| w | x | y | z |"].join("\n")
    );
    const info = scanComplexBlocks(doc).blocks[0];
    expect(info.editability).toBe("supported");
    expect(() => standaloneComplexBlockLabel(doc, info)).not.toThrow();
  });

  it("truncates an overly long header summary to 80 characters with a trailing ellipsis", () => {
    const longHeader = "x".repeat(40);
    const doc = parseDocument([`| ${longHeader} | ${longHeader} |`, "|---|---|", "| 1 | 2 |"].join("\n"));
    const info = scanComplexBlocks(doc).blocks[0];
    const label = standaloneComplexBlockLabel(doc, info);
    expect(label.length).toBe(80);
    expect(label.endsWith("…")).toBe(true);
  });
});

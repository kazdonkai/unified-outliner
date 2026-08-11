/**
 * Phase 5C: recognition-only tests for parser/complexBlocks.ts.
 *
 * Per the approved Phase 5C design, these tests prioritize NOT
 * misrecognizing structure and safely REFUSING uncertain cases over
 * covering every positive-path variant: unterminated fences, malformed
 * tables, nested callouts, cross-boundary spans, and scanner-vs-scanner
 * overlaps all get explicit coverage asserting a safe (never "supported")
 * outcome, alongside a smaller set of normal-case sanity checks.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { BlockNode, isListNode, isSectionNode, ParsedDocument, SectionBlockNode } from "../src/model/block";
import { ComplexBlockInfo } from "../src/model/complexBlock";
import {
  describeComplexBlockRejection,
  mergeBlockRangesSafely,
  scanBlockquoteBlocks,
  scanCalloutBlocks,
  scanComplexBlocks,
  scanFencedCodeBlocks,
  scanParagraphBlocks,
  scanTableBlocks,
} from "../src/parser/complexBlocks";

function sectionIdOf(doc: ParsedDocument, headingText: string): string {
  for (const n of doc.nodes.values()) {
    if (isSectionNode(n) && n.headingText === headingText) return n.id;
  }
  throw new Error(`no section named ${headingText}`);
}

function listIdOf(doc: ParsedDocument, needle: string): string {
  for (const n of doc.nodes.values()) {
    if (isListNode(n) && doc.lines[n.range.startLine].includes(needle)) return n.id;
  }
  throw new Error(`no list item matching "${needle}"`);
}

// ---------------------------------------------------------------------
// Callout
// ---------------------------------------------------------------------
describe("scanCalloutBlocks", () => {
  it("recognizes a basic callout with a title and multi-line body as supported", () => {
    const text = ["# H", "> [!note] Title text", "> line1", "> line2"].join("\n");
    const doc = parseDocument(text);
    const { blocks, diagnostics } = scanCalloutBlocks(doc);
    expect(diagnostics).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("callout");
    expect(blocks[0].range).toEqual({ startLine: 1, endLine: 3 });
    expect(blocks[0].editability).toBe("supported");
    expect(blocks[0].parentId).toBe(sectionIdOf(doc, "H"));
  });

  it("recognizes fold-marker variants (+/-) as callout starts", () => {
    const plus = parseDocument(["> [!warning]+", "> body"].join("\n"));
    const minus = parseDocument(["> [!warning]-", "> body"].join("\n"));
    expect(scanCalloutBlocks(plus).blocks).toHaveLength(1);
    expect(scanCalloutBlocks(minus).blocks).toHaveLength(1);
  });

  it("includes an empty quoted line ('>' alone) as part of the callout body", () => {
    const text = ["> [!note]", ">", "> after blank quote"].join("\n");
    const doc = parseDocument(text);
    const { blocks } = scanCalloutBlocks(doc);
    expect(blocks[0].range).toEqual({ startLine: 0, endLine: 2 });
  });

  it("terminates at the first non-quoted line, not absorbing what follows", () => {
    const text = ["> [!note]", "> body", "Not quoted anymore.", "- item"].join("\n");
    const doc = parseDocument(text);
    const { blocks } = scanCalloutBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].range).toEqual({ startLine: 0, endLine: 1 });
  });

  it("does NOT recognize an ordinary blockquote without a [!type] marker", () => {
    const text = ["> just a quote, not a callout", "> more quote"].join("\n");
    const doc = parseDocument(text);
    expect(scanCalloutBlocks(doc).blocks).toEqual([]);
  });

  it("never starts or continues a callout scan across a fenced-code line (does not misread '>' inside a fence as a callout)", () => {
    const text = ["```", "> [!note] this looks like a callout but is code", "> body", "```"].join("\n");
    const doc = parseDocument(text);
    expect(scanCalloutBlocks(doc).blocks).toEqual([]);
  });

  it("a callout containing a nested callout is reported unsupported with an unsupported-callout-nesting diagnostic, never supported", () => {
    const text = ["> [!note]", "> > [!tip]", "> > nested body", "> back to outer"].join("\n");
    const doc = parseDocument(text);
    const { blocks, diagnostics } = scanCalloutBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].editability).toBe("unsupported");
    expect(blocks[0].childIds).toEqual([]);
    expect(diagnostics.some((d) => d.kind === "unsupported-callout-nesting")).toBe(true);
  });

  it("a top-level callout (no enclosing heading) gets parentId null without being ambiguous", () => {
    const text = ["> [!note]", "> body"].join("\n");
    const doc = parseDocument(text);
    const { blocks } = scanCalloutBlocks(doc);
    expect(blocks[0].parentId).toBeNull();
    expect(blocks[0].editability).toBe("supported");
  });
});

// ---------------------------------------------------------------------
// Blockquote (ordinary quote, syntax-shared with callout but disjoint by
// construction — see parser/complexBlocks.ts's scanQuoteRuns doc comment)
// ---------------------------------------------------------------------
describe("scanBlockquoteBlocks", () => {
  it("recognizes a normal blockquote's start and end (no [!type] marker), as supported", () => {
    const text = ["# H", "> just a quote, not a callout", "> more quote", "Not quoted anymore."].join("\n");
    const doc = parseDocument(text);
    const { blocks, diagnostics } = scanBlockquoteBlocks(doc);
    expect(diagnostics).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("blockquote");
    expect(blocks[0].range).toEqual({ startLine: 1, endLine: 2 });
    expect(blocks[0].editability).toBe("supported");
    expect(blocks[0].parentId).toBe(sectionIdOf(doc, "H"));
  });

  it("includes an empty quoted line ('>' alone) as part of the blockquote body", () => {
    const text = ["> plain quote", ">", "> after blank quote"].join("\n");
    const doc = parseDocument(text);
    const { blocks } = scanBlockquoteBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].range).toEqual({ startLine: 0, endLine: 2 });
  });

  it("a callout immediately adjacent to a plain blockquote is split into two separate, correctly-kinded blocks, not merged", () => {
    // Two SEPARATE quote runs (blank line 2 breaks contiguity), one callout
    // and one plain blockquote.
    const text = ["> [!note] callout body", "> more callout", "", "> plain quote", "> more plain quote"].join(
      "\n"
    );
    const doc = parseDocument(text);
    const { blocks: callouts } = scanCalloutBlocks(doc);
    const { blocks: blockquotes } = scanBlockquoteBlocks(doc);
    expect(callouts).toHaveLength(1);
    expect(callouts[0].range).toEqual({ startLine: 0, endLine: 1 });
    expect(blockquotes).toHaveLength(1);
    expect(blockquotes[0].range).toEqual({ startLine: 3, endLine: 4 });
  });

  it("a callout's own quote lines are NEVER also reported as a blockquote (no double registration)", () => {
    const text = ["> [!note]", "> line1", "> line2"].join("\n");
    const doc = parseDocument(text);
    const { blocks: callouts } = scanCalloutBlocks(doc);
    const { blocks: blockquotes } = scanBlockquoteBlocks(doc);
    expect(callouts).toHaveLength(1);
    expect(blockquotes).toEqual([]);
  });

  it("a blockquote's own quote lines are NEVER also reported as a callout", () => {
    const text = ["> plain quote only", "> still plain"].join("\n");
    const doc = parseDocument(text);
    expect(scanCalloutBlocks(doc).blocks).toEqual([]);
    expect(scanBlockquoteBlocks(doc).blocks).toHaveLength(1);
  });

  it("a blockquote nested inside a list item's continuation resolves parentId to that list item", () => {
    const text = ["- item1", "  > quoted continuation", "  > more quote", "- item2"].join("\n");
    const doc = parseDocument(text);
    const { blocks } = scanBlockquoteBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].editability).toBe("supported");
    expect(blocks[0].parentId).toBe(listIdOf(doc, "item1"));
  });

  it("callout-like syntax reappearing mid-stream inside a plain blockquote is reported unsupported, not silently flattened or guessed", () => {
    const text = ["> plain quote start", "> [!note] this looks like a callout mid-blockquote", "> more"].join(
      "\n"
    );
    const doc = parseDocument(text);
    const { blocks, diagnostics } = scanBlockquoteBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("blockquote");
    expect(blocks[0].editability).toBe("unsupported");
    expect(blocks[0].childIds).toEqual([]);
    expect(diagnostics.some((d) => d.kind === "unsupported-callout-nesting")).toBe(true);
    // And it must not ALSO show up as a callout candidate.
    expect(scanCalloutBlocks(doc).blocks).toEqual([]);
  });

  it("does not mutate the input ParsedDocument", () => {
    const doc = parseDocument(["# H", "> plain quote", "> more"].join("\n"));
    const nodeCountBefore = doc.nodes.size;
    scanBlockquoteBlocks(doc);
    expect(doc.nodes.size).toBe(nodeCountBefore);
  });
});

// ---------------------------------------------------------------------
// Fenced code (including Mermaid)
// ---------------------------------------------------------------------
describe("scanFencedCodeBlocks", () => {
  it("recognizes a normal closed fence as supported, with its info string captured", () => {
    const text = ["# H", "```ts", "const x = 1;", "```"].join("\n");
    const doc = parseDocument(text);
    const { blocks, diagnostics } = scanFencedCodeBlocks(doc);
    expect(diagnostics).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("fenced-code");
    expect(blocks[0].infoString).toBe("ts");
    expect(blocks[0].editability).toBe("supported");
    expect(blocks[0].parentId).toBe(sectionIdOf(doc, "H"));
  });

  it("reports a mermaid fence as kind fenced-code (not a distinct kind), with infoString 'mermaid'", () => {
    const text = ["```mermaid", "graph TD; A-->B;", "```"].join("\n");
    const doc = parseDocument(text);
    const { blocks } = scanFencedCodeBlocks(doc);
    expect(blocks[0].kind).toBe("fenced-code");
    expect(blocks[0].infoString).toBe("mermaid");
  });

  it("an unterminated fence is ambiguous (never supported, never merely unsupported), with an unterminated-fence diagnostic", () => {
    const text = ["# H", "```ts", "const x = 1;"].join("\n");
    const doc = parseDocument(text);
    const { blocks, diagnostics } = scanFencedCodeBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].editability).toBe("ambiguous");
    expect(blocks[0].parentId).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].kind).toBe("unterminated-fence");
  });

  it("a single-line fence (open immediately followed by EOF) is unterminated, matching parseDocument's own close-check semantics", () => {
    const text = ["```"].join("\n");
    const doc = parseDocument(text);
    const { blocks, diagnostics } = scanFencedCodeBlocks(doc);
    expect(blocks[0].editability).toBe("ambiguous");
    expect(diagnostics[0].kind).toBe("unterminated-fence");
  });

  it("a fence nested inside a list item's continuation resolves parentId to that list item (owner need not be a section)", () => {
    const text = ["- item1", "  ```ts", "  code", "  ```"].join("\n");
    const doc = parseDocument(text);
    const { blocks } = scanFencedCodeBlocks(doc);
    expect(blocks[0].editability).toBe("supported");
    expect(blocks[0].parentId).toBe(listIdOf(doc, "item1"));
  });
});

// ---------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------
describe("scanTableBlocks", () => {
  it("recognizes a well-formed 2-column table as supported", () => {
    const text = ["# H", "| a | b |", "|---|---|", "| 1 | 2 |", "| 3 | 4 |"].join("\n");
    const doc = parseDocument(text);
    const { blocks, diagnostics } = scanTableBlocks(doc);
    expect(diagnostics).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("table");
    expect(blocks[0].range).toEqual({ startLine: 1, endLine: 4 });
    expect(blocks[0].editability).toBe("supported");
    expect(blocks[0].parentId).toBe(sectionIdOf(doc, "H"));
  });

  it("does NOT recognize a lone line containing '|' as a table when no delimiter row follows", () => {
    const text = ["This sentence | has a pipe.", "But this is not a table."].join("\n");
    const doc = parseDocument(text);
    expect(scanTableBlocks(doc).blocks).toEqual([]);
  });

  it("a header/delimiter column-count mismatch is malformed and ambiguous, never supported", () => {
    const text = ["| a | b | c |", "|---|---|"].join("\n");
    const doc = parseDocument(text);
    const { blocks, diagnostics } = scanTableBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].editability).toBe("ambiguous");
    expect(diagnostics.some((d) => d.kind === "malformed-table")).toBe(true);
  });

  it("does not misidentify a list item's text (which happens to contain '|') as a table row", () => {
    const text = ["- item with a | pipe in it", "|---|"].join("\n");
    const doc = parseDocument(text);
    expect(scanTableBlocks(doc).blocks).toEqual([]);
  });

  it("stops the table's body at the first line that no longer looks like a row", () => {
    const text = ["| a | b |", "|---|---|", "| 1 | 2 |", "", "Trailing paragraph."].join("\n");
    const doc = parseDocument(text);
    const { blocks } = scanTableBlocks(doc);
    expect(blocks[0].range).toEqual({ startLine: 0, endLine: 2 });
  });
});

// ---------------------------------------------------------------------
// Paragraph (diagnostic-only; never "supported")
// ---------------------------------------------------------------------
describe("scanParagraphBlocks", () => {
  it("recognizes a section's body paragraph as read-only, never supported", () => {
    const text = ["# H", "Just a paragraph.", "More paragraph."].join("\n");
    const doc = parseDocument(text);
    const { blocks, diagnostics } = scanParagraphBlocks(doc);
    expect(diagnostics).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].editability).toBe("read-only");
    expect(blocks[0].parentId).toBe(sectionIdOf(doc, "H"));
    expect(blocks[0].range).toEqual({ startLine: 1, endLine: 2 });
  });

  it("a leading paragraph before any heading gets parentId null without being ambiguous", () => {
    const text = ["Leading paragraph.", "- item1"].join("\n");
    const doc = parseDocument(text);
    const { blocks } = scanParagraphBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].parentId).toBeNull();
    expect(blocks[0].editability).toBe("read-only");
  });

  it("does NOT claim a list item's own continuation text as an independent paragraph", () => {
    const text = ["- item1", "  continuation of item1", "- item2"].join("\n");
    const doc = parseDocument(text);
    expect(scanParagraphBlocks(doc).blocks).toEqual([]);
  });

  it("never produces editability 'supported' for any paragraph, across mixed scenarios", () => {
    const text = ["# H", "Body one.", "", "- item", "", "Body two after the list."].join("\n");
    const doc = parseDocument(text);
    const { blocks } = scanParagraphBlocks(doc);
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect(b.editability).not.toBe("supported");
  });
});

// ---------------------------------------------------------------------
// resolveParentId's boundary-crossing refusal (synthetic, since a real
// parseDocument() output cannot naturally construct per-line owner
// disagreement — section/list ownership-filling makes this structurally
// hard to trigger organically; see parser/complexBlocks.ts's doc comment).
// ---------------------------------------------------------------------
describe("parentId resolution refuses to guess across a boundary disagreement", () => {
  function fakeDoc(
    lineToOwningNodeId: (string | null)[],
    nodeRanges: Record<string, { startLine: number; endLine: number }>,
    options?: { lines?: string[]; codeBlockLines?: boolean[] }
  ): ParsedDocument {
    const nodes = new Map<string, BlockNode>();
    for (const [id, range] of Object.entries(nodeRanges)) {
      const sectionNode: SectionBlockNode = {
        id,
        type: "section",
        range,
        parentId: null,
        prevSiblingId: null,
        nextSiblingId: null,
        childIds: [],
        depth: 0,
        headingLevel: 1,
        headingText: id,
      };
      nodes.set(id, sectionNode);
    }
    const n = lineToOwningNodeId.length;
    return {
      lines: options?.lines ?? Array.from({ length: n }, () => "```"),
      nodes,
      topLevelIds: Object.keys(nodeRanges),
      lineToOwningNodeId,
      codeBlockLines: options?.codeBlockLines ?? Array.from({ length: n }, () => true),
      frontmatterLines: Array.from({ length: n }, () => false),
    };
  }

  it("two lines of the same fenced-code run disagreeing on owner yields parentId null and editability ambiguous", () => {
    const doc = fakeDoc(
      ["owner-A", "owner-B"],
      { "owner-A": { startLine: 0, endLine: 0 }, "owner-B": { startLine: 1, endLine: 1 } }
    );
    const { blocks, diagnostics } = scanFencedCodeBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].parentId).toBeNull();
    expect(blocks[0].editability).toBe("ambiguous");
    expect(diagnostics.some((d) => d.kind === "ambiguous")).toBe(true);
  });

  it("a consistent owner whose own registered range does not fully contain the block also yields parentId null and ambiguous", () => {
    const doc = fakeDoc(
      ["owner-A", "owner-A"],
      { "owner-A": { startLine: 0, endLine: 0 } } // registered range too short for the 2-line block
    );
    const { blocks } = scanFencedCodeBlocks(doc);
    expect(blocks[0].parentId).toBeNull();
    expect(blocks[0].editability).toBe("ambiguous");
  });

  it("a blockquote whose lines disagree on owner also yields parentId null and editability ambiguous (same policy applied to quote blocks)", () => {
    const doc = fakeDoc(
      ["owner-A", "owner-B"],
      { "owner-A": { startLine: 0, endLine: 0 }, "owner-B": { startLine: 1, endLine: 1 } },
      { lines: ["> plain quote line 1", "> plain quote line 2"], codeBlockLines: [false, false] }
    );
    const { blocks, diagnostics } = scanBlockquoteBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("blockquote");
    expect(blocks[0].parentId).toBeNull();
    expect(blocks[0].editability).toBe("ambiguous");
    expect(diagnostics.some((d) => d.kind === "ambiguous")).toBe(true);
  });
});

// ---------------------------------------------------------------------
// mergeBlockRangesSafely: explicit priority/conflict resolution
// ---------------------------------------------------------------------
describe("mergeBlockRangesSafely", () => {
  function block(kind: ComplexBlockInfo["kind"], startLine: number, endLine: number): ComplexBlockInfo {
    return {
      id: `${kind}-${startLine}`,
      kind,
      range: { startLine, endLine },
      parentId: "sec-x",
      childIds: [],
      editability: "supported",
    };
  }

  it("a higher-priority block is accepted unchanged", () => {
    const { blocks, diagnostics } = mergeBlockRangesSafely([[block("callout", 0, 3)], []]);
    expect(blocks).toEqual([block("callout", 0, 3)]);
    expect(diagnostics).toEqual([]);
  });

  it("a lower-priority block overlapping an accepted higher-priority block is kept but downgraded to ambiguous, with an overlapping-range diagnostic", () => {
    const callout = block("callout", 0, 3);
    const table = block("table", 2, 4); // overlaps lines 2-3
    const { blocks, diagnostics } = mergeBlockRangesSafely([[callout], [table]]);
    expect(blocks).toHaveLength(2);
    const tableResult = blocks.find((b) => b.kind === "table")!;
    expect(tableResult.editability).toBe("ambiguous");
    expect(tableResult.parentId).toBeNull();
    expect(diagnostics.some((d) => d.kind === "overlapping-range")).toBe(true);
  });

  it("non-overlapping blocks from a lower-priority group pass through unchanged", () => {
    const callout = block("callout", 0, 1);
    const paragraph = block("paragraph", 5, 6);
    const { blocks, diagnostics } = mergeBlockRangesSafely([[callout], [paragraph]]);
    expect(blocks).toEqual([callout, paragraph]);
    expect(diagnostics).toEqual([]);
  });

  it("enforces the full priority chain callout > blockquote > (fenced-code, table) > paragraph: each lower tier loses to every higher tier it overlaps", () => {
    const callout = block("callout", 0, 5);
    const blockquote = block("blockquote", 0, 5); // overlaps callout
    const fenced = block("fenced-code", 0, 5); // overlaps callout + blockquote
    const table = block("table", 0, 5); // overlaps callout + blockquote + fenced
    const paragraph = block("paragraph", 0, 5); // overlaps everything

    const { blocks } = mergeBlockRangesSafely([
      [callout],
      [blockquote],
      [fenced],
      [table],
      [paragraph],
    ]);

    const byKind = new Map(blocks.map((b) => [b.kind, b]));
    expect(byKind.get("callout")!.editability).toBe("supported");
    expect(byKind.get("blockquote")!.editability).toBe("ambiguous");
    expect(byKind.get("fenced-code")!.editability).toBe("ambiguous");
    expect(byKind.get("table")!.editability).toBe("ambiguous");
    expect(byKind.get("paragraph")!.editability).toBe("ambiguous");
  });
});

// ---------------------------------------------------------------------
// scanComplexBlocks: end-to-end orchestration
// ---------------------------------------------------------------------
describe("scanComplexBlocks", () => {
  it("a table's own rows are also independently recognized by the lowest-priority paragraph scanner; merge keeps the table supported and downgrades the overlapping paragraph candidate to ambiguous (priority: table > paragraph)", () => {
    // scanTableBlocks and scanParagraphBlocks run independently (see this
    // module's doc comment): scanParagraphBlocks has no special-case
    // exclusion for pipe-table-row-shaped lines, so it legitimately
    // produces a paragraph candidate over the exact same range a
    // successfully-recognized table occupies. This is the intended,
    // naturally-occurring case mergeBlockRangesSafely exists to resolve —
    // not a bug in either scanner.
    const text = ["| a | b |", "|---|---|", "| 1 | 2 |"].join("\n");
    const doc = parseDocument(text);
    const { blocks, diagnostics } = scanComplexBlocks(doc);
    const table = blocks.find((b) => b.kind === "table")!;
    const overlappingParagraphs = blocks.filter((b) => b.kind === "paragraph");
    expect(table.editability).toBe("supported");
    expect(overlappingParagraphs.length).toBeGreaterThan(0);
    for (const p of overlappingParagraphs) {
      expect(p.editability).toBe("ambiguous");
      expect(p.parentId).toBeNull();
    }
    expect(diagnostics.some((d) => d.kind === "overlapping-range")).toBe(true);
  });

  it("a blockquote's own lines are also independently recognized by the paragraph scanner; merge keeps the blockquote supported and downgrades the overlapping paragraph candidate to ambiguous, never the reverse", () => {
    const text = ["> plain quote", "> more plain quote"].join("\n");
    const doc = parseDocument(text);
    const { blocks, diagnostics } = scanComplexBlocks(doc);
    const blockquote = blocks.find((b) => b.kind === "blockquote")!;
    const overlappingParagraphs = blocks.filter((b) => b.kind === "paragraph");
    expect(blockquote.editability).toBe("supported");
    expect(overlappingParagraphs.length).toBeGreaterThan(0);
    for (const p of overlappingParagraphs) expect(p.editability).toBe("ambiguous");
    expect(diagnostics.some((d) => d.kind === "overlapping-range")).toBe(true);
  });

  it("frontmatter lines never produce a ComplexBlockInfo of any kind", () => {
    const text = ["---", "title: x", "---", "", "> [!note]", "> body"].join("\n");
    const doc = parseDocument(text);
    const { blocks } = scanComplexBlocks(doc);
    for (const b of blocks) {
      expect(b.range.startLine).toBeGreaterThanOrEqual(4);
    }
  });

  it("does not mutate the input ParsedDocument (nodes map size/kinds unchanged)", () => {
    const text = ["# H", "> [!note]", "> body", "", "| a |", "|---|", "| 1 |", "", "para text"].join("\n");
    const doc = parseDocument(text);
    const nodeCountBefore = doc.nodes.size;
    const kindsBefore = [...doc.nodes.values()].map((n) => n.type).sort();
    scanComplexBlocks(doc);
    expect(doc.nodes.size).toBe(nodeCountBefore);
    expect([...doc.nodes.values()].map((n) => n.type).sort()).toEqual(kindsBefore);
    for (const n of doc.nodes.values()) {
      expect(n.type === "section" || n.type === "list").toBe(true);
    }
  });

  it("a combined document recognizes one of each kind as supported (or read-only for paragraph), with every kind present", () => {
    const text = [
      "# H",
      "> [!note]",
      "> body",
      "",
      "> plain quote",
      "> more plain quote",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "```ts",
      "code",
      "```",
      "",
      "A trailing paragraph.",
    ].join("\n");
    const doc = parseDocument(text);
    const { blocks } = scanComplexBlocks(doc);

    // No block of any kind is ever "supported" for paragraph, and no
    // recognized block is left as the reserved-but-unused "unsupported"
    // value in this scenario (only ambiguous/unterminated-fence cases use
    // "unsupported", via the nested-callout path — see scanCalloutBlocks).
    expect(blocks.every((b) => !(b.kind === "paragraph" && b.editability === "supported"))).toBe(true);

    // Exactly one genuinely standalone, non-overlapping block of each kind
    // is supported/read-only as expected. (The paragraph scanner also
    // redundantly candidates the callout's, blockquote's, and table's own
    // lines — see the "...own rows/lines..." tests above for why — those
    // extra paragraph candidates are present too, but downgraded to
    // "ambiguous" by merge, never the other way around.)
    const callout = blocks.find((b) => b.kind === "callout")!;
    const blockquote = blocks.find((b) => b.kind === "blockquote")!;
    const table = blocks.find((b) => b.kind === "table")!;
    const fenced = blocks.find((b) => b.kind === "fenced-code")!;
    const trailingParagraph = blocks.find(
      (b) => b.kind === "paragraph" && b.range.startLine === 15
    )!;
    expect(callout.editability).toBe("supported");
    expect(blockquote.editability).toBe("supported");
    expect(table.editability).toBe("supported");
    expect(fenced.editability).toBe("supported");
    expect(trailingParagraph.editability).toBe("read-only");

    const kinds = new Set(blocks.map((b) => b.kind));
    expect(kinds).toEqual(new Set(["callout", "blockquote", "fenced-code", "table", "paragraph"]));
  });
});

// ---------------------------------------------------------------------
// describeComplexBlockRejection
// ---------------------------------------------------------------------
describe("describeComplexBlockRejection", () => {
  it("reports blocked: false for an id that is not a recognized complex block", () => {
    const doc = parseDocument(["# H", "> [!note]", "> body"].join("\n"));
    const result = scanComplexBlocks(doc);
    expect(describeComplexBlockRejection(result, "does-not-exist")).toEqual({ blocked: false });
  });

  it("reports blocked: true with kind and a reason for a recognized paragraph block", () => {
    const doc = parseDocument(["# H", "Just a paragraph."].join("\n"));
    const result = scanComplexBlocks(doc);
    const paragraphId = result.blocks.find((b) => b.kind === "paragraph")!.id;
    const rejection = describeComplexBlockRejection(result, paragraphId);
    expect(rejection.blocked).toBe(true);
    if (rejection.blocked) {
      expect(rejection.kind).toBe("paragraph");
      expect(rejection.editability).toBe("read-only");
      expect(rejection.reason.length).toBeGreaterThan(0);
    }
  });

  it("reports the ambiguous reason for an unterminated fence", () => {
    const doc = parseDocument(["```ts", "code"].join("\n"));
    const result = scanComplexBlocks(doc);
    const fenceId = result.blocks.find((b) => b.kind === "fenced-code")!.id;
    const rejection = describeComplexBlockRejection(result, fenceId);
    expect(rejection.blocked).toBe(true);
    if (rejection.blocked) {
      expect(rejection.editability).toBe("ambiguous");
    }
  });
});

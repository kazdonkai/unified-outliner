import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import {
  describeMoveUnit,
  findComplexSiblingTarget,
  findEnclosingSectionId,
  moveComplexBlock,
  resolveEnclosingSectionId,
  resolveMoveUnit,
} from "../src/move/resolveMoveTarget";

describe("resolveMoveUnit: cursor -> minimal safe block", () => {
  it("resolves the heading LINE to the section (rule 1)", () => {
    const doc = parseDocument(["# H", "body"].join("\n"));
    const r = resolveMoveUnit(doc, 0);
    expect(r.unit?.kind).toBe("section");
  });

  it("resolves an ordinary body paragraph to 'paragraph', NOT the enclosing section (the bug this ticket fixes)", () => {
    const doc = parseDocument(
      ["# H", "a plain paragraph", "more of the same paragraph"].join("\n")
    );
    const r = resolveMoveUnit(doc, 1);
    expect(r.unit?.kind).toBe("paragraph");
    expect(r.unit?.range).toEqual({ startLine: 1, endLine: 2 });
  });

  it("resolves a list item's marker line to 'list' (rule 2)", () => {
    const doc = parseDocument(["# H", "- item"].join("\n"));
    const r = resolveMoveUnit(doc, 1);
    expect(r.unit?.kind).toBe("list");
  });

  it("resolves a list item's continuation (body) line to 'list' as well (rule 2)", () => {
    const doc = parseDocument(["# H", "- item", "  continuation text"].join("\n"));
    const r = resolveMoveUnit(doc, 2);
    expect(r.unit?.kind).toBe("list");
  });

  it("resolves inside a callout to 'callout' (rule 3)", () => {
    const doc = parseDocument(
      ["# H", "> [!note] Title", "> body line"].join("\n")
    );
    const r = resolveMoveUnit(doc, 2);
    expect(r.unit?.kind).toBe("callout");
  });

  it("resolves inside an ordinary blockquote to 'blockquote' (rule 3)", () => {
    const doc = parseDocument(["# H", "> quoted line 1", "> quoted line 2"].join("\n"));
    const r = resolveMoveUnit(doc, 1);
    expect(r.unit?.kind).toBe("blockquote");
  });

  it("resolves inside a fenced code block (including on the fence lines) to 'fenced-code' (rule 3) — bypassing resolveCurrentBlock's blanket code-block rejection", () => {
    const doc = parseDocument(["# H", "```ts", "const x = 1;", "```"].join("\n"));
    expect(resolveMoveUnit(doc, 1).unit?.kind).toBe("fenced-code"); // opening fence
    expect(resolveMoveUnit(doc, 2).unit?.kind).toBe("fenced-code"); // content
    expect(resolveMoveUnit(doc, 3).unit?.kind).toBe("fenced-code"); // closing fence
  });

  it("resolves inside a table to 'table' (rule 3)", () => {
    const doc = parseDocument(
      ["# H", "| a | b |", "|---|---|", "| 1 | 2 |"].join("\n")
    );
    const r = resolveMoveUnit(doc, 3);
    expect(r.unit?.kind).toBe("table");
  });

  it("rejects an unsupported nested callout (unmodeled inner structure) as boundary-unknown (rule 5)", () => {
    const doc = parseDocument(
      ["> [!note]", "> > [!tip]", "> > nested body", "> back to outer"].join("\n")
    );
    const r = resolveMoveUnit(doc, 0);
    expect(r.unit).toBeNull();
    expect(r.reason).toBe("boundary-unknown");
  });

  it("rejects frontmatter", () => {
    const doc = parseDocument(["---", "key: value", "---", "# H"].join("\n"));
    const r = resolveMoveUnit(doc, 1);
    expect(r.unit).toBeNull();
    expect(r.reason).toBe("frontmatter");
  });

  it("rejects an out-of-range line", () => {
    const doc = parseDocument("# H");
    const r = resolveMoveUnit(doc, 99);
    expect(r.unit).toBeNull();
    expect(r.reason).toBe("out-of-range");
  });
});

describe("resolveMoveUnit: list continuation never digs into a nested complex block", () => {
  it("a blockquote inside a list item's continuation still resolves to 'list' at the cursor (rule 2 takes priority)", () => {
    const doc = parseDocument(["- item", "  > quoted continuation"].join("\n"));
    const r = resolveMoveUnit(doc, 1);
    expect(r.unit?.kind).toBe("list");
  });
});

describe("findComplexSiblingTarget / moveComplexBlock: paragraph & complex-block moves", () => {
  it("swaps two adjacent paragraphs under the same section", () => {
    const doc = parseDocument(["# H", "paragraph A", "", "paragraph B"].join("\n"));
    const a = resolveMoveUnit(doc, 1).unit!;
    const target = findComplexSiblingTarget(doc, a, "down");
    expect(target.kind).toBe("swap");
    const outcome = moveComplexBlock(doc, a, "down");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "paragraph B", "", "paragraph A"]);
  });

  it("rejects with no-sibling when there is nothing in that direction", () => {
    const doc = parseDocument(["# H", "only paragraph"].join("\n"));
    const unit = resolveMoveUnit(doc, 1).unit!;
    const target = findComplexSiblingTarget(doc, unit, "up");
    expect(target).toEqual({ kind: "none", reason: "no-sibling" });
    const outcome = moveComplexBlock(doc, unit, "up");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("no-sibling");
  });

  it("rejects with boundary-unknown when a list item sits between two same-parent paragraphs (never hops across it)", () => {
    const doc = parseDocument(
      ["# H", "paragraph A", "- list item", "paragraph B"].join("\n")
    );
    const b = resolveMoveUnit(doc, 3).unit!;
    expect(b.kind).toBe("paragraph");
    const target = findComplexSiblingTarget(doc, b, "up");
    expect(target).toEqual({ kind: "none", reason: "boundary-unknown" });
  });

  it("swaps a paragraph with an adjacent supported complex block of a DIFFERENT kind", () => {
    const doc = parseDocument(
      ["# H", "> quoted line", "", "a trailing paragraph"].join("\n")
    );
    const paragraph = resolveMoveUnit(doc, 3).unit!;
    expect(paragraph.kind).toBe("paragraph");
    const outcome = moveComplexBlock(doc, paragraph, "up");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "a trailing paragraph",
      "",
      "> quoted line",
    ]);
  });

  it("never picks an unsupported/ambiguous block as a sibling partner", () => {
    const doc = parseDocument(
      [
        "# H",
        "> [!note]",
        "> > [!tip]",
        "> > nested body",
        "> back to outer",
        "",
        "trailing paragraph",
      ].join("\n")
    );
    const paragraph = resolveMoveUnit(doc, 6).unit!;
    expect(paragraph.kind).toBe("paragraph");
    const target = findComplexSiblingTarget(doc, paragraph, "up");
    expect(target).toEqual({ kind: "none", reason: "no-sibling" });
  });
});

describe("resolveEnclosingSectionId / findEnclosingSectionId: 'Move section' resolution", () => {
  it("resolves to the section itself when the cursor is on the heading line", () => {
    const doc = parseDocument(["# H", "body"].join("\n"));
    const r = resolveEnclosingSectionId(doc, 0);
    expect(r.sectionId).toBe(doc.nodes.get(doc.lineToOwningNodeId[0]!)?.id);
  });

  it("resolves to the enclosing section from a plain body paragraph", () => {
    const doc = parseDocument(["# H", "a paragraph"].join("\n"));
    const sectionId = doc.lineToOwningNodeId[0];
    const r = resolveEnclosingSectionId(doc, 1);
    expect(r.sectionId).toBe(sectionId);
  });

  it("resolves to the enclosing section from a deeply nested list item", () => {
    const doc = parseDocument(
      ["# H", "- a", "  - b", "    - c"].join("\n")
    );
    const sectionId = doc.lineToOwningNodeId[0];
    const r = resolveEnclosingSectionId(doc, 3);
    expect(r.sectionId).toBe(sectionId);
  });

  it("rejects with not-in-section for a root list item before any heading", () => {
    const doc = parseDocument(["- top level item, no heading yet"].join("\n"));
    const r = resolveEnclosingSectionId(doc, 0);
    expect(r.sectionId).toBeNull();
    expect(r.reason).toBe("not-in-section");
  });

  it("findEnclosingSectionId walks up through nested sections to the nearest one, not the outermost", () => {
    const doc = parseDocument(["# Outer", "## Inner", "body"].join("\n"));
    const innerId = doc.lineToOwningNodeId[2];
    const innerNode = doc.nodes.get(innerId!)!;
    expect(findEnclosingSectionId(doc, innerNode)).toBe(innerId);
  });
});

describe("describeMoveUnit: move-result toast labels (English — see resolveMoveTarget.ts's doc comment on this plugin's English-by-default language policy)", () => {
  it("labels a section with its heading text", () => {
    const doc = parseDocument(["# Case Overview", "body"].join("\n"));
    const unit = resolveMoveUnit(doc, 0).unit!;
    expect(describeMoveUnit(doc, unit)).toBe('section "Case Overview"');
  });

  it("labels an untitled heading with the fallback text", () => {
    const doc = parseDocument(["# ", "body"].join("\n"));
    const unit = resolveMoveUnit(doc, 0).unit!;
    expect(describeMoveUnit(doc, unit)).toBe('section "(untitled heading)"');
  });

  it("labels a leaf list item with no descendant count", () => {
    const doc = parseDocument(["- leaf item"].join("\n"));
    const unit = resolveMoveUnit(doc, 0).unit!;
    expect(describeMoveUnit(doc, unit)).toBe("list item");
  });

  it("labels a list item with its descendant count (plural)", () => {
    const doc = parseDocument(["- a", "  - b", "    - c", "  - d"].join("\n"));
    const unit = resolveMoveUnit(doc, 0).unit!;
    expect(describeMoveUnit(doc, unit)).toBe("list item (with 3 nested items)");
  });

  it("uses the singular 'item' for exactly one descendant", () => {
    const doc = parseDocument(["- a", "  - b"].join("\n"));
    const unit = resolveMoveUnit(doc, 0).unit!;
    expect(describeMoveUnit(doc, unit)).toBe("list item (with 1 nested item)");
  });

  it("labels a paragraph as 'paragraph'", () => {
    const doc = parseDocument(["# H", "a paragraph"].join("\n"));
    const unit = resolveMoveUnit(doc, 1).unit!;
    expect(describeMoveUnit(doc, unit)).toBe("paragraph");
  });

  it("labels a callout/blockquote/fenced-code/table with their English kind names", () => {
    const calloutDoc = parseDocument(["> [!note] t", "> body"].join("\n"));
    expect(describeMoveUnit(calloutDoc, resolveMoveUnit(calloutDoc, 0).unit!)).toBe(
      "callout"
    );

    const bqDoc = parseDocument(["> quoted"].join("\n"));
    expect(describeMoveUnit(bqDoc, resolveMoveUnit(bqDoc, 0).unit!)).toBe("blockquote");

    const codeDoc = parseDocument(["```ts", "x", "```"].join("\n"));
    expect(describeMoveUnit(codeDoc, resolveMoveUnit(codeDoc, 1).unit!)).toBe(
      "code block"
    );

    const tableDoc = parseDocument(["| a | b |", "|---|---|", "| 1 | 2 |"].join("\n"));
    expect(describeMoveUnit(tableDoc, resolveMoveUnit(tableDoc, 0).unit!)).toBe(
      "table"
    );
  });
});

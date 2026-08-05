/**
 * Phase 4D: Mixed Structure Safety Rules & Limited Support.
 *
 * These tests are deliberately CHARACTERIZATION tests, not tests of new
 * logic: investigation for this phase (see docs/mixed-structure-spec.md)
 * found that parser/parseDocument.ts's existing range-closing rules
 * already satisfy every boundary rule the phase's spec asks for, for all
 * four named patterns — no code changes to parser/, move/relocateSection.ts,
 * move/relocateListSubtree.ts, or edit/partialEdit.ts were needed. This
 * file exists to make that verified, rather than assumed: every pattern
 * from the spec gets an explicit assertion here, so any future change that
 * accidentally breaks one of these boundary rules fails a test instead of
 * silently regressing.
 *
 * Rules confirmed by the tests below (see docs/mixed-structure-spec.md for
 * the full write-up with rationale):
 *   - A section's range already extends from its own heading line up to
 *     (but not including) the next same-or-shallower heading, REGARDLESS
 *     of what's in between — paragraphs and lists alike. This is simply
 *     how closeSectionsDownTo already worked from Phase 1 onward; sections
 *     never model paragraphs as a distinct concept, so "does the section
 *     include its paragraph" was never actually a separate question from
 *     "does the section include everything until the next heading".
 *   - A list item's range never reaches backward to include a paragraph
 *     that came before its own marker line (nothing is open when that
 *     paragraph line is scanned, so it's simply unowned by any list node).
 *   - A list item's range stops at (does not include) a paragraph that
 *     follows it at or below the item's own indent column — this is the
 *     exact same "closeItemsWithIndentAtLeast" threshold every other
 *     block-scoped command already relies on. A paragraph indented DEEPER
 *     than the item's own column is (correctly, per every other phase's
 *     established continuation-line convention — see edit/listBodyRange.ts)
 *     treated as that item's own continuation content, not a separate
 *     paragraph — this is intentional, not a mixed-structure edge case.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode, isSectionNode, ParsedDocument } from "../src/model/block";
import { canDropOn, relocateSection } from "../src/move/relocateSection";
import { canDropListOn, relocateListSubtree } from "../src/move/relocateListSubtree";
import { applySubtreeEdit, extractSubtreeText } from "../src/edit/partialEdit";

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

describe("Pattern A: heading -> paragraph -> list", () => {
  const text = ["# H", "Some paragraph.", "- item1", "- item2"].join("\n");

  it("the section's own range includes the paragraph AND the list", () => {
    const doc = parseDocument(text);
    const h = doc.nodes.get(sectionIdOf(doc, "H"));
    expect(h?.range).toEqual({ startLine: 0, endLine: 3 });
  });

  it("list items' ranges exclude the heading and the paragraph before them", () => {
    const doc = parseDocument(text);
    const item1 = doc.nodes.get(listIdOf(doc, "item1"));
    expect(item1?.range).toEqual({ startLine: 2, endLine: 2 });
  });
});

describe("Pattern B: heading -> list -> paragraph", () => {
  const text = ["# H", "- item1", "- item2", "", "Trailing paragraph."].join("\n");

  it("the section's own range includes the trailing paragraph", () => {
    const doc = parseDocument(text);
    const h = doc.nodes.get(sectionIdOf(doc, "H"));
    expect(h?.range).toEqual({ startLine: 0, endLine: 4 });
  });

  it("the last list item's range stops before the trailing paragraph (does not absorb it)", () => {
    const doc = parseDocument(text);
    const item2 = doc.nodes.get(listIdOf(doc, "item2"));
    expect(item2?.range).toEqual({ startLine: 2, endLine: 2 });
  });
});

describe("Pattern C: paragraph -> list (no heading)", () => {
  const text = ["Leading paragraph.", "- item1", "- item2"].join("\n");

  it("no section node is produced (there is no heading)", () => {
    const doc = parseDocument(text);
    for (const n of doc.nodes.values()) expect(isSectionNode(n)).toBe(false);
  });

  it("the first list item's range excludes the leading paragraph", () => {
    const doc = parseDocument(text);
    const item1 = doc.nodes.get(listIdOf(doc, "item1"));
    expect(item1?.range).toEqual({ startLine: 1, endLine: 1 });
  });
});

describe("Pattern D: heading -> paragraph only (no list)", () => {
  const text = ["# H", "Just a paragraph.", "More paragraph."].join("\n");

  it("the section's own range includes every paragraph line, and no list nodes are produced", () => {
    const doc = parseDocument(text);
    const h = doc.nodes.get(sectionIdOf(doc, "H"));
    expect(h?.range).toEqual({ startLine: 0, endLine: 2 });
    for (const n of doc.nodes.values()) expect(isListNode(n)).toBe(false);
  });
});

describe("relocateSection carries a section's mixed-structure content as one unit", () => {
  it("moving a heading+paragraph+list section past a sibling carries the paragraph and list along, untouched", () => {
    const text = [
      "# A",
      "Paragraph under A.",
      "- a-item",
      "# B",
      "body b",
    ].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateSection(doc, sectionIdOf(doc, "A"), sectionIdOf(doc, "B"), "after");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# B",
      "body b",
      "# A",
      "Paragraph under A.",
      "- a-item",
    ]);
  });
});

describe("relocateListSubtree excludes surrounding paragraphs when moving", () => {
  it("moving a list item (Pattern A/B shape) never drags along the paragraph before or after it", () => {
    const text = [
      "# H",
      "Leading paragraph.",
      "- one",
      "- two",
      "",
      "Trailing paragraph.",
    ].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateListSubtree(doc, listIdOf(doc, "two"), listIdOf(doc, "one"), "before");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "Leading paragraph.",
      "- two",
      "- one",
      "",
      "Trailing paragraph.",
    ]);
  });

  it("dropping a list item onto a section still lands it as that section's own root content, leaving the section's paragraph text untouched", () => {
    const text = ["# A", "Paragraph under A.", "- a-item", "# B", "- b-item"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateListSubtree(doc, listIdOf(doc, "b-item"), sectionIdOf(doc, "A"), "inside");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# A",
      "Paragraph under A.",
      "- a-item",
      "- b-item",
      "# B",
    ]);
  });
});

describe("Partial Edit Pane on mixed structure", () => {
  it("extracting a section (Pattern A shape) includes its paragraph and list", () => {
    const text = ["# H", "Some paragraph.", "- item1", "- item2"].join("\n");
    const doc = parseDocument(text);

    const outcome = extractSubtreeText(doc, sectionIdOf(doc, "H"));
    expect(outcome.ok).toBe(true);
    expect(outcome.kind).toBe("section");
    expect(outcome.text).toBe(text);
  });

  it("extracting a list item (Pattern C shape) excludes the leading paragraph", () => {
    const text = ["Leading paragraph.", "- item1", "- item2"].join("\n");
    const doc = parseDocument(text);

    const outcome = extractSubtreeText(doc, listIdOf(doc, "item1"));
    expect(outcome.ok).toBe(true);
    expect(outcome.kind).toBe("list");
    expect(outcome.text).toBe("- item1");
  });

  it("applying an edit to a list item (Pattern B shape) never touches the trailing paragraph", () => {
    const text = ["# H", "- item1", "- item2", "", "Trailing paragraph."].join("\n");
    const doc = parseDocument(text);
    const item2Id = listIdOf(doc, "item2");
    const original = extractSubtreeText(doc, item2Id);

    const outcome = applySubtreeEdit(doc, item2Id, original.text, "- item2 edited");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# H",
      "- item1",
      "- item2 edited",
      "",
      "Trailing paragraph.",
    ]);
  });

  it("applying an edit to a section (Pattern D shape) can rewrite its paragraph text", () => {
    const text = ["# H", "Just a paragraph."].join("\n");
    const doc = parseDocument(text);
    const hId = sectionIdOf(doc, "H");
    const original = extractSubtreeText(doc, hId);

    const outcome = applySubtreeEdit(doc, hId, original.text, ["# H", "Rewritten paragraph."].join("\n"));
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "Rewritten paragraph."]);
  });
});

describe("unsafe mixed structure is still rejected, same as before Phase 4D", () => {
  it("relocateListSubtree refuses a list item with unsafe (mixed tab/space) indentation, even inside a heading+paragraph+list section", () => {
    const text = ["# H", "Paragraph.", "- one", "\t - bad", "- two"].join("\n");
    const doc = parseDocument(text);
    const badId = listIdOf(doc, "bad");

    const outcome = relocateListSubtree(doc, badId, listIdOf(doc, "two"), "after");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("unsafe-indent");
    expect(canDropListOn(doc, badId, listIdOf(doc, "two"))).toBe(false);
  });

  it("the Partial Edit Pane refuses to load a list item with unsafe indentation, even inside mixed structure", () => {
    const text = ["# H", "Paragraph.", "- one", "\t - bad"].join("\n");
    const doc = parseDocument(text);
    const badId = listIdOf(doc, "bad");

    const outcome = extractSubtreeText(doc, badId);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("unsafe-indent");
  });

  it("an unsafe list item elsewhere in a section does not block that section's own relocate/edit (isolation is preserved)", () => {
    const text = ["# A", "Paragraph.", "- fine", "\t - bad", "# B"].join("\n");
    const doc = parseDocument(text);

    const outcome = relocateSection(doc, sectionIdOf(doc, "A"), sectionIdOf(doc, "B"), "after");
    expect(outcome.changed).toBe(true);
    expect(canDropOn(doc, sectionIdOf(doc, "A"), sectionIdOf(doc, "B"))).toBe(true);
  });
});

describe("known limitation (documented, not fixed — see docs/mixed-structure-spec.md §5)", () => {
  it("an unindented paragraph interleaved directly between two list items breaks their sibling link", () => {
    // Not one of the four named patterns (which only ever place a
    // paragraph BEFORE or AFTER a whole list, never splitting one list
    // into two groups) — captured here so this pre-existing parser
    // characteristic is an explicit, intentional non-goal rather than an
    // silently-observed accident. "one" and "two" end up as two separate,
    // unlinked list groups instead of siblings; move-up/move-down between
    // them would no-op rather than swap. Out of scope per the phase spec's
    // "任意の複雑な混在構造の完全対応" exclusion — the safe behavior here
    // is "doesn't move" rather than a guess at merging them back together.
    const text = ["# H", "- one", "Interleaved paragraph.", "- two"].join("\n");
    const doc = parseDocument(text);

    const one = doc.nodes.get(listIdOf(doc, "one"));
    const two = doc.nodes.get(listIdOf(doc, "two"));
    expect(one?.nextSiblingId).toBe(null);
    expect(two?.prevSiblingId).toBe(null);
  });
});

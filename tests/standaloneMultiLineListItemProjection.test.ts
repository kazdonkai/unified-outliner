/**
 * Phase 5L-4 ("Multi-Line Leaf List Item Partial Edit Projection"): pure
 * unit tests for edit/standaloneMultiLineListItemProjection.ts's own two
 * gates — isStandaloneMultiLineLeafListItemEligibleForProjection and
 * hasComplexBlockInMultiLineListItemContinuation — mirroring
 * tests/standaloneOrderedListProjection.test.ts's own structure.
 *
 * Every fixture goes through the REAL parser (parser/parseDocument.ts) —
 * never a hand-built ListBlockNode literal — matching this project's own
 * "prefer a real fixture over a hand-typed snapshot" convention.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode } from "../src/model/block";
import {
  hasComplexBlockInMultiLineListItemContinuation,
  isStandaloneMultiLineLeafListItemEligibleForProjection,
} from "../src/edit/standaloneMultiLineListItemProjection";
import { isStandaloneListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneListMarkerProjection";
import { isStandaloneOrderedListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneOrderedListProjection";

function listNode(text: string, nodeId: string) {
  const doc = parseDocument(text);
  const node = doc.nodes.get(nodeId);
  if (!node || !isListNode(node)) {
    throw new Error(`fixture error: ${nodeId} did not resolve to a list node`);
  }
  return node;
}

describe("isStandaloneMultiLineLeafListItemEligibleForProjection — eligible shapes", () => {
  it("an unordered leaf item with one continuation line is eligible", () => {
    const node = listNode(["- 一行目", "  二行目"].join("\n"), "li-0");
    expect(isStandaloneMultiLineLeafListItemEligibleForProjection(node)).toBe(true);
  });

  it("a task leaf item with several continuation lines is eligible", () => {
    const node = listNode(["- [ ] 一行目", "  二行目", "  三行目"].join("\n"), "li-0");
    expect(isStandaloneMultiLineLeafListItemEligibleForProjection(node)).toBe(true);
  });

  it("an ordered leaf item with a blank line inside its continuation is eligible", () => {
    const node = listNode(["1. 一行目", "   二行目", "", "   四行目"].join("\n"), "li-0");
    expect(isStandaloneMultiLineLeafListItemEligibleForProjection(node)).toBe(true);
  });

  it("a multi-line leaf item directly under a heading section is eligible", () => {
    const node = listNode(["# 見出し", "- 一行目", "  二行目"].join("\n"), "li-0");
    expect(isStandaloneMultiLineLeafListItemEligibleForProjection(node)).toBe(true);
  });

  it("the LEAF of a nested list (multi-line, no children of its own) is eligible even though its own parent is not", () => {
    const doc = parseDocument(["- 親項目", "  - 子項目の一行目", "    子項目の続き"].join("\n"));
    const parent = doc.nodes.get("li-0");
    const leaf = doc.nodes.get("li-1");
    if (!parent || !isListNode(parent) || !leaf || !isListNode(leaf)) {
      throw new Error("fixture error");
    }
    expect(isStandaloneMultiLineLeafListItemEligibleForProjection(leaf)).toBe(true);
    expect(isStandaloneMultiLineLeafListItemEligibleForProjection(parent)).toBe(false);
  });
});

describe("isStandaloneMultiLineLeafListItemEligibleForProjection — ineligible shapes", () => {
  it("a single-line item (no continuation) is NOT eligible — this is single-line projections' own domain (Phase 5L-1/5L-2/5L-3)", () => {
    const node = listNode("- 一行だけ", "li-0");
    expect(isStandaloneMultiLineLeafListItemEligibleForProjection(node)).toBe(false);
    // The structural complement: every single-line gate accepts what this
    // one refuses, for the SAME node.
    expect(isStandaloneListItemEligibleForMarkerFreeProjection(node)).toBe(true);
  });

  it("a single-line ordered item (no continuation) is NOT eligible either", () => {
    const node = listNode("1. 一行だけ", "li-0");
    expect(isStandaloneMultiLineLeafListItemEligibleForProjection(node)).toBe(false);
    expect(isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node)).toBe(true);
  });

  it("a parent item that owns a nested CHILD LIST item is NOT eligible, even though its own range spans multiple lines", () => {
    const node = listNode(["- 親項目", "  - 子項目"].join("\n"), "li-0");
    expect(isStandaloneMultiLineLeafListItemEligibleForProjection(node)).toBe(false);
  });

  it("Phase 5L-5: a parent item whose child list is separated from the first line by a BLANK line is still correctly recognized as owning a nested CHILD LIST (childIds populated) — NOT eligible", () => {
    const node = listNode(["- 一行目", "  本文", "", "  - 子項目っぽい行"].join("\n"), "li-0");
    expect(node.childIds.length).toBeGreaterThan(0);
    expect(isStandaloneMultiLineLeafListItemEligibleForProjection(node)).toBe(false);
  });

  it("an item with mixed tab/space (unsafeIndent) leading whitespace is NOT eligible", () => {
    // unsafeIndent reflects the MARKER's own leading whitespace (mixed
    // tabs and spaces) — built here as a nested item under a plain
    // top-level parent, matching how the sibling single-line eligibility
    // tests construct their own unsafeIndent fixture.
    const nested = listNode(["- 親", "\t - 一行目", "\t   続き"].join("\n"), "li-1");
    expect(nested.unsafeIndent).toBe(true);
    expect(isStandaloneMultiLineLeafListItemEligibleForProjection(nested)).toBe(false);
  });
});

describe("hasComplexBlockInMultiLineListItemContinuation", () => {
  it("false for a multi-line item whose continuation is plain prose", () => {
    const doc = parseDocument(["- 一行目", "  二行目"].join("\n"));
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(hasComplexBlockInMultiLineListItemContinuation(doc, node)).toBe(false);
  });

  it("false for a single-line item (no continuation lines to check at all)", () => {
    const doc = parseDocument("- 一行だけ");
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(hasComplexBlockInMultiLineListItemContinuation(doc, node)).toBe(false);
  });

  it("true when a continuation line is a blockquote", () => {
    const doc = parseDocument(["- 一行目", "  > 引用"].join("\n"));
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(hasComplexBlockInMultiLineListItemContinuation(doc, node)).toBe(true);
  });

  it("true when a continuation line is a callout", () => {
    const doc = parseDocument(["- 一行目", "  > [!note] タイトル", "  > 本文"].join("\n"));
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(hasComplexBlockInMultiLineListItemContinuation(doc, node)).toBe(true);
  });

  it("true when a continuation contains a fenced code block", () => {
    const doc = parseDocument(["- 一行目", "  ```", "  code", "  ```"].join("\n"));
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(hasComplexBlockInMultiLineListItemContinuation(doc, node)).toBe(true);
  });

  it("true when a continuation contains a table", () => {
    const doc = parseDocument(["- 一行目", "  | a | b |", "  | - | - |", "  | 1 | 2 |"].join("\n"));
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(hasComplexBlockInMultiLineListItemContinuation(doc, node)).toBe(true);
  });

  it("true when a continuation contains a thematic break", () => {
    // "***" (not "---") avoids the dash-only Setext-heading-underline
    // ambiguity scanThematicBreakBlocks itself deliberately declines to
    // report right after a plain text line (see model/complexBlock.ts's
    // own doc comment) — this fixture is about a genuinely unambiguous
    // thematic break.
    const doc = parseDocument(["- 一行目", "  補足", "  ***"].join("\n"));
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(hasComplexBlockInMultiLineListItemContinuation(doc, node)).toBe(true);
  });

  it("Phase 5L-5: true when a BLANK line is immediately followed by a blockquote — the blank is absorbed into the item's own range, not trimmed, since more content follows", () => {
    const doc = parseDocument(["- 一行目", "", "  > 引用"].join("\n"));
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(hasComplexBlockInMultiLineListItemContinuation(doc, node)).toBe(true);
  });

  it("Phase 5L-5: true when a BLANK line is immediately followed by a callout", () => {
    const doc = parseDocument(["- 一行目", "", "  > [!note] タイトル", "  > 本文"].join("\n"));
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(hasComplexBlockInMultiLineListItemContinuation(doc, node)).toBe(true);
  });

  it("Phase 5L-5: true when a BLANK line is immediately followed by a fenced code block", () => {
    const doc = parseDocument(["- 一行目", "", "  ```", "  code", "  ```"].join("\n"));
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(hasComplexBlockInMultiLineListItemContinuation(doc, node)).toBe(true);
  });

  it("Phase 5L-5: true when a BLANK line is immediately followed by a table", () => {
    const doc = parseDocument(["- 一行目", "", "  | a | b |", "  | - | - |", "  | 1 | 2 |"].join("\n"));
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(hasComplexBlockInMultiLineListItemContinuation(doc, node)).toBe(true);
  });

  it("Phase 5L-5: a TRAILING blank line at the very end of the item's continuation (nothing follows) reports false — there is no ComplexBlock to find, since the parser trims the trailing blank out of the item's own range before it ever reaches this scan", () => {
    const doc = parseDocument(["- 一行目", "  二行目", ""].join("\n"));
    const node = doc.nodes.get("li-0");
    if (!node || !isListNode(node)) throw new Error("fixture error");
    expect(hasComplexBlockInMultiLineListItemContinuation(doc, node)).toBe(false);
  });
});

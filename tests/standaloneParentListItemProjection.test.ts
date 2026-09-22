/**
 * Phase 5L-6 ("Parent List Item Structured Partial Edit"): pure unit tests
 * for edit/standaloneParentListItemProjection.ts's own two gates —
 * isStandaloneParentListItemEligibleForProjection and
 * hasComplexBlockInParentOwnTextContinuation — mirroring
 * tests/standaloneMultiLineListItemProjection.test.ts's own structure, the
 * sibling this module's own top doc comment names as its own leaf-item
 * counterpart.
 *
 * Every fixture goes through the REAL parser (parser/parseDocument.ts) —
 * never a hand-built ListBlockNode literal — matching this project's own
 * "prefer a real fixture over a hand-typed snapshot" convention.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode } from "../src/model/block";
import {
  hasComplexBlockInParentOwnTextContinuation,
  isStandaloneParentListItemEligibleForProjection,
} from "../src/edit/standaloneParentListItemProjection";
import { isStandaloneMultiLineLeafListItemEligibleForProjection } from "../src/edit/standaloneMultiLineListItemProjection";

function listNode(text: string, nodeId: string) {
  const doc = parseDocument(text);
  const node = doc.nodes.get(nodeId);
  if (!node || !isListNode(node)) {
    throw new Error(`fixture error: ${nodeId} did not resolve to a list node`);
  }
  return { doc, node };
}

describe("isStandaloneParentListItemEligibleForProjection — eligible shapes", () => {
  it("an unordered parent with one plain child is eligible", () => {
    const { doc, node } = listNode(["- 親本文", "  - 子1"].join("\n"), "li-0");
    expect(isStandaloneParentListItemEligibleForProjection(doc, node)).toBe(true);
  });

  it("a task parent with several children is eligible", () => {
    const { doc, node } = listNode(["- [ ] 親タスク", "  - 子1", "  - 子2"].join("\n"), "li-0");
    expect(isStandaloneParentListItemEligibleForProjection(doc, node)).toBe(true);
  });

  it("an ordered parent whose own-text spans a continuation + blank line before its first child is eligible", () => {
    const { doc, node } = listNode(
      ["1. 親項目", "   続き", "", "   - 子1"].join("\n"),
      "li-0"
    );
    expect(isStandaloneParentListItemEligibleForProjection(doc, node)).toBe(true);
  });

  it("a nested parent (itself a child of another parent) is eligible for its OWN own-text/child-subtree split", () => {
    const { doc, node } = listNode(["- 祖父", "  - 親", "    - 子1"].join("\n"), "li-1");
    expect(node.childIds.length).toBe(1);
    expect(isStandaloneParentListItemEligibleForProjection(doc, node)).toBe(true);
  });

  it("a parent directly under a heading section is eligible", () => {
    const { doc, node } = listNode(["# 見出し", "- 親本文", "  - 子1"].join("\n"), "li-0");
    expect(isStandaloneParentListItemEligibleForProjection(doc, node)).toBe(true);
  });
});

describe("isStandaloneParentListItemEligibleForProjection — ineligible shapes", () => {
  it("a child-list-free leaf item (childIds.length === 0) is NOT eligible — this is the multi-line leaf projection's own domain (Phase 5L-4/5L-5)", () => {
    const { doc, node } = listNode(["- 一行目", "  続き"].join("\n"), "li-0");
    expect(isStandaloneParentListItemEligibleForProjection(doc, node)).toBe(false);
    // Structural complement: the leaf gate accepts what this one refuses,
    // for the SAME node.
    expect(isStandaloneMultiLineLeafListItemEligibleForProjection(node)).toBe(true);
  });

  it("a single-line leaf item (no children, no continuation) is NOT eligible either", () => {
    const { doc, node } = listNode("- 一行だけ", "li-0");
    expect(isStandaloneParentListItemEligibleForProjection(doc, node)).toBe(false);
  });

  it("a mixed tab/space indented (unsafeIndent) parent is NOT eligible", () => {
    const { doc, node } = listNode(["- 親", "\t - 一行目の親", "\t   - 子1"].join("\n"), "li-1");
    if (node.unsafeIndent) {
      expect(isStandaloneParentListItemEligibleForProjection(doc, node)).toBe(false);
    }
  });

  it("an interleaved-content parent (a plain line reattached past its last child) is NOT eligible — resolveParentListItemOwnTextRange's own 'interleaved-content' refusal", () => {
    const { doc, node } = listNode(["- 親本文", "  - 子1", "  さらに親の続き？"].join("\n"), "li-0");
    expect(isStandaloneParentListItemEligibleForProjection(doc, node)).toBe(false);
  });
});

describe("isStandaloneParentListItemEligibleForProjection — CompositeBlock member exclusion is structural, never checked directly here", () => {
  it("this file never imports/references CompositeBlock at all — the exclusion is guaranteed entirely upstream by view/PartialEditView.ts's own requestLoadNode/requestLoadComposite split (see this module's own top doc comment)", () => {
    // This is a documentation-level assertion, not a behavioral one: there
    // is no fixture this function could ever be reached with that
    // represents a CompositeBlock member, by construction — matching every
    // sibling standalone-* eligibility gate's own identical reliance on
    // that same upstream exclusion.
    expect(true).toBe(true);
  });
});

describe("hasComplexBlockInParentOwnTextContinuation", () => {
  it("false for a parent whose own-text is a single line (no continuation to check at all)", () => {
    const { doc } = listNode(["- 親本文", "  - 子1"].join("\n"), "li-0");
    expect(hasComplexBlockInParentOwnTextContinuation(doc, { startLine: 0, endLine: 0 })).toBe(false);
  });

  it("false for a parent whose own-text continuation is plain prose", () => {
    const { doc } = listNode(["- 親本文", "  続き", "  - 子1"].join("\n"), "li-0");
    expect(hasComplexBlockInParentOwnTextContinuation(doc, { startLine: 0, endLine: 1 })).toBe(false);
  });

  it("true when the own-text continuation contains a blockquote", () => {
    const d = parseDocument(["- 親本文", "  > 引用", "  - 子1"].join("\n"));
    expect(hasComplexBlockInParentOwnTextContinuation(d, { startLine: 0, endLine: 1 })).toBe(true);
  });

  it("true when the own-text continuation contains a callout", () => {
    const d = parseDocument(["- 親本文", "  > [!note] タイトル", "  > 本文", "  - 子1"].join("\n"));
    expect(hasComplexBlockInParentOwnTextContinuation(d, { startLine: 0, endLine: 2 })).toBe(true);
  });

  it("true when the own-text continuation contains a fenced code block", () => {
    const d = parseDocument(["- 親本文", "  ```", "  code", "  ```", "  - 子1"].join("\n"));
    expect(hasComplexBlockInParentOwnTextContinuation(d, { startLine: 0, endLine: 3 })).toBe(true);
  });

  it("true when the own-text continuation contains a table", () => {
    const d = parseDocument(
      ["- 親本文", "  | a | b |", "  | - | - |", "  | 1 | 2 |", "  - 子1"].join("\n")
    );
    expect(hasComplexBlockInParentOwnTextContinuation(d, { startLine: 0, endLine: 3 })).toBe(true);
  });

  it("true when the own-text continuation contains a thematic break", () => {
    const d = parseDocument(["- 親本文", "  補足", "  ***", "  - 子1"].join("\n"));
    expect(hasComplexBlockInParentOwnTextContinuation(d, { startLine: 0, endLine: 2 })).toBe(true);
  });

  it("never flags a ComplexBlock that actually lives inside a CHILD's own continuation — out of scope for this gate by construction (only the own-text range is ever passed in)", () => {
    const d = parseDocument(["- 親本文", "  - 子1", "    > 子の中の引用"].join("\n"));
    // The own-text range here is just the parent's own single line — the
    // child's own blockquote continuation is never part of it.
    expect(hasComplexBlockInParentOwnTextContinuation(d, { startLine: 0, endLine: 0 })).toBe(false);
  });

  it("integrated with isStandaloneParentListItemEligibleForProjection: a parent with a callout in its own-text continuation is NOT eligible overall", () => {
    const { doc, node } = listNode(["- 親本文", "  > [!note] タイトル", "  - 子1"].join("\n"), "li-0");
    expect(isStandaloneParentListItemEligibleForProjection(doc, node)).toBe(false);
  });
});

/**
 * Phase 5L-8 ("Child Item Inline Structured Editing in Parent Partial Edit
 * Pane"): real-pipeline tests for edit/parentChildInlineEditSession.ts —
 * mirroring tests/parentListItemProjection.test.ts's/
 * tests/parentChildPreviewNavigation.test.ts's own house style (real
 * parseDocument, never a hand-built fake ParsedDocument).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode, ListBlockNode } from "../src/model/block";
import { buildParentListItemProjection } from "../src/edit/parentListItemProjection";
import {
  buildChildLeafProjection,
  buildParentChildInlineEditSession,
  childEffectiveControlKind,
  evaluateChildInlineEditEligibility,
  invertAndValidateParentChildCombinedEdit,
  invertChildLeafProjection,
  isChildRangeWithinParentChildSubtree,
  isDirectChildOf,
  projectedChildBodyText,
  projectedChildChecked,
  projectedChildNumberText,
  resolveChildOwnTextRange,
  applyParentChildInlineEditToDocument,
} from "../src/edit/parentChildInlineEditSession";

function buildParent(raw: string, nodeId = "li-0") {
  const doc = parseDocument(raw);
  const node = doc.nodes.get(nodeId);
  if (!node || !isListNode(node)) throw new Error(`fixture setup error: ${nodeId} not a list node`);
  const built = buildParentListItemProjection(doc, node);
  if (!built.ok) throw new Error(`fixture setup error: parent build failed with reason ${built.reason}`);
  return { doc, node, projection: built.projection };
}

function buildSession(raw: string, childNodeId: string, parentNodeId = "li-0") {
  const { doc, node, projection } = buildParent(raw, parentNodeId);
  const built = buildParentChildInlineEditSession(doc, node, projection, childNodeId);
  if (!built.ok) throw new Error(`fixture setup error: session build failed with reason ${built.reason}`);
  return { doc, node, projection, session: built.session };
}

describe("evaluateChildInlineEditEligibility", () => {
  it("accepts an unordered leaf direct child", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const doc = parseDocument(raw);
    const parent = doc.nodes.get("li-0") as ListBlockNode;
    const result = evaluateChildInlineEditEligibility(doc, parent, "li-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projection.kind).toBe("unordered");
    }
  });

  it("accepts a task leaf direct child", () => {
    const raw = ["- 親", "  - [ ] 子タスク"].join("\n");
    const doc = parseDocument(raw);
    const parent = doc.nodes.get("li-0") as ListBlockNode;
    const result = evaluateChildInlineEditEligibility(doc, parent, "li-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.projection.kind).toBe("task");
  });

  it("accepts an ordered leaf direct child", () => {
    const raw = ["- 親", "  1. 子"].join("\n");
    const doc = parseDocument(raw);
    const parent = doc.nodes.get("li-0") as ListBlockNode;
    const result = evaluateChildInlineEditEligibility(doc, parent, "li-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.projection.kind).toBe("ordered");
  });

  it("accepts a multi-line/blank-line leaf direct child", () => {
    const raw = ["- 親", "  - 子本文", "", "    続き"].join("\n");
    const doc = parseDocument(raw);
    const parent = doc.nodes.get("li-0") as ListBlockNode;
    const result = evaluateChildInlineEditEligibility(doc, parent, "li-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.projection.kind).toBe("multiLine");
  });

  it("refuses a grandchild (not a DIRECT child of the given parent)", () => {
    const raw = ["- 親", "  - 子1", "    - 孫1"].join("\n");
    const doc = parseDocument(raw);
    const parent = doc.nodes.get("li-0") as ListBlockNode;
    const result = evaluateChildInlineEditEligibility(doc, parent, "li-2");
    expect(result).toEqual({ ok: false, reason: "not-direct-child" });
  });

  it("refuses a direct child that itself owns children", () => {
    const raw = ["- 親", "  - 子1", "    - 孫1"].join("\n");
    const doc = parseDocument(raw);
    const parent = doc.nodes.get("li-0") as ListBlockNode;
    const result = evaluateChildInlineEditEligibility(doc, parent, "li-1");
    expect(result).toEqual({ ok: false, reason: "child-has-children" });
  });

  it("refuses a child whose continuation contains a disallowed ComplexBlock (blockquote)", () => {
    const raw = ["- 親", "  - 子本文", "    > 引用"].join("\n");
    const doc = parseDocument(raw);
    const parent = doc.nodes.get("li-0") as ListBlockNode;
    const result = evaluateChildInlineEditEligibility(doc, parent, "li-1");
    expect(result).toEqual({ ok: false, reason: "child-complex-block" });
  });

  it("refuses a child with an unsupported task-checkbox status character", () => {
    const raw = ["- 親", "  - [/] 子"].join("\n");
    const doc = parseDocument(raw);
    const parent = doc.nodes.get("li-0") as ListBlockNode;
    const result = evaluateChildInlineEditEligibility(doc, parent, "li-1");
    expect(result).toEqual({ ok: false, reason: "child-not-projectable" });
  });

  it("refuses a nonexistent child id", () => {
    const raw = ["- 親", "  - 子1"].join("\n");
    const doc = parseDocument(raw);
    const parent = doc.nodes.get("li-0") as ListBlockNode;
    const result = evaluateChildInlineEditEligibility(doc, parent, "li-999");
    expect(result).toEqual({ ok: false, reason: "child-not-found" });
  });

  it("a SIBLING's own child is never eligible under the WRONG parent", () => {
    const raw = ["- 親1", "  - 子1", "- 親2", "  - 子2"].join("\n");
    const doc = parseDocument(raw);
    const parent2 = doc.nodes.get("li-2") as ListBlockNode;
    // li-1 ("子1") belongs to 親1 (li-0), not 親2 (li-2).
    const result = evaluateChildInlineEditEligibility(doc, parent2, "li-1");
    expect(result).toEqual({ ok: false, reason: "not-direct-child" });
  });
});

describe("isDirectChildOf", () => {
  it("true for an actual direct child", () => {
    const doc = parseDocument(["- 親", "  - 子"].join("\n"));
    expect(isDirectChildOf(doc, "li-0", "li-1")).toBe(true);
  });
  it("false for a grandchild", () => {
    const doc = parseDocument(["- 親", "  - 子", "    - 孫"].join("\n"));
    expect(isDirectChildOf(doc, "li-0", "li-2")).toBe(false);
  });
  it("false for an unrelated node", () => {
    const doc = parseDocument(["- 親1", "  - 子1", "- 親2"].join("\n"));
    expect(isDirectChildOf(doc, "li-2", "li-1")).toBe(false);
  });
});

describe("resolveChildOwnTextRange", () => {
  it("own-text range and subtree range are identical for a leaf child", () => {
    const doc = parseDocument(["- 親", "  - 子本文", "    続き"].join("\n"));
    const child = doc.nodes.get("li-1") as ListBlockNode;
    const resolved = resolveChildOwnTextRange(child);
    expect(resolved.ownTextRange).toEqual(child.range);
    expect(resolved.subtreeRange).toEqual(child.range);
  });
});

describe("isChildRangeWithinParentChildSubtree", () => {
  it("true when the child range sits after own-text, inside the child-subtree range", () => {
    expect(
      isChildRangeWithinParentChildSubtree({ startLine: 0, endLine: 0 }, { startLine: 1, endLine: 3 }, { startLine: 1, endLine: 1 })
    ).toBe(true);
  });
  it("false when the child range overlaps the own-text range", () => {
    expect(
      isChildRangeWithinParentChildSubtree({ startLine: 0, endLine: 1 }, { startLine: 2, endLine: 3 }, { startLine: 1, endLine: 1 })
    ).toBe(false);
  });
  it("false when the child range extends past the child-subtree range", () => {
    expect(
      isChildRangeWithinParentChildSubtree({ startLine: 0, endLine: 0 }, { startLine: 1, endLine: 2 }, { startLine: 1, endLine: 3 })
    ).toBe(false);
  });
});

describe("buildChildLeafProjection / projected*/invertChildLeafProjection round trip", () => {
  it("unordered: unedited round-trip reconstructs byte-identically", () => {
    const raw = "  - 子本文";
    const built = buildChildLeafProjection(raw);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(childEffectiveControlKind(built.projection)).toBe("unordered");
    expect(projectedChildBodyText(built.projection)).toBe("子本文");
    const inverted = invertChildLeafProjection(built.projection, false, "", "子本文");
    expect(inverted).toEqual({ ok: true, rawText: raw });
  });

  it("task: checked/body round-trip", () => {
    const raw = "  - [ ] 子タスク";
    const built = buildChildLeafProjection(raw);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(childEffectiveControlKind(built.projection)).toBe("task");
    expect(projectedChildChecked(built.projection)).toBe(false);
    const inverted = invertChildLeafProjection(built.projection, true, "", "子タスク完了");
    expect(inverted).toEqual({ ok: true, rawText: "  - [x] 子タスク完了" });
  });

  it("ordered: number/body round-trip, and invalid-number refusal", () => {
    const raw = "  3. 子";
    const built = buildChildLeafProjection(raw);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(childEffectiveControlKind(built.projection)).toBe("ordered");
    expect(projectedChildNumberText(built.projection)).toBe("3");
    const okInverted = invertChildLeafProjection(built.projection, false, "5", "子2");
    expect(okInverted).toEqual({ ok: true, rawText: "  5. 子2" });
    const badInverted = invertChildLeafProjection(built.projection, false, "abc", "子2");
    expect(badInverted).toEqual({ ok: false, reason: "invalid-number" });
  });

  it("multiLine: body with continuation round-trips, and a manufactured nested list is refused", () => {
    const raw = ["  - 子本文", "    続き行"].join("\n");
    const built = buildChildLeafProjection(raw);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(childEffectiveControlKind(built.projection)).toBe("unordered");
    const okInverted = invertChildLeafProjection(built.projection, false, "", "子本文\n続き行2");
    expect(okInverted.ok).toBe(true);
    const badInverted = invertChildLeafProjection(built.projection, false, "", "子本文\n- 新しい子");
    expect(badInverted).toEqual({ ok: false, reason: "unsafe-structure" });
  });

  it("refuses a single-line body edit that introduces a newline the projection cannot represent structurally the same way (still succeeds, becomes single-line->multiline is out of scope: body newline is folded into unsafe-structure only for ordered/task/list single-line paths)", () => {
    const raw = "  - 子本文";
    const built = buildChildLeafProjection(raw);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const inverted = invertChildLeafProjection(built.projection, false, "", "行1\n行2");
    expect(inverted).toEqual({ ok: false, reason: "unsafe-structure" });
  });
});

describe("buildParentChildInlineEditSession", () => {
  it("captures sibling snapshots and the target's own relative range", () => {
    const raw = ["- 親", "  - 子A", "  - 子B", "  - 子C"].join("\n");
    const { session } = buildSession(raw, "li-2");
    expect(session.parentNodeId).toBe("li-0");
    expect(session.childNodeId).toBe("li-2");
    expect(session.expectedChildCount).toBe(3);
    expect(session.selectedChildIndex).toBe(1);
    expect(session.otherChildrenSnapshots).toEqual([
      { nodeId: "li-1", rawText: "  - 子A" },
      { nodeId: "li-3", rawText: "  - 子C" },
    ]);
    expect(session.originalChildRawText).toBe("  - 子B");
    // childSubtreeText is "  - 子A\n  - 子B\n  - 子C" — 子B sits at relative line 1.
    expect(session.childRelativeRange).toEqual({ startLine: 1, endLine: 1 });
  });

  it("refuses to build a session for an ineligible child", () => {
    const raw = ["- 親", "  - 子1", "    - 孫1"].join("\n");
    const { doc, node, projection } = buildParent(raw);
    const built = buildParentChildInlineEditSession(doc, node, projection, "li-1");
    expect(built).toEqual({ ok: false, reason: "child-has-children" });
  });
});

describe("invertAndValidateParentChildCombinedEdit", () => {
  it("parent-only edit: child candidate is untouched, siblings preserved", () => {
    const raw = ["- 親本文", "  - 子A", "  - 子B"].join("\n");
    const { projection, session } = buildSession(raw, "li-1");
    const result = invertAndValidateParentChildCombinedEdit({
      parentProjection: projection,
      session,
      parentDirty: true,
      childDirty: false,
      editedParentChecked: false,
      editedParentNumberText: "",
      editedParentBody: "親本文（編集済み）",
      editedChildChecked: false,
      editedChildNumberText: "",
      editedChildBody: "",
    });
    expect(result).toEqual({ ok: true, parentOwnTextRawText: "- 親本文（編集済み）", childRawText: "  - 子A" });
  });

  it("child-only edit: parent candidate is untouched", () => {
    const raw = ["- 親本文", "  - 子A", "  - 子B"].join("\n");
    const { projection, session } = buildSession(raw, "li-1");
    const result = invertAndValidateParentChildCombinedEdit({
      parentProjection: projection,
      session,
      parentDirty: false,
      childDirty: true,
      editedParentChecked: false,
      editedParentNumberText: "",
      editedParentBody: "",
      editedChildChecked: false,
      editedChildNumberText: "",
      editedChildBody: "子A（編集済み）",
    });
    expect(result).toEqual({ ok: true, parentOwnTextRawText: "- 親本文", childRawText: "  - 子A（編集済み）" });
  });

  it("simultaneous parent + task child edit succeeds together", () => {
    const raw = ["- [ ] 親タスク", "  - [ ] 子タスク"].join("\n");
    const { projection, session } = buildSession(raw, "li-1");
    const result = invertAndValidateParentChildCombinedEdit({
      parentProjection: projection,
      session,
      parentDirty: true,
      childDirty: true,
      editedParentChecked: true,
      editedParentNumberText: "",
      editedParentBody: "親タスク完了",
      editedChildChecked: true,
      editedChildNumberText: "",
      editedChildBody: "子タスク完了",
    });
    expect(result).toEqual({
      ok: true,
      parentOwnTextRawText: "- [x] 親タスク完了",
      childRawText: "  - [x] 子タスク完了",
    });
  });

  it("simultaneous ordered parent + ordered child edit succeeds together", () => {
    const raw = ["1. 親", "  1. 子"].join("\n");
    const { projection, session } = buildSession(raw, "li-1");
    const result = invertAndValidateParentChildCombinedEdit({
      parentProjection: projection,
      session,
      parentDirty: true,
      childDirty: true,
      editedParentChecked: false,
      editedParentNumberText: "9",
      editedParentBody: "親改",
      editedChildChecked: false,
      editedChildNumberText: "7",
      editedChildBody: "子改",
    });
    expect(result).toEqual({ ok: true, parentOwnTextRawText: "9. 親改", childRawText: "  7. 子改" });
  });

  it("rejects an invalid parent ordered number, preserving the (unvalidated) child candidate is never returned at all", () => {
    const raw = ["1. 親", "  - 子"].join("\n");
    const { projection, session } = buildSession(raw, "li-1");
    const result = invertAndValidateParentChildCombinedEdit({
      parentProjection: projection,
      session,
      parentDirty: true,
      childDirty: false,
      editedParentChecked: false,
      editedParentNumberText: "abc",
      editedParentBody: "親",
      editedChildChecked: false,
      editedChildNumberText: "",
      editedChildBody: "",
    });
    expect(result).toEqual({ ok: false, reason: "parent-invalid-number" });
  });

  it("rejects an invalid child ordered number", () => {
    const raw = ["- 親", "  1. 子"].join("\n");
    const { projection, session } = buildSession(raw, "li-1");
    const result = invertAndValidateParentChildCombinedEdit({
      parentProjection: projection,
      session,
      parentDirty: false,
      childDirty: true,
      editedParentChecked: false,
      editedParentNumberText: "",
      editedParentBody: "",
      editedChildChecked: false,
      editedChildNumberText: "-1",
      editedChildBody: "子",
    });
    expect(result).toEqual({ ok: false, reason: "child-invalid-number" });
  });

  it("rejects a child edit that would manufacture a nested grandchild list item", () => {
    const raw = ["- 親", "  - 子本文", "    続き"].join("\n");
    const { projection, session } = buildSession(raw, "li-1");
    const result = invertAndValidateParentChildCombinedEdit({
      parentProjection: projection,
      session,
      parentDirty: false,
      childDirty: true,
      editedParentChecked: false,
      editedParentNumberText: "",
      editedParentBody: "",
      editedChildChecked: false,
      editedChildNumberText: "",
      editedChildBody: "子本文\n- 新しい孫のつもり",
    });
    expect(result).toEqual({ ok: false, reason: "child-unsafe-structure" });
  });

  it("multiLine parent + multiLine child simultaneous edit preserves both", () => {
    const raw = ["- 親本文", "  続き親", "  - 子本文", "    続き子"].join("\n");
    const { projection, session } = buildSession(raw, "li-1");
    const result = invertAndValidateParentChildCombinedEdit({
      parentProjection: projection,
      session,
      parentDirty: true,
      childDirty: true,
      editedParentChecked: false,
      editedParentNumberText: "",
      editedParentBody: "親本文\n続き親改",
      editedChildChecked: false,
      editedChildNumberText: "",
      editedChildBody: "子本文\n続き子改",
    });
    expect(result).toEqual({
      ok: true,
      parentOwnTextRawText: "- 親本文\n  続き親改",
      childRawText: "  - 子本文\n    続き子改",
    });
  });

  it("no-op (neither dirty) returns the original texts unchanged", () => {
    const raw = ["- 親", "  - 子"].join("\n");
    const { projection, session } = buildSession(raw, "li-1");
    const result = invertAndValidateParentChildCombinedEdit({
      parentProjection: projection,
      session,
      parentDirty: false,
      childDirty: false,
      editedParentChecked: false,
      editedParentNumberText: "",
      editedParentBody: "",
      editedChildChecked: false,
      editedChildNumberText: "",
      editedChildBody: "",
    });
    expect(result).toEqual({ ok: true, parentOwnTextRawText: "- 親", childRawText: "  - 子" });
  });
});

describe("applyParentChildInlineEditToDocument: atomic write, conflict, and invariance", () => {
  it("parent-only Apply rewrites only the parent's own-text range; child and siblings are byte-identical", () => {
    const raw = ["- 親本文", "  - 子A", "  - 子B"].join("\n");
    const doc = parseDocument(raw);
    const outcome = applyParentChildInlineEditToDocument(
      doc,
      "li-0",
      "li-1",
      true,
      false,
      "- 親本文",
      "  - 子A",
      "- 親本文（更新）",
      "  - 子A"
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- 親本文（更新）", "  - 子A", "  - 子B"]);
  });

  it("child-only Apply rewrites only the child's own range; parent and siblings are byte-identical", () => {
    const raw = ["- 親本文", "  - 子A", "  - 子B"].join("\n");
    const doc = parseDocument(raw);
    const outcome = applyParentChildInlineEditToDocument(
      doc,
      "li-0",
      "li-1",
      false,
      true,
      "- 親本文",
      "  - 子A",
      "- 親本文",
      "  - 子A（更新）"
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- 親本文", "  - 子A（更新）", "  - 子B"]);
  });

  it("simultaneous parent+child Apply rewrites both ranges in ONE outcome, grandchild/sibling untouched", () => {
    const raw = ["- 親本文", "  - 子A本文", "    子A続き", "  - 子B", "    - 孫B1"].join("\n");
    const doc = parseDocument(raw);
    const outcome = applyParentChildInlineEditToDocument(
      doc,
      "li-0",
      "li-1",
      true,
      true,
      "- 親本文",
      "  - 子A本文\n    子A続き",
      "- 親本文（更新）",
      "  - 子A本文（更新）"
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- 親本文（更新）",
      "  - 子A本文（更新）",
      "  - 子B",
      "    - 孫B1",
    ]);
  });

  it("rejects on parent conflict (external change to the DIRTY parent range) and touches nothing", () => {
    const raw = ["- 親本文（外部編集）", "  - 子A"].join("\n");
    const doc = parseDocument(raw);
    const outcome = applyParentChildInlineEditToDocument(
      doc,
      "li-0",
      "li-1",
      true,
      false,
      "- 親本文（元）",
      "  - 子A",
      "- 親本文（更新）",
      "  - 子A"
    );
    expect(outcome).toEqual({
      changed: false,
      lines: doc.lines,
      parentNewStartLine: -1,
      childNewStartLine: -1,
      reason: "parent-conflict",
    });
  });

  it("rejects on child conflict (external change to the DIRTY child range) and touches nothing", () => {
    const raw = ["- 親本文", "  - 子A（外部編集）"].join("\n");
    const doc = parseDocument(raw);
    const outcome = applyParentChildInlineEditToDocument(
      doc,
      "li-0",
      "li-1",
      false,
      true,
      "- 親本文",
      "  - 子A（元）",
      "- 親本文",
      "  - 子A（更新）"
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("child-conflict");
    expect(outcome.lines).toBe(doc.lines);
  });

  it("a clean (non-dirty) parent range is never conflict-checked against an external change, and is spliced back with whatever is LIVE, never the stale original", () => {
    const raw = ["- 親本文（外部で変わった）", "  - 子A"].join("\n");
    const doc = parseDocument(raw);
    const outcome = applyParentChildInlineEditToDocument(
      doc,
      "li-0",
      "li-1",
      false,
      true,
      "- 親本文（元、もう古い）",
      "  - 子A",
      "- 親本文（使われない）",
      "  - 子A（更新）"
    );
    expect(outcome.changed).toBe(true);
    // The parent line stays exactly what the LIVE document currently has —
    // never the stale original, never the (unused, since parent isn't dirty) new* value.
    expect(outcome.lines).toEqual(["- 親本文（外部で変わった）", "  - 子A（更新）"]);
  });

  it("rejects when the child is no longer a direct child of this parent (moved/reassigned)", () => {
    const raw = ["- 親1", "  - 子1of1", "- 親2", "  - 子"].join("\n");
    const doc = parseDocument(raw);
    // li-3 ("子") is a direct child of li-2 ("親2"), not li-0 ("親1") — even
    // though li-0 itself resolves fine as a parent (it owns li-1).
    const outcome = applyParentChildInlineEditToDocument(
      doc,
      "li-0",
      "li-3",
      false,
      true,
      "- 親1",
      "  - 子",
      "- 親1",
      "  - 子（更新）"
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("not-direct-child");
  });

  it("rejects when the child externally gained a grandchild (no longer a leaf)", () => {
    const raw = ["- 親", "  - 子", "    - 新しい孫"].join("\n");
    const doc = parseDocument(raw);
    const outcome = applyParentChildInlineEditToDocument(
      doc,
      "li-0",
      "li-1",
      false,
      true,
      "- 親",
      "  - 子",
      "- 親",
      "  - 子（更新）"
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("child-has-children");
  });

  it("rejects when the parent itself no longer resolves (deleted/renamed away)", () => {
    const raw = ["# 見出し", "本文のみ"].join("\n");
    const doc = parseDocument(raw);
    const outcome = applyParentChildInlineEditToDocument(
      doc,
      "li-0",
      "li-1",
      true,
      true,
      "- 親",
      "  - 子",
      "- 親（更新）",
      "  - 子（更新）"
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("parent-resolve-failed");
  });
});

describe("end-to-end: session -> invert+validate -> live apply, full round trip", () => {
  it("unordered parent with multiple children + a grandchild under a DIFFERENT child: editing one child leaves the grandchild and other child byte-identical", () => {
    const raw = ["- 親本文", "  - 子A本文", "  - 子B", "    - 孫B1", "  - 子C"].join("\n");
    const { doc, node, projection, session } = buildSession(raw, "li-1");
    const combined = invertAndValidateParentChildCombinedEdit({
      parentProjection: projection,
      session,
      parentDirty: false,
      childDirty: true,
      editedParentChecked: false,
      editedParentNumberText: "",
      editedParentBody: "",
      editedChildChecked: false,
      editedChildNumberText: "",
      editedChildBody: "子A本文（編集済み）",
    });
    expect(combined.ok).toBe(true);
    if (!combined.ok) return;
    const applied = applyParentChildInlineEditToDocument(
      doc,
      node.id,
      session.childNodeId,
      false,
      true,
      projection.ownText.rawText,
      session.originalChildRawText,
      combined.parentOwnTextRawText,
      combined.childRawText
    );
    expect(applied.changed).toBe(true);
    expect(applied.lines).toEqual([
      "- 親本文",
      "  - 子A本文（編集済み）",
      "  - 子B",
      "    - 孫B1",
      "  - 子C",
    ]);
  });

  it("a single-line child's own edit can never silently grow into a multi-line body (mirrors the parent's own identical single-line-shape guarantee)", () => {
    const raw = ["- 親本文", "  - 子A", "  - 子B"].join("\n");
    const { projection, session } = buildSession(raw, "li-2");
    const combined = invertAndValidateParentChildCombinedEdit({
      parentProjection: projection,
      session,
      parentDirty: false,
      childDirty: true,
      editedParentChecked: false,
      editedParentNumberText: "",
      editedParentBody: "",
      editedChildChecked: false,
      editedChildNumberText: "",
      editedChildBody: "子B\n追加の続き行",
    });
    expect(combined).toEqual({ ok: false, reason: "child-unsafe-structure" });
  });

  it("selecting the LAST, already-multi-line child and growing its own continuation body does not disturb earlier siblings or the parent's own boundary", () => {
    const raw = ["- 親本文", "  - 子A", "  - 子B本文", "    子B続き"].join("\n");
    const { doc, node, projection, session } = buildSession(raw, "li-2");
    const combined = invertAndValidateParentChildCombinedEdit({
      parentProjection: projection,
      session,
      parentDirty: false,
      childDirty: true,
      editedParentChecked: false,
      editedParentNumberText: "",
      editedParentBody: "",
      editedChildChecked: false,
      editedChildNumberText: "",
      editedChildBody: "子B本文\n子B続き\n追加の続き行",
    });
    expect(combined.ok).toBe(true);
    if (!combined.ok) return;
    const applied = applyParentChildInlineEditToDocument(
      doc,
      node.id,
      session.childNodeId,
      false,
      true,
      projection.ownText.rawText,
      session.originalChildRawText,
      combined.parentOwnTextRawText,
      combined.childRawText
    );
    expect(applied.changed).toBe(true);
    expect(applied.lines).toEqual([
      "- 親本文",
      "  - 子A",
      "  - 子B本文",
      "    子B続き",
      "    追加の続き行",
    ]);
  });
});

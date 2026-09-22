/**
 * Phase 5L-7 ("Read-Only Child Subtree Preview Navigation"): real-pipeline
 * tests for the new preview-row navigation-target data
 * (ParentListItemProjection#childPreviewRowTargets, built by
 * buildParentListItemProjection/buildChildPreviewRowTargets) and its
 * click-time re-resolution (resolveParentChildPreviewNavigationTarget) —
 * all against the actual parser, mirroring
 * tests/parentListItemProjection.test.ts's own house style (real
 * parseDocument, never a hand-built fake ParsedDocument).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode } from "../src/model/block";
import {
  buildParentListItemProjection,
  resolveParentChildPreviewNavigationTarget,
} from "../src/edit/parentListItemProjection";

function buildOk(raw: string, nodeId = "li-0") {
  const doc = parseDocument(raw);
  const node = doc.nodes.get(nodeId);
  if (!node || !isListNode(node)) throw new Error(`fixture setup error: ${nodeId} not a list node`);
  const built = buildParentListItemProjection(doc, node);
  if (!built.ok) throw new Error(`fixture setup error: build failed with reason ${built.reason}`);
  return { doc, node, projection: built.projection };
}

describe("buildParentListItemProjection: childPreviewRowTargets (Phase 5L-7)", () => {
  it("gives the direct child's own row a target pointing at the child's own nodeId", () => {
    const raw = ["- 親項目", "  - 子1", "  - 子2"].join("\n");
    const { projection } = buildOk(raw);
    const rows = projection.childSubtreeText.split("\n");
    expect(rows).toEqual(["  - 子1", "  - 子2"]);
    expect(projection.childPreviewRowTargets[0]).toEqual({ nodeId: "li-1", firstLineRawText: "  - 子1" });
    expect(projection.childPreviewRowTargets[1]).toEqual({ nodeId: "li-2", firstLineRawText: "  - 子2" });
  });

  it("gives a grandchild's own row a target pointing at the grandchild's own (deepest-owner) nodeId, not the direct child's", () => {
    const raw = ["- 親項目", "  - 子1", "    - 孫1", "  - 子2"].join("\n");
    const { projection } = buildOk(raw);
    const rows = projection.childSubtreeText.split("\n");
    expect(rows[1]).toBe("    - 孫1");
    expect(projection.childPreviewRowTargets[1]).toEqual({ nodeId: "li-2", firstLineRawText: "    - 孫1" });
  });

  it("resolves target identity for an unordered/task/ordered child item alike", () => {
    const raw = ["- 親項目", "  - 子（unordered）", "  - [ ] 子（task）", "  1. 子（ordered）"].join("\n");
    const { projection } = buildOk(raw);
    const rows = projection.childSubtreeText.split("\n");
    expect(rows).toEqual(["  - 子（unordered）", "  - [ ] 子（task）", "  1. 子（ordered）"]);
    for (let i = 0; i < rows.length; i++) {
      expect(projection.childPreviewRowTargets[i]).toEqual({ nodeId: `li-${i + 1}`, firstLineRawText: rows[i] });
    }
  });

  it("resolves a first-line target for a child item with a continuation line, and the continuation row shares the SAME target", () => {
    const raw = ["- 親項目", "  - 子1本文", "    続き行", "  - 子2"].join("\n");
    const { projection } = buildOk(raw);
    const rows = projection.childSubtreeText.split("\n");
    expect(rows).toEqual(["  - 子1本文", "    続き行", "  - 子2"]);
    expect(projection.childPreviewRowTargets[0]).toEqual({ nodeId: "li-1", firstLineRawText: "  - 子1本文" });
    // Continuation line: same navigation target as its own item's first line.
    expect(projection.childPreviewRowTargets[1]).toEqual({ nodeId: "li-1", firstLineRawText: "  - 子1本文" });
    expect(projection.childPreviewRowTargets[2]).toEqual({ nodeId: "li-2", firstLineRawText: "  - 子2" });
  });

  it("resolves a first-line target for a child item across a blank continuation line", () => {
    const raw = ["- 親項目", "  - 子1本文", "", "    続き行", "  - 子2"].join("\n");
    const { projection } = buildOk(raw);
    const rows = projection.childSubtreeText.split("\n");
    expect(rows).toEqual(["  - 子1本文", "", "    続き行", "  - 子2"]);
    // Every row belonging to 子1's own range (blank line included) resolves
    // to 子1's own nodeId — never null, never the parent's own id.
    expect(projection.childPreviewRowTargets[0]?.nodeId).toBe("li-1");
    expect(projection.childPreviewRowTargets[1]?.nodeId).toBe("li-1");
    expect(projection.childPreviewRowTargets[2]?.nodeId).toBe("li-1");
    expect(projection.childPreviewRowTargets[3]).toEqual({ nodeId: "li-2", firstLineRawText: "  - 子2" });
  });

  it("never targets the parent's own nodeId for any child-subtree row", () => {
    const raw = ["- 親項目", "  - 子1", "  - 子2"].join("\n");
    const { projection } = buildOk(raw);
    for (const target of projection.childPreviewRowTargets) {
      expect(target?.nodeId).not.toBe("li-0");
    }
  });

  it("rebuilding the projection against a DIFFERENT (structurally shifted) parse updates every target to the current document's own ids — never the earlier parse's stale ids", () => {
    const rawA = ["- 親項目", "  - 子1", "  - 子2"].join("\n");
    const { projection: projA } = buildOk(rawA);
    expect(projA.childPreviewRowTargets[0]?.nodeId).toBe("li-1");

    const rawB = ["- 別の独立した項目", "- 親項目", "  - 子1", "  - 子2"].join("\n");
    const docB = parseDocument(rawB);
    const nodeB = docB.nodes.get("li-1"); // "親項目" is now li-1, not li-0
    if (!nodeB || !isListNode(nodeB)) throw new Error("fixture setup error");
    const builtB = buildParentListItemProjection(docB, nodeB);
    if (!builtB.ok) throw new Error("fixture setup error");
    expect(builtB.projection.nodeId).toBe("li-1");
    expect(builtB.projection.childPreviewRowTargets[0]).toEqual({ nodeId: "li-2", firstLineRawText: "  - 子1" });
  });
});

describe("resolveParentChildPreviewNavigationTarget (Phase 5L-7 click-time re-resolution)", () => {
  it("resolves successfully when nothing has changed since the target was captured", () => {
    const raw = ["- 親項目", "  - 子1", "  - 子2"].join("\n");
    const { doc, projection } = buildOk(raw);
    const target = projection.childPreviewRowTargets[1]!;
    const resolved = resolveParentChildPreviewNavigationTarget(doc, projection.nodeId, target);
    expect(resolved).toEqual({ ok: true, nodeId: "li-2" });
  });

  it("refuses with parent-unresolvable when the parent itself is no longer eligible (lost all children)", () => {
    const rawA = ["- 親項目", "  - 子1", "  - 子2"].join("\n");
    const { projection } = buildOk(rawA);
    const target = projection.childPreviewRowTargets[0]!;

    const rawB = ["- 親項目"].join("\n");
    const docB = parseDocument(rawB);
    const resolved = resolveParentChildPreviewNavigationTarget(docB, "li-0", target);
    expect(resolved).toEqual({ ok: false, reason: "parent-unresolvable" });
  });

  it("refuses with target-not-found when the target's own id no longer resolves to anything", () => {
    const rawA = ["- 親項目", "  - 子1", "  - 子2"].join("\n");
    const { projection } = buildOk(rawA);
    const target = projection.childPreviewRowTargets[1]!; // 子2, nodeId "li-2"
    expect(target.nodeId).toBe("li-2");

    // 子2 removed outright — "li-2" is never assigned in the new parse.
    const rawB = ["- 親項目", "  - 子1"].join("\n");
    const docB = parseDocument(rawB);
    const resolved = resolveParentChildPreviewNavigationTarget(docB, "li-0", target);
    expect(resolved).toEqual({ ok: false, reason: "target-not-found" });
  });

  it("refuses with target-not-descendant when the captured id has been reassigned, by document reshuffling, to a node OUTSIDE the parent's current child subtree — never silently opening that unrelated node", () => {
    const rawA = ["- 親項目", "  - 子1", "    - 孫1", "  - 子2", "- 独立項目"].join("\n");
    const docA = parseDocument(rawA);
    const nodeA = docA.nodes.get("li-0");
    if (!nodeA || !isListNode(nodeA)) throw new Error("fixture setup error");
    const builtA = buildParentListItemProjection(docA, nodeA);
    if (!builtA.ok) throw new Error("fixture setup error");
    // 子2 is li-3 in docA.
    const targetForKo2 = builtA.projection.childPreviewRowTargets.find(
      (t) => t?.firstLineRawText === "  - 子2"
    )!;
    expect(targetForKo2.nodeId).toBe("li-3");

    // 孫1 removed externally — every id from li-2 onward shifts down by one,
    // so "li-3" now names what used to be "独立項目": a real list node, but
    // OUTSIDE 親項目's own child subtree entirely.
    const rawB = ["- 親項目", "  - 子1", "  - 子2", "- 独立項目"].join("\n");
    const docB = parseDocument(rawB);
    const shiftedNode = docB.nodes.get("li-3");
    expect(shiftedNode?.range.startLine).toBe(3); // "- 独立項目" line, not "子2"

    const resolved = resolveParentChildPreviewNavigationTarget(docB, "li-0", targetForKo2);
    expect(resolved).toEqual({ ok: false, reason: "target-not-descendant" });
  });

  it("refuses with target-content-changed when the id still falls within the parent's child range but the underlying content has changed", () => {
    const rawA = ["- 親項目", "  - 子1", "  - 子2"].join("\n");
    const { projection } = buildOk(rawA);
    const target = projection.childPreviewRowTargets[0]!; // 子1, nodeId "li-1"
    expect(target.nodeId).toBe("li-1");

    // 子1 renamed in place (still the parent's first child, same id).
    const rawB = ["- 親項目", "  - 子1改名", "  - 子2"].join("\n");
    const docB = parseDocument(rawB);
    const resolved = resolveParentChildPreviewNavigationTarget(docB, "li-0", target);
    expect(resolved).toEqual({ ok: false, reason: "target-content-changed" });
  });

  it("never opens a different, unrelated item due to a stale captured id — every refusal reason leaves nodeId out of the ok:true shape", () => {
    const rawA = ["- 親項目", "  - 子1", "  - 子2"].join("\n");
    const { projection } = buildOk(rawA);
    const target = projection.childPreviewRowTargets[0]!;
    const rawB = ["- 親項目", "  - 子1改名", "  - 子2"].join("\n");
    const docB = parseDocument(rawB);
    const resolved = resolveParentChildPreviewNavigationTarget(docB, "li-0", target);
    expect(resolved.ok).toBe(false);
    expect((resolved as { nodeId?: string }).nodeId).toBeUndefined();
  });
});

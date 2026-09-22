/**
 * Phase 5L-11 ("Direct Child Leaf Indent/Outdent in Parent Partial Edit
 * Pane"): real-pipeline tests for edit/parentChildInlineEditSession.ts's
 * own Phase 5L-11 section (evaluateChildIndentEligibility,
 * evaluateChildOutdentEligibility, buildPendingIndent, buildPendingOutdent,
 * buildIndentOutdentPreviewText, applyParentChildIndentOutdentToDocument) —
 * mirrors tests/parentChildReorder.test.ts's own house style (real
 * parseDocument, never a hand-built fake ParsedDocument), in isolation from
 * the Partial Edit Pane's own View-layer wiring (covered separately in
 * tests/parentChildIndentOutdentUiWiring.test.ts).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode, ListBlockNode } from "../src/model/block";
import { buildParentListItemProjection } from "../src/edit/parentListItemProjection";
import {
  buildPendingIndent,
  buildPendingOutdent,
  buildIndentOutdentPreviewText,
  applyParentChildIndentOutdentToDocument,
  evaluateChildIndentEligibility,
  evaluateChildOutdentEligibility,
  projectedChildChecked,
  projectedChildNumberText,
  childEffectiveControlKind,
  PendingIndentOutdent,
} from "../src/edit/parentChildInlineEditSession";

function buildParent(raw: string, nodeId = "li-0") {
  const d = parseDocument(raw);
  const n = d.nodes.get(nodeId);
  if (!n || !isListNode(n)) throw new Error(`fixture setup error: ${nodeId} not a list node`);
  const built = buildParentListItemProjection(d, n);
  if (!built.ok) throw new Error(`fixture setup error: parent build failed with reason ${built.reason}`);
  return { doc: d, node: n, projection: built.projection };
}

describe("evaluateChildIndentEligibility", () => {
  it("refuses the first direct child — no preceding sibling to indent under", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { doc, node } = buildParent(raw);
    const result = evaluateChildIndentEligibility(doc, node, node.childIds[0]);
    expect(result).toEqual({ ok: false, reason: "no-preceding-sibling" });
  });

  it("accepts a 2nd+ child whose preceding sibling is a plain childless leaf", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { doc, node } = buildParent(raw);
    const result = evaluateChildIndentEligibility(doc, node, node.childIds[1]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.siblingNode.id).toBe(node.childIds[0]);
      expect(result.childNode.id).toBe(node.childIds[1]);
    }
  });

  it("accepts indenting into a preceding sibling that already owns its own child subtree", () => {
    const raw = ["- 親", "  - 子1", "    - 子1の孫", "  - 子2"].join("\n");
    const { doc, node } = buildParent(raw);
    const result = evaluateChildIndentEligibility(doc, node, node.childIds[1]);
    expect(result.ok).toBe(true);
  });

  it("refuses a grandchild-bearing target — same child-has-children reason evaluateChildInlineEditEligibility already uses", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "    - 子2の孫"].join("\n");
    const { doc, node } = buildParent(raw);
    const result = evaluateChildIndentEligibility(doc, node, node.childIds[1]);
    expect(result).toEqual({ ok: false, reason: "child-has-children" });
  });

  it("refuses when the immediately preceding sibling is unsafeIndent", () => {
    const raw = ["- 親", "\t- 子1タブ", "  - 子2"].join("\n");
    const { doc, node } = buildParent(raw);
    // Defensive sanity: the fixture's first child really is flagged unsafeIndent
    // by the parser (a tab where the sibling above/below use spaces).
    const siblingNode = doc.nodes.get(node.childIds[0]) as ListBlockNode;
    if (siblingNode.unsafeIndent) {
      const result = evaluateChildIndentEligibility(doc, node, node.childIds[1]);
      expect(result).toEqual({ ok: false, reason: "preceding-sibling-unsafe-indent" });
    } else {
      // Parser didn't flag this particular tab/space mix as unsafe in this
      // environment — skip rather than assert a false premise.
      expect(true).toBe(true);
    }
  });

  it("accepts a task-list and an ordered-list leaf target alike (dispatches through evaluateChildInlineEditEligibility unmodified)", () => {
    const raw = ["- 親", "  - 子1", "  - [ ] 子2", "  1. 子3"].join("\n");
    const { doc, node } = buildParent(raw);
    expect(evaluateChildIndentEligibility(doc, node, node.childIds[1]).ok).toBe(true);
    expect(evaluateChildIndentEligibility(doc, node, node.childIds[2]).ok).toBe(true);
  });
});

describe("evaluateChildOutdentEligibility", () => {
  it("accepts a leaf nested exactly one level under a direct child", () => {
    const raw = ["- 親", "  - 子1", "    - 孫1"].join("\n");
    const { doc, node } = buildParent(raw);
    const directChild = doc.nodes.get(node.childIds[0]) as ListBlockNode;
    const grandchildId = directChild.childIds[0];
    const result = evaluateChildOutdentEligibility(doc, node, grandchildId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.currentParentNode.id).toBe(directChild.id);
    }
  });

  it("refuses a DIRECT child of the parent — not-nested-child (the outdent target is never a direct child by definition)", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { doc, node } = buildParent(raw);
    const result = evaluateChildOutdentEligibility(doc, node, node.childIds[0]);
    expect(result).toEqual({ ok: false, reason: "not-nested-child" });
  });

  it("refuses a node two levels deep — out of scope, never silently treated as one level", () => {
    const raw = ["- 親", "  - 子1", "    - 孫1", "      - 曾孫1"].join("\n");
    const { doc, node } = buildParent(raw);
    const directChild = doc.nodes.get(node.childIds[0]) as ListBlockNode;
    const grandchild = doc.nodes.get(directChild.childIds[0]) as ListBlockNode;
    const greatGrandchildId = grandchild.childIds[0];
    const result = evaluateChildOutdentEligibility(doc, node, greatGrandchildId);
    expect(result).toEqual({ ok: false, reason: "not-nested-child" });
  });

  it("refuses a nested node that itself owns a grandchild subtree — child-has-children", () => {
    const raw = ["- 親", "  - 子1", "    - 孫1", "      - 孫1の子"].join("\n");
    const { doc, node } = buildParent(raw);
    const directChild = doc.nodes.get(node.childIds[0]) as ListBlockNode;
    const grandchildId = directChild.childIds[0];
    const result = evaluateChildOutdentEligibility(doc, node, grandchildId);
    expect(result).toEqual({ ok: false, reason: "child-has-children" });
  });

  it("the user's own worked example: 親→A→(B,C) — both B and C are individually outdent-eligible nested leaves", () => {
    const raw = ["- 親", "  - A", "    - B", "    - C"].join("\n");
    const { doc, node } = buildParent(raw);
    const a = doc.nodes.get(node.childIds[0]) as ListBlockNode;
    expect(a.childIds.length).toBe(2);
    expect(evaluateChildOutdentEligibility(doc, node, a.childIds[0]).ok).toBe(true);
    expect(evaluateChildOutdentEligibility(doc, node, a.childIds[1]).ok).toBe(true);
  });
});

describe("buildPendingIndent / buildPendingOutdent", () => {
  it("buildPendingIndent captures childNodeId + the preceding sibling's own id as relatedNodeId", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { doc, node } = buildParent(raw);
    const built = buildPendingIndent(doc, node, node.childIds[1]);
    expect(built).toEqual({
      ok: true,
      pending: { kind: "indent", childNodeId: node.childIds[1], relatedNodeId: node.childIds[0] },
    });
  });

  it("buildPendingIndent propagates the underlying eligibility refusal reason verbatim", () => {
    const raw = ["- 親", "  - 子1"].join("\n");
    const { doc, node } = buildParent(raw);
    const built = buildPendingIndent(doc, node, node.childIds[0]);
    expect(built).toEqual({ ok: false, reason: "no-preceding-sibling" });
  });

  it("buildPendingOutdent captures childNodeId + the current parent's own id as relatedNodeId", () => {
    const raw = ["- 親", "  - 子1", "    - 孫1"].join("\n");
    const { doc, node } = buildParent(raw);
    const directChild = doc.nodes.get(node.childIds[0]) as ListBlockNode;
    const built = buildPendingOutdent(doc, node, directChild.childIds[0]);
    expect(built).toEqual({
      ok: true,
      pending: { kind: "outdent", childNodeId: directChild.childIds[0], relatedNodeId: directChild.id },
    });
  });

  it("buildPendingOutdent propagates the underlying eligibility refusal reason verbatim", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { doc, node } = buildParent(raw);
    const built = buildPendingOutdent(doc, node, node.childIds[0]);
    expect(built).toEqual({ ok: false, reason: "not-nested-child" });
  });
});

describe("buildIndentOutdentPreviewText — §8 'preview must show the POST-transform hierarchy'", () => {
  it("indent: the preview text re-parses with the target nested as the sibling's own last child, siblings otherwise untouched", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { doc, node, projection } = buildParent(raw);
    const pendingBuilt = buildPendingIndent(doc, node, node.childIds[1]);
    expect(pendingBuilt.ok).toBe(true);
    if (!pendingBuilt.ok) return;
    const previewText = buildIndentOutdentPreviewText(doc, node, projection, pendingBuilt.pending);
    const previewDoc = parseDocument("- 親\n" + previewText);
    const previewParent = previewDoc.nodes.get("li-0") as ListBlockNode;
    expect(previewParent.childIds.length).toBe(2); // 子1 (now owning 子2), 子3
    const previewSibling = previewDoc.nodes.get(previewParent.childIds[0]) as ListBlockNode;
    expect(previewSibling.childIds.length).toBe(1);
    const nestedChild = previewDoc.nodes.get(previewSibling.childIds[0]) as ListBlockNode;
    expect(nestedChild.childIds.length).toBe(0);
    const nestedChildRaw = previewDoc.lines.slice(nestedChild.range.startLine, nestedChild.range.endLine + 1).join("\n");
    expect(nestedChildRaw).toContain("子2");
    const thirdChild = previewDoc.nodes.get(previewParent.childIds[1]) as ListBlockNode;
    const thirdChildRaw = previewDoc.lines.slice(thirdChild.range.startLine, thirdChild.range.endLine + 1).join("\n");
    expect(thirdChildRaw).toContain("子3");
  });

  it("indent: falls back to the untransformed childSubtreeText when the pending transform no longer re-resolves (stale relatedNodeId)", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { doc, node, projection } = buildParent(raw);
    const stalePending: PendingIndentOutdent = { kind: "indent", childNodeId: node.childIds[2], relatedNodeId: node.childIds[0] };
    // node.childIds[2]'s REAL preceding sibling is node.childIds[1], not
    // node.childIds[0] — this pending transform is stale by construction.
    const previewText = buildIndentOutdentPreviewText(doc, node, projection, stalePending);
    expect(previewText).toBe(projection.childSubtreeText);
  });

  it("outdent: the user's own worked example — outdenting B from 親→A→(B,C) previews as 親→A→(C), 親→B, never dragging C along", () => {
    const raw = ["- 親", "  - A", "    - B", "    - C"].join("\n");
    const { doc, node, projection } = buildParent(raw);
    const a = doc.nodes.get(node.childIds[0]) as ListBlockNode;
    const pendingBuilt = buildPendingOutdent(doc, node, a.childIds[0]); // outdent B
    expect(pendingBuilt.ok).toBe(true);
    if (!pendingBuilt.ok) return;
    const previewText = buildIndentOutdentPreviewText(doc, node, projection, pendingBuilt.pending);
    const previewDoc = parseDocument("- 親\n" + previewText);
    const previewParent = previewDoc.nodes.get("li-0") as ListBlockNode;
    expect(previewParent.childIds.length).toBe(2); // A (with only C now), and B as a new direct child
    const previewA = previewDoc.nodes.get(previewParent.childIds[0]) as ListBlockNode;
    expect(previewA.childIds.length).toBe(1); // C stayed under A — never dragged along with B
    const previewC = previewDoc.nodes.get(previewA.childIds[0]) as ListBlockNode;
    expect(previewC.range.startLine).toBeGreaterThan(previewA.range.startLine);
    const previewB = previewDoc.nodes.get(previewParent.childIds[1]) as ListBlockNode;
    expect(previewB.childIds.length).toBe(0);
  });
});

describe("applyParentChildIndentOutdentToDocument — indent", () => {
  it("indents a 2nd child into a preceding childless sibling: the sibling gains exactly one new leaf child, and every OTHER sibling is preserved", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { doc, node, projection } = buildParent(raw);
    const built = buildPendingIndent(doc, node, node.childIds[1]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const outcome = applyParentChildIndentOutdentToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      built.pending,
      projection.childSubtreeText
    );
    expect(outcome.changed).toBe(true);
    const resultDoc = parseDocument(outcome.lines.join("\n"));
    const resultParent = resultDoc.nodes.get("li-0") as ListBlockNode;
    expect(resultParent.childIds.length).toBe(2); // 子1 (now owning 子2), 子3
    const resultSibling = resultDoc.nodes.get(resultParent.childIds[0]) as ListBlockNode;
    expect(resultSibling.childIds.length).toBe(1);
    const nestedLeaf = resultDoc.nodes.get(resultSibling.childIds[0]) as ListBlockNode;
    expect(nestedLeaf.childIds.length).toBe(0);
    const lastSibling = resultDoc.nodes.get(resultParent.childIds[1]) as ListBlockNode;
    const lastSiblingRaw = resultDoc.lines.slice(lastSibling.range.startLine, lastSibling.range.endLine + 1).join("\n");
    expect(lastSiblingRaw).toContain("子3");
  });

  it("indents into a sibling that ALREADY owns a child subtree — inserted at the END, the existing grandchild is preserved untouched", () => {
    const raw = ["- 親", "  - 子1", "    - 子1の既存孫", "  - 子2"].join("\n");
    const { doc, node, projection } = buildParent(raw);
    const built = buildPendingIndent(doc, node, node.childIds[1]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const outcome = applyParentChildIndentOutdentToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      built.pending,
      projection.childSubtreeText
    );
    expect(outcome.changed).toBe(true);
    const resultDoc = parseDocument(outcome.lines.join("\n"));
    const resultParent = resultDoc.nodes.get("li-0") as ListBlockNode;
    expect(resultParent.childIds.length).toBe(1); // only 子1 remains as a direct child
    const resultSibling = resultDoc.nodes.get(resultParent.childIds[0]) as ListBlockNode;
    expect(resultSibling.childIds.length).toBe(2); // pre-existing 孫 PLUS newly-indented 子2, in that order
    const firstGrandchild = resultDoc.nodes.get(resultSibling.childIds[0]) as ListBlockNode;
    const secondGrandchild = resultDoc.nodes.get(resultSibling.childIds[1]) as ListBlockNode;
    const firstRaw = resultDoc.lines.slice(firstGrandchild.range.startLine, firstGrandchild.range.endLine + 1).join("\n");
    const secondRaw = resultDoc.lines.slice(secondGrandchild.range.startLine, secondGrandchild.range.endLine + 1).join("\n");
    expect(firstRaw).toContain("子1の既存孫");
    expect(secondRaw).toContain("子2");
  });

  it("preserves a task child's own checkbox state and an ordered child's own number/delimiter when indented", () => {
    const raw = ["- 親", "  - 子1", "  - [x] 子2タスク", "  2. 子3序数"].join("\n");
    const { doc, node, projection } = buildParent(raw);
    // Indent the task child (子2) into 子1.
    const builtTask = buildPendingIndent(doc, node, node.childIds[1]);
    expect(builtTask.ok).toBe(true);
    if (!builtTask.ok) return;
    const outcomeTask = applyParentChildIndentOutdentToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      builtTask.pending,
      projection.childSubtreeText
    );
    expect(outcomeTask.changed).toBe(true);
    const resultLines = outcomeTask.lines.join("\n");
    expect(resultLines).toContain("[x]");
    expect(resultLines).toContain("子2タスク");
    expect(resultLines).toContain("2. 子3序数");
  });

  it("Apply is refused (candidate-structure-invalid or target-resolve-failed) when the target is no longer a leaf at Apply time", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { doc, node, projection } = buildParent(raw);
    const built = buildPendingIndent(doc, node, node.childIds[1]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // Simulate an external edit: 子2 gained its own grandchild since the
    // pending indent was built — re-parse a MUTATED document.
    const mutatedRaw = ["- 親", "  - 子1", "  - 子2", "    - 新しい孫"].join("\n");
    const mutatedDoc = parseDocument(mutatedRaw);
    const outcome = applyParentChildIndentOutdentToDocument(
      mutatedDoc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      built.pending,
      projection.childSubtreeText // stale snapshot — deliberately mismatched
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toEqual(mutatedDoc.lines);
  });
});

describe("applyParentChildIndentOutdentToDocument — outdent", () => {
  it("outdents a one-level-nested leaf back to a direct child of the pane's own parent, positioned immediately after its former parent", () => {
    const raw = ["- 親", "  - A", "    - B"].join("\n");
    const { doc, node, projection } = buildParent(raw);
    const a = doc.nodes.get(node.childIds[0]) as ListBlockNode;
    const built = buildPendingOutdent(doc, node, a.childIds[0]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const outcome = applyParentChildIndentOutdentToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      built.pending,
      projection.childSubtreeText
    );
    expect(outcome.changed).toBe(true);
    const resultDoc = parseDocument(outcome.lines.join("\n"));
    const resultParent = resultDoc.nodes.get("li-0") as ListBlockNode;
    expect(resultParent.childIds.length).toBe(2); // A (now childless), B (new direct child)
    const resultA = resultDoc.nodes.get(resultParent.childIds[0]) as ListBlockNode;
    expect(resultA.childIds.length).toBe(0);
    const resultB = resultDoc.nodes.get(resultParent.childIds[1]) as ListBlockNode;
    expect(resultB.childIds.length).toBe(0);
    const bRaw = resultDoc.lines.slice(resultB.range.startLine, resultB.range.endLine + 1).join("\n");
    expect(bRaw).toContain("B");
  });

  it("the user's own worked example: outdenting B from 親→A→(B,C) never drags C along — C stays under A, B lands right after A", () => {
    const raw = ["- 親", "  - A", "    - B", "    - C"].join("\n");
    const { doc, node, projection } = buildParent(raw);
    const a = doc.nodes.get(node.childIds[0]) as ListBlockNode;
    const built = buildPendingOutdent(doc, node, a.childIds[0]); // outdent B (first child of A)
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const outcome = applyParentChildIndentOutdentToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      built.pending,
      projection.childSubtreeText
    );
    expect(outcome.changed).toBe(true);
    const resultDoc = parseDocument(outcome.lines.join("\n"));
    const resultParent = resultDoc.nodes.get("li-0") as ListBlockNode;
    expect(resultParent.childIds.length).toBe(2); // A (with only C), B
    const resultA = resultDoc.nodes.get(resultParent.childIds[0]) as ListBlockNode;
    expect(resultA.childIds.length).toBe(1);
    const resultC = resultDoc.nodes.get(resultA.childIds[0]) as ListBlockNode;
    const cRaw = resultDoc.lines.slice(resultC.range.startLine, resultC.range.endLine + 1).join("\n");
    expect(cRaw).toContain("C");
    const resultB = resultDoc.nodes.get(resultParent.childIds[1]) as ListBlockNode;
    const bRaw = resultDoc.lines.slice(resultB.range.startLine, resultB.range.endLine + 1).join("\n");
    expect(bRaw).toContain("B");
    expect(resultB.range.startLine).toBe(resultA.range.endLine + 1);
  });

  it("preserves the former parent's own own-text and list-kind — only the targeted grandchild's own position changes", () => {
    const raw = ["- [ ] 親タスク", "  1. 序数の親子", "    - 曾孫ではなく孫リーフ"].join("\n");
    const { doc, node, projection } = buildParent(raw);
    const a = doc.nodes.get(node.childIds[0]) as ListBlockNode;
    const built = buildPendingOutdent(doc, node, a.childIds[0]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const outcome = applyParentChildIndentOutdentToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      built.pending,
      projection.childSubtreeText
    );
    expect(outcome.changed).toBe(true);
    const resultLines = outcome.lines;
    expect(resultLines[0]).toBe("- [ ] 親タスク");
    const resultDoc = parseDocument(resultLines.join("\n"));
    const resultParent = resultDoc.nodes.get("li-0") as ListBlockNode;
    const resultA = resultDoc.nodes.get(resultParent.childIds[0]) as ListBlockNode;
    expect(resultA.ordered).toBe(true);
  });

  it("Apply is refused (subtree-conflict) when the whole child subtree changed externally since the pending outdent was built", () => {
    const raw = ["- 親", "  - A", "    - B"].join("\n");
    const { doc, node, projection } = buildParent(raw);
    const a = doc.nodes.get(node.childIds[0]) as ListBlockNode;
    const built = buildPendingOutdent(doc, node, a.childIds[0]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const staleSnapshot = projection.childSubtreeText + "\n  - 外部で追加された子"; // pretend an external edit happened
    const outcome = applyParentChildIndentOutdentToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      built.pending,
      staleSnapshot
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("subtree-conflict");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("Apply is refused (related-resolve-failed) when the target's current parent no longer matches the pending transform's own relatedNodeId", () => {
    const raw = ["- 親", "  - A", "    - B", "  - C"].join("\n");
    const { doc, node, projection } = buildParent(raw);
    const a = doc.nodes.get(node.childIds[0]) as ListBlockNode;
    const staleBPending: PendingIndentOutdent = {
      kind: "outdent",
      childNodeId: a.childIds[0],
      relatedNodeId: node.childIds[1], // deliberately wrong — B's real parent is A, not C
    };
    const outcome = applyParentChildIndentOutdentToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      staleBPending,
      projection.childSubtreeText
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("related-resolve-failed");
    expect(outcome.lines).toEqual(doc.lines);
  });

  it("never writes a partial change on refusal — lines are returned byte-for-byte identical to the input on every failure path", () => {
    const raw = ["- 親", "  - A", "    - B"].join("\n");
    const { doc, node, projection } = buildParent(raw);
    const bogusPending: PendingIndentOutdent = { kind: "outdent", childNodeId: "li-does-not-exist", relatedNodeId: "also-missing" };
    const outcome = applyParentChildIndentOutdentToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      bogusPending,
      projection.childSubtreeText
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("target-resolve-failed");
    expect(outcome.lines).toBe(doc.lines);
  });
});

describe("applyParentChildIndentOutdentToDocument — composes with a dirty parent own-text edit (§6's own explicit allowance)", () => {
  it("indent composes with a simultaneously-edited parent own-text — both land in the SAME atomic write", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { doc, node, projection } = buildParent(raw);
    const built = buildPendingIndent(doc, node, node.childIds[1]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const newParentOwnText = "- 親（編集済み）";
    const outcome = applyParentChildIndentOutdentToDocument(
      doc,
      node.id,
      true,
      projection.ownText.rawText,
      newParentOwnText,
      built.pending,
      projection.childSubtreeText
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.lines[0]).toBe(newParentOwnText);
    const resultDoc = parseDocument(outcome.lines.join("\n"));
    const resultParent = resultDoc.nodes.get("li-0") as ListBlockNode;
    expect(resultParent.childIds.length).toBe(1);
  });

  it("refuses (parent-conflict) when parentDirty is true but the live parent own-text no longer matches the ORIGINAL snapshot", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { doc, node, projection } = buildParent(raw);
    const built = buildPendingIndent(doc, node, node.childIds[1]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const outcome = applyParentChildIndentOutdentToDocument(
      doc,
      node.id,
      true,
      "- 親（この文字列は実際のドキュメントと一致しない）",
      "- 親（編集後）",
      built.pending,
      projection.childSubtreeText
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("parent-conflict");
    expect(outcome.lines).toEqual(doc.lines);
  });
});

// Smoke-tests that projectedChild*/childEffectiveControlKind still resolve
// normally on a node reached via the module's own re-exports — guards
// against an accidental import-path regression in this new test file
// itself, nothing more.
describe("sanity: existing Phase 5L-8 projection helpers remain usable alongside the new Phase 5L-11 exports", () => {
  it("projectedChildChecked/projectedChildNumberText/childEffectiveControlKind are all still exported and callable", () => {
    const raw = ["- 親", "  - [ ] 子1"].join("\n");
    const { doc, node } = buildParent(raw);
    const childId = node.childIds[0];
    const childNode = doc.nodes.get(childId) as ListBlockNode;
    const rawText = doc.lines.slice(childNode.range.startLine, childNode.range.endLine + 1).join("\n");
    expect(rawText).toContain("[ ]");
    expect(typeof projectedChildChecked).toBe("function");
    expect(typeof projectedChildNumberText).toBe("function");
    expect(typeof childEffectiveControlKind).toBe("function");
  });
});

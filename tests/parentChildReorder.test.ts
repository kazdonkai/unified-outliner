/**
 * Phase 5L-10 ("Direct Child Leaf Reorder in Parent Partial Edit Pane"):
 * real-pipeline tests for edit/parentChildInlineEditSession.ts's own Phase
 * 5L-10 section (evaluateChildReorderEligibility, isChildSubtreeTightlyPacked,
 * moveChildInPendingReorder, buildParentChildAddDeleteSession's own
 * pendingReorderOrder/reorderAvailable fields, isPendingReorderDirty, the
 * reorderDirty branch of invertAndValidateParentChildAddDeleteEdit, and the
 * reorder branch of applyParentChildAddDeleteToDocument) — mirrors
 * tests/parentChildAddDelete.test.ts's own house style (real parseDocument,
 * never a hand-built fake ParsedDocument), in isolation from the Partial
 * Edit Pane's own View-layer wiring (covered separately in
 * tests/parentChildAddDeleteUiWiring.test.ts).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode, ListBlockNode } from "../src/model/block";
import {
  buildParentListItemProjection,
  ParentListItemProjection,
  projectedParentBodyText,
} from "../src/edit/parentListItemProjection";
import {
  buildParentChildInlineEditSession,
  ParentChildInlineEditSession,
  projectedChildBodyText,
} from "../src/edit/parentChildInlineEditSession";
import {
  ParentChildAddDeleteSession,
  applyParentChildAddDeleteToDocument,
  buildNewChildDraft,
  buildParentChildAddDeleteSession,
  evaluateChildReorderEligibility,
  invertAndValidateParentChildAddDeleteEdit,
  InvertParentChildAddDeleteEditInput,
  isChildSubtreeTightlyPacked,
  isPendingReorderDirty,
  moveChildInPendingReorder,
} from "../src/edit/parentChildInlineEditSession";

function buildParent(raw: string, nodeId = "li-0") {
  const d = parseDocument(raw);
  const n = d.nodes.get(nodeId);
  if (!n || !isListNode(n)) throw new Error(`fixture setup error: ${nodeId} not a list node`);
  const built = buildParentListItemProjection(d, n);
  if (!built.ok) throw new Error(`fixture setup error: parent build failed with reason ${built.reason}`);
  return { doc: d, node: n, projection: built.projection };
}

function buildAddDeleteSession(raw: string, parentNodeId = "li-0") {
  const { doc, node, projection } = buildParent(raw, parentNodeId);
  const session = buildParentChildAddDeleteSession(doc, node, projection);
  return { doc, node, projection, session };
}

function buildExistingChildSession(raw: string, childNodeId: string, parentNodeId = "li-0") {
  const { doc, node, projection } = buildParent(raw, parentNodeId);
  const built = buildParentChildInlineEditSession(doc, node, projection, childNodeId);
  if (!built.ok) throw new Error(`fixture setup error: existing-child session build failed with reason ${built.reason}`);
  return { doc, node, projection, session: built.session };
}

function baseInput(
  projection: ParentListItemProjection,
  addDeleteSession: ParentChildAddDeleteSession,
  existingChildSession: ParentChildInlineEditSession | null = null
): InvertParentChildAddDeleteEditInput {
  return {
    parentProjection: projection,
    addDeleteSession,
    existingChildSession,
    parentDirty: false,
    existingChildDirty: false,
    newChildDirty: false,
    reorderDirty: false,
    editedParentChecked: false,
    editedParentNumberText: "",
    editedParentBody: projectedParentBodyText(projection),
    editedExistingChildChecked: false,
    editedExistingChildNumberText: "",
    editedExistingChildBody: existingChildSession ? projectedChildBodyText(existingChildSession.childProjection) : "",
    editedNewChildBody: addDeleteSession.newChildDraft ? projectedChildBodyText(addDeleteSession.newChildDraft.projection) : "",
  };
}

describe("evaluateChildReorderEligibility", () => {
  it("is an ALIAS of evaluateChildInlineEditEligibility — accepts unordered/task/ordered leaf direct children alike", () => {
    const raw = ["- 親", "  - 子1", "  - [ ] 子2", "  1. 子3"].join("\n");
    const d = parseDocument(raw);
    const parent = d.nodes.get("li-0") as ListBlockNode;
    for (const childId of parent.childIds) {
      expect(evaluateChildReorderEligibility(d, parent, childId).ok).toBe(true);
    }
  });

  it("refuses a grandchild-bearing child — no reorder affordance for a child-parent item", () => {
    const raw = ["- 親", "  - 子1", "    - 孫1"].join("\n");
    const d = parseDocument(raw);
    const parent = d.nodes.get("li-0") as ListBlockNode;
    const result = evaluateChildReorderEligibility(d, parent, parent.childIds[0]);
    expect(result).toEqual({ ok: false, reason: "child-has-children" });
  });
});

describe("isChildSubtreeTightlyPacked / reorderAvailable", () => {
  it("is tightly packed (reorderAvailable: true) for a contiguous 3-child list with no gaps", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { session } = buildAddDeleteSession(raw);
    expect(session.reorderAvailable).toBe(true);
  });

  it("is vacuously tightly packed for zero children (pure function, direct call)", () => {
    expect(isChildSubtreeTightlyPacked([], 0)).toBe(true);
  });

  it("is NOT tightly packed when a blank gap line sits between two direct children (reorderAvailable: false)", () => {
    const raw = ["- 親", "  - 子1", "", "  - 子2"].join("\n");
    const { session, projection } = buildAddDeleteSession(raw);
    expect(session.childSlots.length).toBe(2);
    expect(projection.childSubtreeText).toBe("  - 子1\n\n  - 子2");
    expect(session.reorderAvailable).toBe(false);
  });

  it("stays tightly packed when a child owns its own grandchild subtree — the gate is about gaps between DIRECT children, not leaf-ness", () => {
    const raw = ["- 親", "  - 子1", "    - 孫1", "  - 子2"].join("\n");
    const { session } = buildAddDeleteSession(raw);
    expect(session.reorderAvailable).toBe(true);
  });

  it("buildParentChildAddDeleteSession initializes pendingReorderOrder to childSlots' own identity order", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { session } = buildAddDeleteSession(raw);
    expect(session.pendingReorderOrder).toEqual(session.childSlots.map((s) => s.nodeId));
  });
});

describe("isPendingReorderDirty", () => {
  it("is false right after building a session (pendingReorderOrder === identity order)", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { session } = buildAddDeleteSession(raw);
    expect(isPendingReorderDirty(session)).toBe(false);
  });

  it("is true after a single swap", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { node, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[0], "down");
    expect(move.ok).toBe(true);
    if (move.ok) session.pendingReorderOrder = move.newOrder;
    expect(isPendingReorderDirty(session)).toBe(true);
  });

  it("is false again after a net-no-op sequence (swap down then swap back up) — never a sticky 'has any move ever happened' flag", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { node, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const down = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[0], "down");
    expect(down.ok).toBe(true);
    if (down.ok) session.pendingReorderOrder = down.newOrder;
    const up = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[0], "up");
    expect(up.ok).toBe(true);
    if (up.ok) session.pendingReorderOrder = up.newOrder;
    expect(session.pendingReorderOrder).toEqual(node.childIds);
    expect(isPendingReorderDirty(session)).toBe(false);
  });
});

describe("moveChildInPendingReorder", () => {
  it("swaps a middle child up with its preceding neighbor", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { node, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[1], "up");
    expect(move).toEqual({ ok: true, newOrder: [node.childIds[1], node.childIds[0], node.childIds[2]] });
  });

  it("swaps a middle child down with its following neighbor", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { node, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[1], "down");
    expect(move).toEqual({ ok: true, newOrder: [node.childIds[0], node.childIds[2], node.childIds[1]] });
  });

  it("refuses 'up' for the first child (at-boundary) — never wraps around", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { node, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[0], "up");
    expect(move).toEqual({ ok: false, reason: "at-boundary" });
  });

  it("refuses 'down' for the last child (at-boundary)", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { node, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[1], "down");
    expect(move).toEqual({ ok: false, reason: "at-boundary" });
  });

  it("refuses a childNodeId not present in currentOrder at all (not-in-order) — defensive-only path", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { node, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, "li-does-not-exist", "down");
    expect(move).toEqual({ ok: false, reason: "not-in-order" });
  });

  it("refuses when childNodeId itself is not eligible (not-eligible)", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { node, session } = buildAddDeleteSession(raw);
    const eligible = new Set([node.childIds[1]]); // 子1 deliberately excluded
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[0], "down");
    expect(move).toEqual({ ok: false, reason: "not-eligible" });
  });

  it("refuses when childNodeId is the current pending-deletion target (not-eligible via excludedChildNodeId)", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { node, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, node.childIds[0], node.childIds[0], "down");
    expect(move).toEqual({ ok: false, reason: "not-eligible" });
  });

  it("never crosses a non-eligible (grandchild-bearing) neighbor — neighbor-not-eligible, no displacement", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "    - 孫2a", "  - 子3"].join("\n");
    const d = parseDocument(raw);
    const parent = d.nodes.get("li-0") as ListBlockNode;
    const eligible = new Set<string>();
    for (const id of parent.childIds) {
      if (evaluateChildReorderEligibility(d, parent, id).ok) eligible.add(id);
    }
    // 子2 (the middle child) owns a grandchild and is excluded from `eligible`.
    expect(eligible.has(parent.childIds[1])).toBe(false);
    const moveDown = moveChildInPendingReorder(parent.childIds, eligible, null, parent.childIds[0], "down");
    expect(moveDown).toEqual({ ok: false, reason: "neighbor-not-eligible" });
    const moveUp = moveChildInPendingReorder(parent.childIds, eligible, null, parent.childIds[2], "up");
    expect(moveUp).toEqual({ ok: false, reason: "neighbor-not-eligible" });
  });

  it("never crosses the current pending-deletion target even though it is itself eligible and still occupies a slot", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { node, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    // 子2 (index 1) is marked pending-deletion — 子1 (index 0) tries to move down onto it.
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, node.childIds[1], node.childIds[0], "down");
    expect(move).toEqual({ ok: false, reason: "neighbor-not-eligible" });
  });

  it("composes multiple sequential up/down calls into one final order (moving 子1 to the very end via two 'down' calls)", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { node, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    let order = session.pendingReorderOrder;
    const first = moveChildInPendingReorder(order, eligible, null, node.childIds[0], "down");
    expect(first.ok).toBe(true);
    if (first.ok) order = first.newOrder;
    expect(order).toEqual([node.childIds[1], node.childIds[0], node.childIds[2]]);
    const second = moveChildInPendingReorder(order, eligible, null, node.childIds[0], "down");
    expect(second.ok).toBe(true);
    if (second.ok) order = second.newOrder;
    expect(order).toEqual([node.childIds[1], node.childIds[2], node.childIds[0]]);
  });
});

describe("invertAndValidateParentChildAddDeleteEdit — reorder scenarios", () => {
  it("reorder-only: a valid pending swap on a tightly-packed subtree validates cleanly (parent/child bodies untouched)", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { node, projection, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[1], "up");
    expect(move.ok).toBe(true);
    if (move.ok) session.pendingReorderOrder = move.newOrder;
    const input = baseInput(projection, session);
    input.reorderDirty = true;
    const result = invertAndValidateParentChildAddDeleteEdit(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parentOwnTextRawText).toBe("- 親");
    expect(result.existingChildRawText).toBeNull();
    expect(result.newChildRawText).toBeNull();
  });

  it("is refused (reorder-not-available) when the child subtree is not tightly packed, even with a 'valid-looking' pending order", () => {
    const raw = ["- 親", "  - 子1", "", "  - 子2"].join("\n");
    const { projection, session } = buildAddDeleteSession(raw);
    expect(session.reorderAvailable).toBe(false);
    session.pendingReorderOrder = [session.childSlots[1].nodeId, session.childSlots[0].nodeId];
    const input = baseInput(projection, session);
    input.reorderDirty = true;
    const result = invertAndValidateParentChildAddDeleteEdit(input);
    expect(result).toEqual({ ok: false, reason: "reorder-not-available" });
  });

  it("is refused (reorder-target-missing) when pendingReorderOrder references an id no longer in childSlots (stale/corrupted session)", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { projection, session } = buildAddDeleteSession(raw);
    session.pendingReorderOrder = [session.childSlots[0].nodeId, "li-does-not-exist"];
    const input = baseInput(projection, session);
    input.reorderDirty = true;
    const result = invertAndValidateParentChildAddDeleteEdit(input);
    expect(result).toEqual({ ok: false, reason: "reorder-target-missing" });
  });

  it("reorder + parent-body-edit together validate as one combined candidate", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { node, projection, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[0], "down");
    expect(move.ok).toBe(true);
    if (move.ok) session.pendingReorderOrder = move.newOrder;
    const input = baseInput(projection, session);
    input.reorderDirty = true;
    input.parentDirty = true;
    input.editedParentBody = "親（編集済み）";
    const result = invertAndValidateParentChildAddDeleteEdit(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parentOwnTextRawText).toBe("- 親（編集済み）");
  });

  it("reorder + existing-child-body-edit together validate as one combined candidate, substituting the edited body at the child's new position", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { doc, node, projection, session: addDeleteSession } = buildAddDeleteSession(raw);
    const existing = buildExistingChildSession(raw, node.childIds[0]);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(addDeleteSession.pendingReorderOrder, eligible, null, node.childIds[0], "down");
    expect(move.ok).toBe(true);
    if (move.ok) addDeleteSession.pendingReorderOrder = move.newOrder;
    const input = baseInput(existing.projection, addDeleteSession, existing.session);
    input.reorderDirty = true;
    input.existingChildDirty = true;
    input.editedExistingChildBody = "子1（編集済み）";
    const result = invertAndValidateParentChildAddDeleteEdit(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.existingChildRawText).toBe("  - 子1（編集済み）");
    void doc;
  });

  it("reorder + new-child-add together validate, with the new child still appended at the very end regardless of pending order", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { doc, node, projection, session } = buildAddDeleteSession(raw);
    const built = buildNewChildDraft(doc, node);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    session.newChildDraft = built.draft;
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[0], "down");
    expect(move.ok).toBe(true);
    if (move.ok) session.pendingReorderOrder = move.newOrder;
    const input = baseInput(projection, session);
    input.reorderDirty = true;
    input.newChildDirty = true;
    input.editedNewChildBody = "新しい子";
    const result = invertAndValidateParentChildAddDeleteEdit(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newChildRawText).toBe("  - 新しい子");
  });

  it("reorder + deletion together validate, with the deletion target excluded from the reconstructed subtree", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { node, projection, session } = buildAddDeleteSession(raw);
    session.pendingDeletion = { childNodeId: node.childIds[1], childIndex: 1 };
    session.pendingReorderOrder = [node.childIds[2], node.childIds[1], node.childIds[0]];
    const input = baseInput(projection, session);
    input.reorderDirty = true;
    const result = invertAndValidateParentChildAddDeleteEdit(input);
    expect(result.ok).toBe(true);
  });
});

describe("applyParentChildAddDeleteToDocument — reorder live-apply", () => {
  it("reorder-only: rewrites the child subtree in the new order as ONE atomic write, leaving the parent's own text untouched", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { doc, node, projection, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[0], "down");
    expect(move.ok).toBe(true);
    if (move.ok) session.pendingReorderOrder = move.newOrder;
    const outcome = applyParentChildAddDeleteToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      null,
      null,
      null,
      { orderedChildNodeIds: session.pendingReorderOrder, originalChildSubtreeText: projection.childSubtreeText }
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- 親", "  - 子2", "  - 子1", "  - 子3"]);
  });

  it("preserves each child's indentation/depth and a grandchild subtree's own contents verbatim through a reorder of its ELIGIBLE siblings", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "    - 孫2a", "  - 子3"].join("\n");
    const d = parseDocument(raw);
    const parent = d.nodes.get("li-0") as ListBlockNode;
    const built = buildParentListItemProjection(d, parent);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const session = buildParentChildAddDeleteSession(d, parent, built.projection);
    const eligible = new Set<string>();
    for (const id of parent.childIds) {
      if (evaluateChildReorderEligibility(d, parent, id).ok) eligible.add(id);
    }
    // 子2 (grandchild-bearing) sits between the two eligible leaves and is
    // never itself moved — 子1/子3 cannot swap past it (see
    // moveChildInPendingReorder's own "never crosses a non-eligible
    // neighbor" test above), so this reorder is not reachable via the
    // pure swap function; it IS still worth confirming the live-apply
    // primitive itself leaves 子2's own grandchild subtree byte-for-byte
    // untouched when only the surrounding order (here: unchanged, as a
    // baseline) is passed through.
    const outcome = applyParentChildAddDeleteToDocument(
      d,
      parent.id,
      false,
      built.projection.ownText.rawText,
      built.projection.ownText.rawText,
      null,
      null,
      null,
      { orderedChildNodeIds: session.pendingReorderOrder, originalChildSubtreeText: built.projection.childSubtreeText }
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- 親", "  - 子1", "  - 子2", "    - 孫2a", "  - 子3"]);
    void eligible;
  });

  it("reorder + parent-edit combined as one atomic write", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { doc, node, projection, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[0], "down");
    expect(move.ok).toBe(true);
    if (move.ok) session.pendingReorderOrder = move.newOrder;
    const outcome = applyParentChildAddDeleteToDocument(
      doc,
      node.id,
      true,
      projection.ownText.rawText,
      "- 親（編集）",
      null,
      null,
      null,
      { orderedChildNodeIds: session.pendingReorderOrder, originalChildSubtreeText: projection.childSubtreeText }
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- 親（編集）", "  - 子2", "  - 子1"]);
  });

  it("reorder + existing-child-edit combined — the edited body appears at the child's NEW position", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { doc, node, projection, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[0], "down");
    expect(move.ok).toBe(true);
    if (move.ok) session.pendingReorderOrder = move.newOrder;
    const outcome = applyParentChildAddDeleteToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      { childNodeId: node.childIds[0], dirty: true, originalRawText: session.childSlots[0].rawText, newRawText: "  - 子1（編集済み）" },
      null,
      null,
      { orderedChildNodeIds: session.pendingReorderOrder, originalChildSubtreeText: projection.childSubtreeText }
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- 親", "  - 子2", "  - 子1（編集済み）"]);
  });

  it("reorder + deletion combined — the deleted child is excluded from the rebuilt subtree, remaining siblings keep the pending order", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { doc, node, projection, session } = buildAddDeleteSession(raw);
    session.pendingDeletion = { childNodeId: node.childIds[1], childIndex: 1 };
    session.pendingReorderOrder = [node.childIds[2], node.childIds[1], node.childIds[0]];
    const outcome = applyParentChildAddDeleteToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      null,
      { childNodeId: node.childIds[1], originalRawText: session.childSlots[1].rawText },
      null,
      { orderedChildNodeIds: session.pendingReorderOrder, originalChildSubtreeText: projection.childSubtreeText }
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- 親", "  - 子3", "  - 子1"]);
  });

  it("ordered-list delimiter/number TEXT is never auto-renumbered by a reorder — only the sibling ORDER changes", () => {
    const raw = ["- 親", "  1. 子1", "  2. 子2", "  3. 子3"].join("\n");
    const { doc, node, projection, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[0], "down");
    expect(move.ok).toBe(true);
    if (move.ok) session.pendingReorderOrder = move.newOrder;
    const outcome = applyParentChildAddDeleteToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      null,
      null,
      null,
      { orderedChildNodeIds: session.pendingReorderOrder, originalChildSubtreeText: projection.childSubtreeText }
    );
    expect(outcome.changed).toBe(true);
    // 子1/子2 swapped POSITION, but each one's own original number-text
    // ("1." / "2.") travels WITH it verbatim — never renumbered to match
    // its new position (which would have produced "1. 子2"/"2. 子1").
    expect(outcome.lines).toEqual(["- 親", "  2. 子2", "  1. 子1", "  3. 子3"]);
  });

  it("rejects on a reorder-conflict when the live child subtree no longer matches the original snapshot, leaving the document untouched", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { node, projection, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[0], "down");
    expect(move.ok).toBe(true);
    if (move.ok) session.pendingReorderOrder = move.newOrder;
    const liveDoc = parseDocument(["- 親", "  - 子1（外部編集）", "  - 子2", "  - 子3"].join("\n"));
    const outcome = applyParentChildAddDeleteToDocument(
      liveDoc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      null,
      null,
      null,
      { orderedChildNodeIds: session.pendingReorderOrder, originalChildSubtreeText: projection.childSubtreeText }
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("reorder-conflict");
    expect(outcome.lines).toBe(liveDoc.lines);
  });

  it("rejects on reorder-target-resolve-failed when a reorder target gained a grandchild since the session was built, leaving the document untouched", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { node, projection, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[0], "down");
    expect(move.ok).toBe(true);
    if (move.ok) session.pendingReorderOrder = move.newOrder;
    // Simulate an external edit that gave 子1 its own grandchild since the
    // reorder plan was built — 子1's own subtree text/indentation grows,
    // so the childSubtreeText comparison for reorder-conflict would ALSO
    // fail, but resolve-failed is checked first and is the more specific
    // signal (see this function's own "reorder-target-resolve-failed"
    // doc comment for why it is checked ahead of any conflict check).
    const liveDoc = parseDocument(["- 親", "  - 子1", "    - 新しい孫", "  - 子2", "  - 子3"].join("\n"));
    const outcome = applyParentChildAddDeleteToDocument(
      liveDoc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      null,
      null,
      null,
      { orderedChildNodeIds: session.pendingReorderOrder, originalChildSubtreeText: projection.childSubtreeText }
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("reorder-target-resolve-failed");
    expect(outcome.lines).toBe(liveDoc.lines);
  });

  it("rejects when the parent id no longer resolves at all, even with a reorder pending (parent-resolve-failed, defensive)", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { doc, node, projection, session } = buildAddDeleteSession(raw);
    const eligible = new Set(node.childIds);
    const move = moveChildInPendingReorder(session.pendingReorderOrder, eligible, null, node.childIds[0], "down");
    expect(move.ok).toBe(true);
    if (move.ok) session.pendingReorderOrder = move.newOrder;
    const outcome = applyParentChildAddDeleteToDocument(
      doc,
      "li-does-not-exist",
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      null,
      null,
      null,
      { orderedChildNodeIds: session.pendingReorderOrder, originalChildSubtreeText: projection.childSubtreeText }
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("parent-resolve-failed");
    expect(outcome.lines).toBe(doc.lines);
  });
});

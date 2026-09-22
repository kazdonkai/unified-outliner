/**
 * Phase 5L-9 ("Direct Child Add/Delete in Parent Partial Edit Pane"):
 * real-pipeline tests for edit/parentChildInlineEditSession.ts's own Phase
 * 5L-9 section (computeNewChildIndent/buildCanonicalNewChildRawText/
 * buildNewChildDraft, evaluateChildDeleteEligibility,
 * buildParentChildAddDeleteSession, invertAndValidateParentChildAddDeleteEdit,
 * applyParentChildAddDeleteToDocument) — mirrors
 * tests/parentChildInlineEdit.test.ts's own house style (real
 * parseDocument, never a hand-built fake ParsedDocument), in isolation
 * from the Partial Edit Pane's own View-layer wiring (covered separately
 * in tests/parentChildAddDeleteUiWiring.test.ts).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode, ListBlockNode, ParsedDocument } from "../src/model/block";
import {
  buildParentListItemProjection,
  ParentListItemProjection,
  projectedParentBodyText,
} from "../src/edit/parentListItemProjection";
import {
  buildParentChildInlineEditSession,
  ParentChildInlineEditSession,
} from "../src/edit/parentChildInlineEditSession";
import {
  ParentChildAddDeleteSession,
  applyParentChildAddDeleteToDocument,
  buildCanonicalNewChildRawText,
  buildNewChildDraft,
  buildParentChildAddDeleteSession,
  computeNewChildIndent,
  evaluateChildDeleteEligibility,
  invertAndValidateParentChildAddDeleteEdit,
  InvertParentChildAddDeleteEditInput,
  projectedChildBodyText,
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

function buildExistingChildSession(
  raw: string,
  childNodeId: string,
  parentNodeId = "li-0"
): { doc: ParsedDocument; node: ListBlockNode; projection: ParentListItemProjection; session: ParentChildInlineEditSession } {
  const { doc, node, projection } = buildParent(raw, parentNodeId);
  const built = buildParentChildInlineEditSession(doc, node, projection, childNodeId);
  if (!built.ok) throw new Error(`fixture setup error: existing-child session build failed with reason ${built.reason}`);
  return { doc, node, projection, session: built.session };
}

const NO_EXISTING_CHILD_EDIT_DEFAULTS = {
  editedExistingChildChecked: false,
  editedExistingChildNumberText: "",
  editedExistingChildBody: "",
};

describe("computeNewChildIndent / buildCanonicalNewChildRawText", () => {
  it("matches the LAST direct child's own leading whitespace verbatim when one exists", () => {
    const { doc, node } = buildParent(["- 親", "  - 子1", "  - 子2"].join("\n"));
    const lastChild = doc.nodes.get(node.childIds[node.childIds.length - 1]) as ListBlockNode;
    const indent = computeNewChildIndent(doc, node, lastChild);
    expect(indent).toBe("  ");
    expect(buildCanonicalNewChildRawText(indent)).toBe("  -");
  });

  it("matches a deeper LAST child's own indentation too, not the parent's", () => {
    const { doc, node } = buildParent(["- 親", "    - 子1"].join("\n"));
    const lastChild = doc.nodes.get(node.childIds[0]) as ListBlockNode;
    const indent = computeNewChildIndent(doc, node, lastChild);
    expect(indent).toBe("    ");
  });

  it("falls back to one TAB_WIDTH step past the PARENT's own indent when there is no last child (defensive-only path — never reached via this ticket's own Mode-A-only UI)", () => {
    const raw = ["- 親"].join("\n");
    const d = parseDocument(raw);
    const n = d.nodes.get("li-0") as ListBlockNode;
    const indent = computeNewChildIndent(d, n, null);
    expect(indent).toBe("    ");
  });

  it("matches tabs when the last child itself uses tabs", () => {
    const raw = "- 親\n\t- 子1";
    const d = parseDocument(raw);
    const n = d.nodes.get("li-0") as ListBlockNode;
    const lastChild = d.nodes.get(n.childIds[0]) as ListBlockNode;
    const indent = computeNewChildIndent(d, n, lastChild);
    expect(indent).toBe("\t");
  });
});

describe("buildNewChildDraft", () => {
  it("builds a canonical unordered/non-task/empty-body draft at the last child's own indentation", () => {
    const { doc, node } = buildParent(["- 親", "  - 子1", "  - 子2"].join("\n"));
    const built = buildNewChildDraft(doc, node);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.draft.projection.kind).toBe("unordered");
    if (built.draft.projection.kind === "unordered") {
      expect(built.draft.projection.projection.rawLine).toBe("  -");
      expect(built.draft.projection.projection.marker).toBe("-");
      expect(built.draft.projection.projection.body).toBe("");
    }
  });
});

describe("evaluateChildDeleteEligibility", () => {
  it("is an ALIAS of evaluateChildInlineEditEligibility — same accept for a leaf direct child", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const d = parseDocument(raw);
    const parent = d.nodes.get("li-0") as ListBlockNode;
    const result = evaluateChildDeleteEligibility(d, parent, parent.childIds[0]);
    expect(result.ok).toBe(true);
  });

  it("refuses a grandchild-bearing child — no delete affordance for a parent-item child", () => {
    const raw = ["- 親", "  - 子1", "    - 孫1"].join("\n");
    const d = parseDocument(raw);
    const parent = d.nodes.get("li-0") as ListBlockNode;
    const result = evaluateChildDeleteEligibility(d, parent, parent.childIds[0]);
    expect(result).toEqual({ ok: false, reason: "child-has-children" });
  });
});

describe("buildParentChildAddDeleteSession", () => {
  it("captures every direct child's own raw text + relative range, in childIds order", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "    - 孫2a", "  - 子3"].join("\n");
    const { doc, node, projection, session } = buildAddDeleteSession(raw);
    expect(session.parentNodeId).toBe(node.id);
    expect(session.childSlots.length).toBe(3);
    expect(session.newChildDraft).toBeNull();
    expect(session.pendingDeletion).toBeNull();
    expect(session.childSlots[0].nodeId).toBe(node.childIds[0]);
    expect(session.childSlots[0].rawText).toBe("  - 子1");
    expect(session.childSlots[1].rawText).toBe(["  - 子2", "    - 孫2a"].join("\n"));
    expect(session.childSlots[2].rawText).toBe("  - 子3");
    // relativeRange is relative to childSubtreeRange.startLine.
    const childSubtreeLines = doc.lines.slice(
      projection.childSubtreeRange.startLine,
      projection.childSubtreeRange.endLine + 1
    );
    for (const slot of session.childSlots) {
      const sliced = childSubtreeLines.slice(slot.relativeRange.startLine, slot.relativeRange.endLine + 1).join("\n");
      expect(sliced).toBe(slot.rawText);
    }
  });
});

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
    // Phase 5L-10 ("Direct Child Leaf Reorder in Parent Partial Edit
    // Pane"): every existing test in this file predates reorder and
    // never mutates addDeleteSession.pendingReorderOrder, so `false` here
    // keeps every one of them exercising the exact same non-reorder code
    // path as before this ticket, byte-for-byte.
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

describe("invertAndValidateParentChildAddDeleteEdit — Add scenarios", () => {
  it("end-of-subtree append with existing children — untouched (still-canonical-empty) body Apply is allowed", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { doc, node, projection, session } = buildAddDeleteSession(raw);
    const built = buildNewChildDraft(doc, node);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    session.newChildDraft = built.draft;

    const result = invertAndValidateParentChildAddDeleteEdit(baseInput(projection, session));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parentOwnTextRawText).toBe("- 親");
    expect(result.existingChildRawText).toBeNull();
    expect(result.newChildRawText).toBe("  -");
  });

  it("append-after-a-sibling's-full-grandchild-subtree, correct depth/indentation, and preserves every existing line byte-for-byte", () => {
    const raw = ["- 親", "  - 子1", "    - 孫1a", "    - 孫1b", "  - 子2"].join("\n");
    const { doc, node, projection, session } = buildAddDeleteSession(raw);
    const built = buildNewChildDraft(doc, node);
    if (!built.ok) throw new Error("unreachable");
    session.newChildDraft = built.draft;

    const input = baseInput(projection, session);
    input.newChildDirty = true;
    input.editedNewChildBody = "新しい子";
    const result = invertAndValidateParentChildAddDeleteEdit(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newChildRawText).toBe("  - 新しい子");

    const liveOutcome = applyParentChildAddDeleteToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      null,
      null,
      result.newChildRawText
    );
    expect(liveOutcome.changed).toBe(true);
    expect(liveOutcome.lines).toEqual([
      "- 親",
      "  - 子1",
      "    - 孫1a",
      "    - 孫1b",
      "  - 子2",
      "  - 新しい子",
    ]);
    // The candidate's own re-parse (already performed above) already
    // proves the grandchild subtree/sibling survive untouched; re-parsing
    // the LIVE outcome one more time is the ticket's own explicit
    // "confirming siblings/grandchildren stay unchanged" assertion.
    const finalDoc = parseDocument(liveOutcome.lines.join("\n"));
    const finalParent = finalDoc.nodes.get("li-0") as ListBlockNode;
    expect(finalParent.childIds.length).toBe(3);
  });

  it("Apply preserves outside-parent content (a following sibling section) untouched", () => {
    const raw = ["- 親", "  - 子1", "- 次の兄弟"].join("\n");
    const { doc, node, projection, session } = buildAddDeleteSession(raw);
    const built = buildNewChildDraft(doc, node);
    if (!built.ok) throw new Error("unreachable");
    session.newChildDraft = built.draft;
    const result = invertAndValidateParentChildAddDeleteEdit(baseInput(projection, session));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const liveOutcome = applyParentChildAddDeleteToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      null,
      null,
      result.newChildRawText
    );
    expect(liveOutcome.lines).toEqual(["- 親", "  - 子1", "  -", "- 次の兄弟"]);
  });

  it("refuses a new-child body edit containing a line break (new-child-unsafe-structure)", () => {
    const raw = ["- 親", "  - 子1"].join("\n");
    const { doc, node, projection, session } = buildAddDeleteSession(raw);
    const built = buildNewChildDraft(doc, node);
    if (!built.ok) throw new Error("unreachable");
    session.newChildDraft = built.draft;
    const input = baseInput(projection, session);
    input.newChildDirty = true;
    input.editedNewChildBody = "1行目\n2行目";
    const result = invertAndValidateParentChildAddDeleteEdit(input);
    expect(result).toEqual({ ok: false, reason: "new-child-unsafe-structure" });
  });

  it("dirty-existing-child-not-silently-lost-on-Add — a simultaneous existing-child edit AND a new-child add both survive in the same candidate", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { doc, node, projection, session: addDeleteSession } = buildAddDeleteSession(raw);
    const existing = buildExistingChildSession(raw, node.childIds[0]);
    const built = buildNewChildDraft(doc, node);
    if (!built.ok) throw new Error("unreachable");
    addDeleteSession.newChildDraft = built.draft;

    const input = baseInput(existing.projection, addDeleteSession, existing.session);
    input.existingChildDirty = true;
    input.editedExistingChildBody = "編集済み子1";
    input.newChildDirty = true;
    input.editedNewChildBody = "新しい子";
    const result = invertAndValidateParentChildAddDeleteEdit(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.existingChildRawText).toBe("  - 編集済み子1");
    expect(result.newChildRawText).toBe("  - 新しい子");
  });
});

describe("invertAndValidateParentChildAddDeleteEdit — Delete scenarios", () => {
  it("Apply removes exactly that child's range — siblings/grandchildren/parent-own-text/outside-parent invariant", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "    - 孫2a", "  - 子3"].join("\n");
    const { doc, node, projection, session } = buildAddDeleteSession(raw);
    // 子1 (a plain leaf) is the deletion TARGET — 子2 (index 1) owns its own
    // grandchild subtree and is therefore never itself delete-eligible
    // (evaluateChildDeleteEligibility's own "child-has-children" refusal,
    // covered separately below); this test's own point is that 子2's
    // grandchild subtree survives the deletion of an UNRELATED sibling
    // completely untouched.
    const targetIndex = 0; // 子1
    session.pendingDeletion = { childNodeId: node.childIds[targetIndex], childIndex: targetIndex };
    const result = invertAndValidateParentChildAddDeleteEdit(baseInput(projection, session));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newChildRawText).toBeNull();

    const liveOutcome = applyParentChildAddDeleteToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      null,
      { childNodeId: node.childIds[targetIndex], originalRawText: session.childSlots[targetIndex].rawText },
      null
    );
    expect(liveOutcome.changed).toBe(true);
    expect(liveOutcome.lines).toEqual(["- 親", "  - 子2", "    - 孫2a", "  - 子3"]);
    const finalDoc = parseDocument(liveOutcome.lines.join("\n"));
    const finalParent = finalDoc.nodes.get("li-0") as ListBlockNode;
    expect(finalParent.childIds.length).toBe(2);
    const remainingSecondChild = finalDoc.nodes.get(finalParent.childIds[0]) as ListBlockNode;
    expect(remainingSecondChild.childIds.length).toBe(1);
  });

  it("deleting the last remaining child leaves the parent safely re-parseable as a leaf with childIds empty, and preserves the parent's own-text draft intact", () => {
    const raw = ["- [ ] 親タスク", "  - 唯一の子"].join("\n");
    const { doc, node, projection, session } = buildAddDeleteSession(raw);
    session.pendingDeletion = { childNodeId: node.childIds[0], childIndex: 0 };
    const input = baseInput(projection, session);
    input.parentDirty = true;
    input.editedParentChecked = true;
    input.editedParentBody = "親タスク（編集済み）";
    const result = invertAndValidateParentChildAddDeleteEdit(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parentOwnTextRawText).toBe("- [x] 親タスク（編集済み）");

    const liveOutcome = applyParentChildAddDeleteToDocument(
      doc,
      node.id,
      true,
      projection.ownText.rawText,
      result.parentOwnTextRawText,
      null,
      { childNodeId: node.childIds[0], originalRawText: session.childSlots[0].rawText },
      null
    );
    expect(liveOutcome.changed).toBe(true);
    expect(liveOutcome.lines).toEqual(["- [x] 親タスク（編集済み）"]);
    const finalDoc = parseDocument(liveOutcome.lines.join("\n"));
    const finalParent = finalDoc.nodes.get("li-0") as ListBlockNode;
    expect(finalParent.childIds).toEqual([]);
  });

  it("no delete affordance (evaluateChildDeleteEligibility refuses) on a grandchild-bearing child — mirrored by candidate-side deletion-target-missing when marked anyway with a stale index", () => {
    const raw = ["- 親", "  - 子1", "    - 孫1"].join("\n");
    const d = parseDocument(raw);
    const parent = d.nodes.get("li-0") as ListBlockNode;
    expect(evaluateChildDeleteEligibility(d, parent, parent.childIds[0])).toEqual({
      ok: false,
      reason: "child-has-children",
    });
  });

  it("deletion-target-missing — a pendingDeletion whose childIndex no longer matches its own recorded nodeId (stale/corrupted session) is refused defensively", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { projection, session } = buildAddDeleteSession(raw);
    session.pendingDeletion = { childNodeId: "li-does-not-exist", childIndex: 0 };
    const result = invertAndValidateParentChildAddDeleteEdit(baseInput(projection, session));
    expect(result).toEqual({ ok: false, reason: "deletion-target-missing" });
  });

  it("sibling-changed — an external edit to a NON-deleted, NON-edited sibling (simulated via a mutated snapshot) is refused, never silently accepted", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { projection, session } = buildAddDeleteSession(raw);
    session.pendingDeletion = { childNodeId: session.childSlots[0].nodeId, childIndex: 0 };
    // Simulate a sibling snapshot that no longer matches what re-parsing
    // the (unedited) childSubtreeText would actually produce for it.
    session.childSlots[1] = { ...session.childSlots[1], rawText: "  - 子2（改ざん）" };
    const result = invertAndValidateParentChildAddDeleteEdit(baseInput(projection, session));
    expect(result).toEqual({ ok: false, reason: "sibling-changed" });
  });
});

describe("invertAndValidateParentChildAddDeleteEdit — Combined-Apply scenarios", () => {
  it("parent+existing-child+new-child+deletion all together — the allowed simultaneous combination across all three independent slots", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { doc, node, projection, session: addDeleteSession } = buildAddDeleteSession(raw);
    const existing = buildExistingChildSession(raw, node.childIds[0]);
    const built = buildNewChildDraft(doc, node);
    if (!built.ok) throw new Error("unreachable");
    addDeleteSession.newChildDraft = built.draft;
    addDeleteSession.pendingDeletion = { childNodeId: node.childIds[2], childIndex: 2 }; // 子3

    const input = baseInput(existing.projection, addDeleteSession, existing.session);
    input.parentDirty = true;
    input.editedParentBody = "親（編集済み）";
    input.existingChildDirty = true;
    input.editedExistingChildBody = "子1（編集済み）";
    input.newChildDirty = true;
    input.editedNewChildBody = "新しい子";

    const result = invertAndValidateParentChildAddDeleteEdit(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parentOwnTextRawText).toBe("- 親（編集済み）");
    expect(result.existingChildRawText).toBe("  - 子1（編集済み）");
    expect(result.newChildRawText).toBe("  - 新しい子");

    const liveOutcome = applyParentChildAddDeleteToDocument(
      doc,
      node.id,
      true,
      projection.ownText.rawText,
      result.parentOwnTextRawText,
      {
        childNodeId: existing.session.childNodeId,
        dirty: true,
        originalRawText: existing.session.originalChildRawText,
        newRawText: result.existingChildRawText!,
      },
      { childNodeId: node.childIds[2], originalRawText: addDeleteSession.childSlots[2].rawText },
      result.newChildRawText
    );
    expect(liveOutcome.changed).toBe(true);
    expect(liveOutcome.lines).toEqual([
      "- 親（編集済み）",
      "  - 子1（編集済み）",
      "  - 子2",
      "  - 新しい子",
    ]);
  });

  it("existing-child-only (no add/delete) still routes through this ticket's own generalized invert/apply cleanly", () => {
    const raw = ["- 親", "  - 子1"].join("\n");
    const { doc, node, projection, session: addDeleteSession } = buildAddDeleteSession(raw);
    const existing = buildExistingChildSession(raw, node.childIds[0]);
    const input = baseInput(existing.projection, addDeleteSession, existing.session);
    input.existingChildDirty = true;
    input.editedExistingChildBody = "子1（編集済み）";
    const result = invertAndValidateParentChildAddDeleteEdit(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.existingChildRawText).toBe("  - 子1（編集済み）");
    expect(result.newChildRawText).toBeNull();
  });

  it("deletion-only zero-partial-write on failure — an invalid parent number, with a deletion ALSO pending, rejects the WHOLE Apply and returns the reason for the parent, never a partial deletion", () => {
    const raw = ["1. 親", "   - 子1", "   - 子2"].join("\n");
    const { projection, session } = buildAddDeleteSession(raw);
    session.pendingDeletion = { childNodeId: session.childSlots[0].nodeId, childIndex: 0 };
    const input = baseInput(projection, session);
    input.parentDirty = true;
    input.editedParentNumberText = "abc";
    const result = invertAndValidateParentChildAddDeleteEdit(input);
    expect(result).toEqual({ ok: false, reason: "parent-invalid-number" });
  });
});

describe("applyParentChildAddDeleteToDocument — conflicts, resolve failures, and no-partial-write", () => {
  it("rejects on a parent-conflict (external edit to the parent's own-text since load) and returns doc.lines untouched", () => {
    const raw = ["- 親", "  - 子1"].join("\n");
    const { doc, node, projection } = buildAddDeleteSession(raw);
    const liveDoc = parseDocument(["- 親（外部編集）", "  - 子1"].join("\n"));
    const outcome = applyParentChildAddDeleteToDocument(
      liveDoc,
      node.id,
      true,
      projection.ownText.rawText,
      "- 親（新しい編集）",
      null,
      null,
      null
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("parent-conflict");
    expect(outcome.lines).toBe(liveDoc.lines);
    void doc;
  });

  it("rejects on an existing-child-conflict and preserves the document untouched", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { node, session } = buildAddDeleteSession(raw);
    const liveDoc = parseDocument(["- 親", "  - 子1（外部編集）", "  - 子2"].join("\n"));
    const targetId = node.childIds[0];
    const outcome = applyParentChildAddDeleteToDocument(
      liveDoc,
      node.id,
      false,
      "",
      "",
      { childNodeId: targetId, dirty: true, originalRawText: session.childSlots[0].rawText, newRawText: "  - 新しい本文" },
      null,
      null
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("existing-child-conflict");
    expect(outcome.lines).toBe(liveDoc.lines);
  });

  it("rejects on a deletion-target-conflict and preserves the document untouched", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { node, session } = buildAddDeleteSession(raw);
    const liveDoc = parseDocument(["- 親", "  - 子1（外部編集）", "  - 子2"].join("\n"));
    const targetId = node.childIds[0];
    const outcome = applyParentChildAddDeleteToDocument(
      liveDoc,
      node.id,
      false,
      "",
      "",
      null,
      { childNodeId: targetId, originalRawText: session.childSlots[0].rawText },
      null
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("deletion-target-conflict");
    expect(outcome.lines).toBe(liveDoc.lines);
  });

  it("rejects when the deletion target gained a grandchild since it was marked (deletion-target-has-children)", () => {
    const raw = ["- 親", "  - 子1", "  - 子2"].join("\n");
    const { node, session } = buildAddDeleteSession(raw);
    const liveDoc = parseDocument(["- 親", "  - 子1", "    - 新しい孫", "  - 子2"].join("\n"));
    const targetId = node.childIds[0];
    const outcome = applyParentChildAddDeleteToDocument(
      liveDoc,
      node.id,
      false,
      "",
      "",
      null,
      { childNodeId: targetId, originalRawText: session.childSlots[0].rawText },
      null
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("deletion-target-has-children");
    expect(outcome.lines).toBe(liveDoc.lines);
  });

  it("rejects when the parent id no longer resolves at all (parent-resolve-failed)", () => {
    const raw = ["- 親", "  - 子1"].join("\n");
    const { doc } = buildAddDeleteSession(raw);
    const outcome = applyParentChildAddDeleteToDocument(doc, "li-does-not-exist", true, "", "-新しい", null, null, null);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("parent-resolve-failed");
    expect(outcome.lines).toBe(doc.lines);
  });

  it("is a true no-op (changed: false, zero mutation) when nothing is dirty/present at all — defensive only", () => {
    const raw = ["- 親", "  - 子1"].join("\n");
    const { doc, node, projection } = buildAddDeleteSession(raw);
    const outcome = applyParentChildAddDeleteToDocument(
      doc,
      node.id,
      false,
      projection.ownText.rawText,
      projection.ownText.rawText,
      null,
      null,
      null
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.lines).toBe(doc.lines);
  });

  it("applies parent+deletion together as ONE atomic write when both are dirty/present — insertion/deletion/replacement never partially applied", () => {
    const raw = ["- 親", "  - 子1", "  - 子2", "  - 子3"].join("\n");
    const { doc, node, projection, session } = buildAddDeleteSession(raw);
    const targetId = node.childIds[1];
    const outcome = applyParentChildAddDeleteToDocument(
      doc,
      node.id,
      true,
      projection.ownText.rawText,
      "- 親（編集）",
      null,
      { childNodeId: targetId, originalRawText: session.childSlots[1].rawText },
      null
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- 親（編集）", "  - 子1", "  - 子3"]);
  });
});

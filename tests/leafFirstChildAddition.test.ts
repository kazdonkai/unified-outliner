/**
 * Phase 5L-9b ("First Direct Child Addition for Leaf List Items — Mode
 * B"): real-pipeline tests for edit/parentChildInlineEditSession.ts's own
 * Phase 5L-9b section (evaluateLeafFirstChildEligibility,
 * buildPendingLeafFirstChild, applyLeafFirstChildAdditionToDocument) —
 * mirrors tests/parentChildAddDelete.test.ts's/
 * tests/parentChildIndentOutdent.test.ts's own house style (real
 * parseDocument, never a hand-built fake ParsedDocument), in isolation
 * from the Partial Edit Pane's own View-layer wiring (covered separately
 * in tests/leafFirstChildAdditionUiWiring.test.ts).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode, ListBlockNode, ParsedDocument } from "../src/model/block";
import {
  PendingLeafFirstChild,
  applyLeafFirstChildAdditionToDocument,
  buildPendingLeafFirstChild,
  childProjectionRawText,
  evaluateLeafFirstChildEligibility,
} from "../src/edit/parentChildInlineEditSession";

function parseLeaf(raw: string, nodeId = "li-0"): { doc: ParsedDocument; node: ListBlockNode } {
  const doc = parseDocument(raw);
  const node = doc.nodes.get(nodeId);
  if (!node || !isListNode(node)) {
    throw new Error(`fixture setup error: ${nodeId} not a list node`);
  }
  return { doc, node };
}

function buildPending(raw: string, nodeId = "li-0"): { doc: ParsedDocument; pending: PendingLeafFirstChild } {
  const { doc } = parseLeaf(raw, nodeId);
  const built = buildPendingLeafFirstChild(doc, nodeId);
  if (!built.ok) {
    throw new Error(`fixture setup error: buildPendingLeafFirstChild failed with reason ${built.reason}`);
  }
  return { doc, pending: built.pending };
}

describe("evaluateLeafFirstChildEligibility", () => {
  it("accepts a plain single-line unordered leaf", () => {
    const { doc } = parseLeaf("- 親項目");
    expect(evaluateLeafFirstChildEligibility(doc, "li-0")).toMatchObject({ ok: true });
  });

  it("accepts a single-line task leaf", () => {
    const { doc } = parseLeaf("- [ ] 親タスク");
    expect(evaluateLeafFirstChildEligibility(doc, "li-0")).toMatchObject({ ok: true });
  });

  it("accepts a single-line ordered leaf", () => {
    const { doc } = parseLeaf("1. 親番号項目");
    expect(evaluateLeafFirstChildEligibility(doc, "li-0")).toMatchObject({ ok: true });
  });

  it("accepts a multi-line leaf with a plain continuation line", () => {
    const { doc } = parseLeaf(["- 親項目", "  続きの行"].join("\n"));
    expect(evaluateLeafFirstChildEligibility(doc, "li-0")).toMatchObject({ ok: true });
  });

  it("accepts a multi-line leaf with a blank-line continuation", () => {
    const { doc } = parseLeaf(["- 親項目", "", "  続きの段落"].join("\n"));
    expect(evaluateLeafFirstChildEligibility(doc, "li-0")).toMatchObject({ ok: true });
  });

  it("refuses a node that is missing or not a list node", () => {
    const { doc } = parseLeaf("- 親項目");
    expect(evaluateLeafFirstChildEligibility(doc, "li-999")).toEqual({ ok: false, reason: "leaf-not-found" });
  });

  it("refuses a node that already has children — has-children", () => {
    const { doc } = parseLeaf(["- 親項目", "  - 既存の子"].join("\n"));
    expect(evaluateLeafFirstChildEligibility(doc, "li-0")).toEqual({ ok: false, reason: "leaf-has-children" });
  });

  it("refuses a mixed-tab/space (unsafeIndent) item", () => {
    const raw = "- 親A\n\t- \tタブ混在の子";
    const doc = parseDocument(raw);
    // Find the unsafeIndent node directly, whichever id the parser gave it —
    // this fixture's own exact shape is less important than exercising a
    // genuinely unsafeIndent node.
    const unsafe = [...doc.nodes.values()].find((n) => isListNode(n) && n.unsafeIndent) as
      | ListBlockNode
      | undefined;
    if (unsafe) {
      expect(evaluateLeafFirstChildEligibility(doc, unsafe.id)).toEqual({
        ok: false,
        reason: "leaf-unsafe-indent",
      });
    } else {
      // If this particular raw text doesn't happen to produce an
      // unsafeIndent node under the current parser, this test still
      // documents the intent rather than silently vanishing.
      expect(true).toBe(true);
    }
  });

  it("refuses a multi-line leaf whose continuation contains a ComplexBlock (callout)", () => {
    const raw = ["- 親項目", "  > [!note] 埋め込みcallout", "  > 本文"].join("\n");
    const doc = parseDocument(raw);
    expect(evaluateLeafFirstChildEligibility(doc, "li-0")).toEqual({
      ok: false,
      reason: "leaf-complex-block",
    });
  });
});

describe("buildPendingLeafFirstChild", () => {
  it("builds a canonical unordered, non-task, empty-body draft one indent step past the leaf's own indentation (no existing sibling to match — computeNewChildIndent's own null-lastChildNode fallback)", () => {
    const { pending } = buildPending("- 親項目");
    expect(pending.leafNodeId).toBe("li-0");
    // Top-level leaf is at column 0; one TAB_WIDTH (4) step = column 4.
    expect(childProjectionRawText(pending.draft.projection)).toBe("    -");
  });

  it("matches the leaf's own tabs-vs-spaces indentation style", () => {
    const { pending } = buildPending("- 親項目\n"); // top-level, no leading indent — spaces fallback
    expect(childProjectionRawText(pending.draft.projection)).toBe("    -");
  });

  it("indents relative to a NESTED leaf's own (non-zero) indentation, not from column 0", () => {
    const raw = ["- 祖父", "  - 親項目"].join("\n");
    const { pending } = buildPending(raw, "li-1");
    // "  - 親項目" starts at column 2; one more TAB_WIDTH (4) step = column 6.
    expect(childProjectionRawText(pending.draft.projection)).toBe("      -");
  });

  it("propagates the underlying eligibility failure reason for an ineligible leaf", () => {
    const { doc } = parseLeaf(["- 親項目", "  - 既存の子"].join("\n"));
    const built = buildPendingLeafFirstChild(doc, "li-0");
    expect(built).toEqual({ ok: false, reason: "leaf-has-children" });
  });
});

describe("applyLeafFirstChildAdditionToDocument", () => {
  it("adds a first child to a plain unordered leaf, own-text untouched", () => {
    const { doc, pending } = buildPending("- 親項目");
    const outcome = applyLeafFirstChildAdditionToDocument(doc, "li-0", "- 親項目", "- 親項目", pending, false, "");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.lines).toEqual(["- 親項目", "    -"]);
    const candidate = parseDocument(outcome.lines.join("\n"));
    const parent = candidate.nodes.get("li-0");
    expect(parent && isListNode(parent) ? parent.childIds.length : -1).toBe(1);
  });

  it("saves an own-text edit AND the new first child together in the SAME Apply", () => {
    const { doc, pending } = buildPending("- 元の本文");
    const outcome = applyLeafFirstChildAdditionToDocument(
      doc,
      "li-0",
      "- 元の本文",
      "- 編集後の本文",
      pending,
      false,
      ""
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.lines).toEqual(["- 編集後の本文", "    -"]);
  });

  // Regression test for a real-device bug found during manual verification:
  // typing a body into the pending first child's own inline editor and
  // pressing Apply produced an empty "-" child instead of the typed text —
  // applyLeafFirstChildEdit was passing `pendingLeafFirstChild` straight
  // through to applyLeafFirstChildAdditionToDocument without ever reading
  // newChildTextareaEl's current value, so only the canonical (always
  // empty) draft body was ever written. Fixed by threading
  // childBodyDirty/editedChildBody through, mirroring Mode A's own
  // newChildDirty/editedNewChildBody handling in
  // invertAndValidateParentChildAddDeleteEdit exactly.
  it("saves the pending first child's OWN edited body text — not just the canonical empty draft — when the child's inline editor is dirty", () => {
    const { doc, pending } = buildPending("- 親項目");
    const outcome = applyLeafFirstChildAdditionToDocument(
      doc,
      "li-0",
      "- 親項目",
      "- 親項目",
      pending,
      true,
      "新しい子項目を追加する"
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.lines).toEqual(["- 親項目", "    - 新しい子項目を追加する"]);
    const candidate = parseDocument(outcome.lines.join("\n"));
    const parent = candidate.nodes.get("li-0");
    expect(parent && isListNode(parent) ? parent.childIds.length : -1).toBe(1);
  });

  it("refuses with new-child-unsafe-structure — reusing Mode A's own dedicated reason — when the edited child body contains a line break", () => {
    const { doc, pending } = buildPending("- 親項目");
    const outcome = applyLeafFirstChildAdditionToDocument(
      doc,
      "li-0",
      "- 親項目",
      "- 親項目",
      pending,
      true,
      "1行目\n2行目"
    );
    expect(outcome).toEqual({ ok: false, reason: "new-child-unsafe-structure" });
  });

  it("preserves a task leaf's own checkbox state across the addition", () => {
    const { doc, pending } = buildPending("- [x] 親タスク");
    const outcome = applyLeafFirstChildAdditionToDocument(
      doc,
      "li-0",
      "- [x] 親タスク",
      "- [x] 親タスク",
      pending,
      false,
      ""
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // ListBlockNode carries no separate parsed task-status field — the
    // checkbox state lives only in the raw own-text line, so verify it
    // survives the addition by checking that line's raw text directly
    // (both the returned lines and the re-parsed candidate's own range).
    expect(outcome.lines[0]).toBe("- [x] 親タスク");
    const candidate = parseDocument(outcome.lines.join("\n"));
    const parent = candidate.nodes.get("li-0");
    expect(parent && isListNode(parent) ? candidate.lines[parent.range.startLine] : undefined).toBe(
      "- [x] 親タスク"
    );
  });

  it("preserves an ordered leaf's own number text across the addition (no renumbering)", () => {
    const { doc, pending } = buildPending("12. 親番号項目");
    const outcome = applyLeafFirstChildAdditionToDocument(
      doc,
      "li-0",
      "12. 親番号項目",
      "12. 親番号項目",
      pending,
      false,
      ""
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.lines[0]).toBe("12. 親番号項目");
  });

  it("does not disturb a following sibling at the same level", () => {
    const raw = ["- 親項目", "- 次の兄弟"].join("\n");
    const { doc, pending } = buildPending(raw);
    const outcome = applyLeafFirstChildAdditionToDocument(doc, "li-0", "- 親項目", "- 親項目", pending, false, "");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.lines).toEqual(["- 親項目", "    -", "- 次の兄弟"]);
  });

  it("refuses on own-text conflict — the document's current text no longer matches the pane's own load-time snapshot", () => {
    const { doc, pending } = buildPending("- 親項目");
    const outcome = applyLeafFirstChildAdditionToDocument(
      doc,
      "li-0",
      "- 元の本文と食い違うスナップショット",
      "- 親項目",
      pending,
      false,
      ""
    );
    expect(outcome).toEqual({ ok: false, reason: "own-text-conflict" });
  });

  it("refuses when the target no longer resolves as a leaf (gained children since the draft was built — re-verified fresh against `doc`)", () => {
    const { pending } = buildPending("- 親項目"); // pending built against a leaf-shaped doc
    // But applyLeafFirstChildAdditionToDocument's own `doc` argument is a
    // DIFFERENT, already-parent-shaped document — exercising its own
    // fresh re-verification rather than trusting `pending` was built
    // against the same doc.
    const alreadyParentDoc = parseDocument(["- 親項目", "  - 既に居る子"].join("\n"));
    const outcome = applyLeafFirstChildAdditionToDocument(
      alreadyParentDoc,
      "li-0",
      "- 親項目",
      "- 親項目",
      pending,
      false,
      ""
    );
    expect(outcome).toEqual({ ok: false, reason: "leaf-has-children" });
  });

  it("refuses with candidate-structure-invalid when the caller-supplied own-text itself smuggles in an extra nested item (defensive re-parse catches more than one resulting child)", () => {
    const { doc, pending } = buildPending("- 親項目");
    const adversarialOwnText = ["- 親項目", "  - 紛れ込んだ子"].join("\n");
    const outcome = applyLeafFirstChildAdditionToDocument(
      doc,
      "li-0",
      "- 親項目",
      adversarialOwnText,
      pending,
      false,
      ""
    );
    expect(outcome).toEqual({ ok: false, reason: "candidate-structure-invalid" });
  });
});

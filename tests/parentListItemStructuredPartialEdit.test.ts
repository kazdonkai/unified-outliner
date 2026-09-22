/**
 * Phase 5L-6 ("Parent List Item Structured Partial Edit"): end-to-end
 * integration tests that reproduce view/PartialEditView.ts's own
 * loadNodeInternal (list branch, now a 5-way priority order — the four
 * pre-existing Phase 5L-1〜5L-4 single-line/multi-line-leaf projections,
 * PLUS this ticket's own new parent tier as the fifth, lowest-priority
 * fallback) / applyEdit (standalone node branch, parent arm) EXACTLY, using
 * the real, unmodified backend functions they call. Mirrors
 * tests/multiLineLeafListPartialEdit.test.ts's own structure exactly,
 * extended with the parent arm this ticket adds.
 * tests/parentListItemPartialEditUiWiring.test.ts (a separate file) covers
 * the actual View wiring — that this exact sequence of function calls is
 * really what loadNodeInternal/applyEdit's source does.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { extractSubtreeText } from "../src/edit/partialEdit";
import { isListNode, ParsedDocument } from "../src/model/block";
import { isStandaloneListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneListMarkerProjection";
import { isStandaloneTaskListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneTaskListProjection";
import { isStandaloneOrderedListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneOrderedListProjection";
import {
  hasComplexBlockInMultiLineListItemContinuation,
  isStandaloneMultiLineLeafListItemEligibleForProjection,
} from "../src/edit/standaloneMultiLineListItemProjection";
import { isStandaloneParentListItemEligibleForProjection } from "../src/edit/standaloneParentListItemProjection";
import { buildListMarkerProjection, ListMarkerProjection } from "../src/edit/listMarkerProjection";
import { buildTaskListProjection, TaskListProjection } from "../src/edit/taskListProjection";
import { buildOrderedListProjection, OrderedListProjection } from "../src/edit/orderedListProjection";
import { buildMultiLineListItemProjection, MultiLineListItemProjection } from "../src/edit/multiLineListItemProjection";
import {
  ParentListItemProjection,
  applyParentListItemOwnTextEdit,
  buildParentListItemProjection,
  invertParentListItemProjection,
  projectedParentBodyText,
  projectedParentChecked,
  projectedParentNumberText,
} from "../src/edit/parentListItemProjection";

/** Reproduces view/PartialEditView.ts's own buildStandaloneListProjections exactly. */
function buildStandaloneListProjections(
  listEligible: boolean,
  taskEligible: boolean,
  orderedEligible: boolean,
  rawLine: string
): {
  list: ListMarkerProjection | null;
  task: TaskListProjection | null;
  ordered: OrderedListProjection | null;
} {
  if (!listEligible && !orderedEligible) return { list: null, task: null, ordered: null };
  const built = buildListMarkerProjection(rawLine);
  if (built.ok) return { list: built.projection, task: null, ordered: null };
  if (built.reason === "task-list-marker" && taskEligible) {
    const taskBuilt = buildTaskListProjection(rawLine);
    return { list: null, task: taskBuilt.ok ? taskBuilt.projection : null, ordered: null };
  }
  if (built.reason === "ordered-marker" && orderedEligible) {
    const orderedBuilt = buildOrderedListProjection(rawLine);
    return { list: null, task: null, ordered: orderedBuilt.ok ? orderedBuilt.projection : null };
  }
  return { list: null, task: null, ordered: null };
}

/**
 * Reproduces loadNodeInternal's own list-branch gate exactly, including the
 * Phase 5L-6 parent attempt — tried ONLY once all four single-line/
 * multi-line-leaf projections came back null, AND only for a node with
 * `childIds.length > 0`, mirroring this ticket's own design doc's priority
 * order.
 */
function loadStandalone(text: string, nodeId: string) {
  const doc = parseDocument(text);
  const extracted = extractSubtreeText(doc, nodeId);
  expect(extracted.ok).toBe(true);
  const node = doc.nodes.get(nodeId);
  const listEligible =
    extracted.kind === "list" &&
    !!node &&
    isListNode(node) &&
    isStandaloneListItemEligibleForMarkerFreeProjection(node);
  const taskEligible =
    extracted.kind === "list" &&
    !!node &&
    isListNode(node) &&
    isStandaloneTaskListItemEligibleForMarkerFreeProjection(node);
  const orderedEligible =
    extracted.kind === "list" &&
    !!node &&
    isListNode(node) &&
    isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node);
  const { list, task, ordered } = buildStandaloneListProjections(
    listEligible,
    taskEligible,
    orderedEligible,
    extracted.text
  );
  const multiLineEligible =
    extracted.kind === "list" &&
    !!node &&
    isListNode(node) &&
    isStandaloneMultiLineLeafListItemEligibleForProjection(node) &&
    !hasComplexBlockInMultiLineListItemContinuation(doc, node);
  let multiLine: MultiLineListItemProjection | null = null;
  if (!list && !task && !ordered && multiLineEligible) {
    const built = buildMultiLineListItemProjection(extracted.text);
    multiLine = built.ok ? built.projection : null;
  }
  const parentEligible =
    extracted.kind === "list" &&
    !!node &&
    isListNode(node) &&
    node.childIds.length > 0 &&
    isStandaloneParentListItemEligibleForProjection(doc, node);
  let parent: ParentListItemProjection | null = null;
  if (!list && !task && !ordered && !multiLine && parentEligible && node && isListNode(node)) {
    const built = buildParentListItemProjection(doc, node);
    parent = built.ok ? built.projection : null;
  }
  return {
    doc,
    nodeId,
    originalText: extracted.text,
    listProjection: list,
    taskProjection: task,
    orderedProjection: ordered,
    multiLineProjection: multiLine,
    parentProjection: parent,
  };
}

type Loaded = ReturnType<typeof loadStandalone>;

/** Reproduces applyEdit's own standalone-node branch (parent arm) exactly — NOT applySubtreeEdit, see edit/parentListItemProjection.ts's own top doc comment for why. */
function applyStandaloneParent(
  loaded: Loaded,
  editedChecked: boolean,
  editedNumberText: string,
  editedBody: string,
  liveDoc: ParsedDocument = loaded.doc
) {
  if (!loaded.parentProjection) throw new Error("test setup error: no parent projection loaded");
  const inverted = invertParentListItemProjection(
    loaded.parentProjection,
    editedChecked,
    editedNumberText,
    editedBody
  );
  if (!inverted.ok) return { ok: false as const, reason: inverted.reason };
  const outcome = applyParentListItemOwnTextEdit(
    liveDoc,
    loaded.nodeId,
    loaded.parentProjection.ownText.rawText,
    inverted.ownTextRawText
  );
  return { ok: true as const, outcome, newOwnTextRawText: inverted.ownTextRawText };
}

describe("Phase 5L-6: parent projection activates ONLY once all four single-line/multi-line-leaf projections refused, AND only for a node with children", () => {
  it("an unordered parent with one plain child projects, own-text body is just its own first line", () => {
    const loaded = loadStandalone(["- 親本文", "  - 子1"].join("\n"), "li-0");
    expect(loaded.listProjection).toBeNull();
    expect(loaded.taskProjection).toBeNull();
    expect(loaded.orderedProjection).toBeNull();
    expect(loaded.multiLineProjection).toBeNull();
    expect(loaded.parentProjection).not.toBeNull();
    expect(loaded.parentProjection!.ownText.listKind).toBe("unordered");
    expect(projectedParentBodyText(loaded.parentProjection!)).toBe("親本文");
  });

  it("a task parent projects, checkbox hidden from the shared textarea, checked reflects status", () => {
    const unchecked = loadStandalone(["- [ ] 親タスク", "  - 子1"].join("\n"), "li-0");
    expect(unchecked.parentProjection).not.toBeNull();
    expect(projectedParentChecked(unchecked.parentProjection!)).toBe(false);

    const checked = loadStandalone(["- [x] 親タスク", "  - 子1"].join("\n"), "li-0");
    expect(projectedParentChecked(checked.parentProjection!)).toBe(true);
  });

  it("an ordered parent projects, number captured, delimiter hidden", () => {
    const loaded = loadStandalone(["12. 親項目", "    - 子1"].join("\n"), "li-0");
    expect(loaded.parentProjection).not.toBeNull();
    expect(loaded.parentProjection!.ownText.listKind).toBe("ordered");
    expect(projectedParentNumberText(loaded.parentProjection!)).toBe("12");
  });

  it("a plain child-list-free leaf item (single-line or multi-line) NEVER builds a parent projection, even though it IS a list item", () => {
    for (const text of ["- 一行だけ", ["- 一行目", "  続き"].join("\n")]) {
      const loaded = loadStandalone(text, "li-0");
      expect(loaded.parentProjection).toBeNull();
    }
  });

  it("a parent whose own-text spans a continuation + blank line before its first child projects via the SAME multi-line machinery, reused unmodified", () => {
    const loaded = loadStandalone(
      ["- 親本文", "  続きの説明", "", "  さらに続き", "  - 子1"].join("\n"),
      "li-0"
    );
    expect(loaded.parentProjection).not.toBeNull();
    expect(projectedParentBodyText(loaded.parentProjection!)).toBe("親本文\n続きの説明\n\nさらに続き");
  });

  it("an interleaved-content parent falls back to raw (no projection of ANY kind) — the pane must show the whole item raw", () => {
    const loaded = loadStandalone(["- 親本文", "  - 子1", "  さらに親の続き？"].join("\n"), "li-0");
    expect(loaded.listProjection).toBeNull();
    expect(loaded.taskProjection).toBeNull();
    expect(loaded.orderedProjection).toBeNull();
    expect(loaded.multiLineProjection).toBeNull();
    expect(loaded.parentProjection).toBeNull();
  });

  it("a parent with a callout/blockquote/fenced-code/table in its own-text continuation falls back to raw, exactly like the leaf multi-line gate's own identical policy", () => {
    for (const text of [
      ["- 親本文", "  > 引用", "  - 子1"].join("\n"),
      ["- 親本文", "  ```", "  code", "  ```", "  - 子1"].join("\n"),
    ]) {
      const loaded = loadStandalone(text, "li-0");
      expect(loaded.parentProjection).toBeNull();
    }
  });

  it("CompositeBlock members are entirely out of scope — a CompositeBlock's own list member never even reaches loadStandalone (loadCompositeInternal is a separate call path); this test documents that boundary, not a behavior to assert directly", () => {
    expect(true).toBe(true);
  });
});

describe("Phase 5L-6: Apply preserves marker/checkbox/number and writes back through applyParentListItemOwnTextEdit — own-text range ONLY", () => {
  it("unordered: editing the body reconstructs the marker byte-for-byte, and the child subtree line is untouched", () => {
    const loaded = loadStandalone(["- 元の親本文", "  - 子1", "  - 子2"].join("\n"), "li-0");
    const result = applyStandaloneParent(loaded, false, "", "編集後の親本文");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newOwnTextRawText).toBe("- 編集後の親本文");
    expect(result.outcome.changed).toBe(true);
    expect(result.outcome.lines).toEqual(["- 編集後の親本文", "  - 子1", "  - 子2"]);
  });

  it("task: editing ONLY the checkbox toggles '[ ]' to '[x]' and preserves every child line verbatim", () => {
    const loaded = loadStandalone(["- [ ] 親タスク", "  - 子1", "  - 子2"].join("\n"), "li-0");
    const result = applyStandaloneParent(loaded, true, "", projectedParentBodyText(loaded.parentProjection!));
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual(["- [x] 親タスク", "  - 子1", "  - 子2"]);
  });

  it("ordered: editing ONLY the number writes the new number and leaves every child line untouched", () => {
    const loaded = loadStandalone(["1. 親項目", "   - 子1"].join("\n"), "li-0");
    const result = applyStandaloneParent(
      loaded,
      false,
      "42",
      projectedParentBodyText(loaded.parentProjection!)
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual(["42. 親項目", "   - 子1"]);
  });

  it("a multi-line own-text edit (body + continuation, ordered number together) applies all changes to the own-text range only", () => {
    const loaded = loadStandalone(["1. 元の親項目", "   元の続き", "   - 子1"].join("\n"), "li-0");
    const result = applyStandaloneParent(loaded, false, "7", "更新後の親項目\n更新後の続き");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual(["7. 更新後の親項目", "   更新後の続き", "   - 子1"]);
  });

  it("no line outside the own-text range changes, including sibling items before/after the parent", () => {
    const text = ["# 見出し", "- 前の項目", "- 親本文", "  - 子1", "  - 子2", "- 後の項目"].join("\n");
    const loaded = loadStandalone(text, "li-1");
    const result = applyStandaloneParent(loaded, false, "", "編集後の親本文");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual([
      "# 見出し",
      "- 前の項目",
      "- 編集後の親本文",
      "  - 子1",
      "  - 子2",
      "- 後の項目",
    ]);
  });

  it("re-opening the same item after Apply shows the UPDATED number/checkbox/body, and STILL correctly re-derives the child-subtree preview", () => {
    const loaded = loadStandalone(["1. 親項目", "   - 子1"].join("\n"), "li-0");
    const result = applyStandaloneParent(loaded, false, "9", "更新後の親項目");
    if (!result.ok) throw new Error("expected ok");
    const reloaded = loadStandalone(result.outcome.lines.join("\n"), "li-0");
    expect(reloaded.parentProjection).not.toBeNull();
    expect(projectedParentNumberText(reloaded.parentProjection!)).toBe("9");
    expect(projectedParentBodyText(reloaded.parentProjection!)).toBe("更新後の親項目");
    expect(reloaded.parentProjection!.childSubtreeText).toBe("   - 子1");
  });

  it("duplicate/non-sequential sibling ordered numbers are NEVER an Apply-rejection reason — no automatic renumbering of siblings is ever performed", () => {
    const text = ["5. 一番目", "5. 二番目（重複番号）", "   - 子1", "1. 三番目（逆順）"].join("\n");
    const loaded = loadStandalone(text, "li-1");
    expect(loaded.parentProjection).not.toBeNull();
    const result = applyStandaloneParent(loaded, false, "5", "編集後の二番目");
    if (!result.ok) throw new Error("expected ok, sibling numbering must never block Apply");
    expect(result.outcome.lines).toEqual([
      "5. 一番目",
      "5. 編集後の二番目",
      "   - 子1",
      "1. 三番目（逆順）",
    ]);
  });
});

describe("Phase 5L-6: an external change to the CHILD SUBTREE alone never blocks Apply — the core safety requirement of this ticket", () => {
  it("the child subtree changed (e.g. a Tree drag-drop reordered/edited a child) between load and Apply, but the own-text snapshot is unchanged — Apply still succeeds", () => {
    const loaded = loadStandalone(["- 親本文", "  - 子1"].join("\n"), "li-0");
    const inverted = invertParentListItemProjection(loaded.parentProjection!, false, "", "編集後の親本文");
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    // The LIVE document (as it stands at Apply time) has a DIFFERENT child
    // body than what was loaded — simulating an external child-subtree
    // edit that happened while this pane was open.
    const liveDoc = parseDocument(["- 親本文", "  - 変更後の子1", "  - 追加された子2"].join("\n"));
    const outcome = applyParentListItemOwnTextEdit(
      liveDoc,
      loaded.nodeId,
      loaded.parentProjection!.ownText.rawText,
      inverted.ownTextRawText
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- 編集後の親本文", "  - 変更後の子1", "  - 追加された子2"]);
  });

  it("conversely, an external change to the OWN-TEXT itself (not the child subtree) DOES correctly block Apply as a conflict", () => {
    const loaded = loadStandalone(["- 親本文", "  - 子1"].join("\n"), "li-0");
    const inverted = invertParentListItemProjection(loaded.parentProjection!, false, "", "編集後の親本文");
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    const liveDoc = parseDocument(["- 外部で変更された親本文", "  - 子1"].join("\n"));
    const outcome = applyParentListItemOwnTextEdit(
      liveDoc,
      loaded.nodeId,
      loaded.parentProjection!.ownText.rawText,
      inverted.ownTextRawText
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("parent-own-text-conflict");
  });
});

describe("Phase 5L-6: strict number validation and structural-safety Apply-rejections leave every draft field preserved, applyParentListItemOwnTextEdit never reached", () => {
  it("every invalid ordered number text is refused with reason 'invalid-number'", () => {
    const loaded = loadStandalone(["1. 親項目", "   - 子1"].join("\n"), "li-0");
    for (const badNumber of ["", "0", "-1", "1.5", "abc"]) {
      const result = applyStandaloneParent(loaded, false, badNumber, "編集後の本文");
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error(`expected refusal for ${JSON.stringify(badNumber)}`);
      expect(result.reason).toBe("invalid-number");
    }
  });

  it("an own-text edit that would manufacture a nested child list item is refused with 'own-text-unsafe-structure', never reaching applyParentListItemOwnTextEdit", () => {
    const loaded = loadStandalone(["- 親本文", "  続き", "  - 子1"].join("\n"), "li-0");
    const result = applyStandaloneParent(loaded, false, "", "本文\n- 子リストのように見える行");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("own-text-unsafe-structure");
  });
});

describe("Phase 5L-6 regression guard: the four pre-existing Phase 5L-1〜5L-4 projections still activate identically for their own eligible shapes, never shadowed by the new parent tier", () => {
  it("single-line unordered/task/ordered items still route through their own existing single-line projections", () => {
    const unordered = loadStandalone("- 一行だけ", "li-0");
    expect(unordered.listProjection).not.toBeNull();
    expect(unordered.parentProjection).toBeNull();

    const task = loadStandalone("- [ ] 一行だけ", "li-0");
    expect(task.taskProjection).not.toBeNull();
    expect(task.parentProjection).toBeNull();

    const ordered = loadStandalone("1. 一行だけ", "li-0");
    expect(ordered.orderedProjection).not.toBeNull();
    expect(ordered.parentProjection).toBeNull();
  });

  it("a multi-line CHILD-LIST-FREE leaf item still routes through the existing multi-line leaf projection, never the new parent tier", () => {
    const loaded = loadStandalone(["- 一行目", "  続き"].join("\n"), "li-0");
    expect(loaded.multiLineProjection).not.toBeNull();
    expect(loaded.parentProjection).toBeNull();
  });
});

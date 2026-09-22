/**
 * Phase 5L-4 ("Multi-Line Leaf List Item Partial Edit Projection"):
 * end-to-end integration tests that reproduce view/PartialEditView.ts's
 * own loadNodeInternal (list branch, 4-way priority order) / applyEdit
 * (standalone node branch, multi-line arm) EXACTLY, using the real,
 * unmodified backend functions they call (parser/parseDocument.ts,
 * edit/partialEdit.ts, edit/standaloneListMarkerProjection.ts,
 * edit/standaloneTaskListProjection.ts,
 * edit/standaloneOrderedListProjection.ts,
 * edit/standaloneMultiLineListItemProjection.ts,
 * edit/listMarkerProjection.ts, edit/taskListProjection.ts,
 * edit/orderedListProjection.ts, edit/multiLineListItemProjection.ts) —
 * never a mock, never a hand-typed snapshot for a success-path fixture.
 * Mirrors tests/orderedListMarkerPartialEdit.test.ts's own structure
 * exactly, extended with the multi-line arm this ticket adds.
 * tests/multiLineListPartialEditUiWiring.test.ts (a separate file) covers
 * the actual View wiring — that this exact sequence of function calls is
 * really what loadNodeInternal/applyEdit's source does.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { extractSubtreeText, applySubtreeEdit } from "../src/edit/partialEdit";
import { isListNode } from "../src/model/block";
import { isStandaloneListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneListMarkerProjection";
import { isStandaloneTaskListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneTaskListProjection";
import { isStandaloneOrderedListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneOrderedListProjection";
import {
  isStandaloneMultiLineLeafListItemEligibleForProjection,
  hasComplexBlockInMultiLineListItemContinuation,
} from "../src/edit/standaloneMultiLineListItemProjection";
import { buildListMarkerProjection, ListMarkerProjection } from "../src/edit/listMarkerProjection";
import { buildTaskListProjection, TaskListProjection } from "../src/edit/taskListProjection";
import { buildOrderedListProjection, OrderedListProjection } from "../src/edit/orderedListProjection";
import {
  buildMultiLineListItemProjection,
  invertMultiLineListItemProjection,
  projectedMultiLineBodyText,
  projectedMultiLineChecked,
  projectedMultiLineNumberText,
  MultiLineListItemProjection,
} from "../src/edit/multiLineListItemProjection";

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
 * Reproduces loadNodeInternal's own list-branch gate exactly, including
 * the Phase 5L-4 multi-line attempt — tried ONLY once all three
 * single-line projections came back null, mirroring this ticket's own
 * design doc §7 priority order.
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
  return {
    doc,
    nodeId,
    originalText: extracted.text,
    listProjection: list,
    taskProjection: task,
    orderedProjection: ordered,
    multiLineProjection: multiLine,
  };
}

type Loaded = ReturnType<typeof loadStandalone>;

/** Reproduces applyEdit's own standalone-node branch (multi-line arm) exactly. */
function applyStandaloneMultiLine(
  loaded: Loaded,
  editedChecked: boolean,
  editedNumberText: string,
  editedBody: string
) {
  if (!loaded.multiLineProjection) throw new Error("test setup error: no multi-line projection loaded");
  const inverted = invertMultiLineListItemProjection(
    loaded.multiLineProjection,
    editedChecked,
    editedNumberText,
    editedBody
  );
  if (!inverted.ok) return { ok: false as const, reason: inverted.reason };
  const outcome = applySubtreeEdit(loaded.doc, loaded.nodeId, loaded.originalText, inverted.rawText);
  return { ok: true as const, outcome, newRawText: inverted.rawText };
}

describe("Phase 5L-4: multi-line marker-free projection activates ONLY once all three single-line projections refused, on real multi-line fixtures", () => {
  it("an unordered multi-line leaf item projects marker-free, listKind 'unordered', body joining first line + continuation with '\\n'", () => {
    const loaded = loadStandalone(["- 一行目の本文", "  二行目の続き"].join("\n"), "li-0");
    expect(loaded.listProjection).toBeNull();
    expect(loaded.taskProjection).toBeNull();
    expect(loaded.orderedProjection).toBeNull();
    expect(loaded.multiLineProjection).not.toBeNull();
    expect(loaded.multiLineProjection!.listKind).toBe("unordered");
    expect(projectedMultiLineBodyText(loaded.multiLineProjection!)).toBe("一行目の本文\n二行目の続き");
    expect(projectedMultiLineChecked(loaded.multiLineProjection!)).toBe(false);
    expect(projectedMultiLineNumberText(loaded.multiLineProjection!)).toBe("");
  });

  it("a task multi-line leaf item projects marker-free, checkbox hidden, listKind 'task', checked reflects the checkbox status", () => {
    const unchecked = loadStandalone(["- [ ] 未確認の一行目", "  補足事項"].join("\n"), "li-0");
    expect(unchecked.multiLineProjection).not.toBeNull();
    expect(unchecked.multiLineProjection!.listKind).toBe("task");
    expect(projectedMultiLineChecked(unchecked.multiLineProjection!)).toBe(false);
    expect(projectedMultiLineBodyText(unchecked.multiLineProjection!)).toBe("未確認の一行目\n補足事項");

    const checked = loadStandalone(["- [x] 確認済みの一行目", "  補足事項"].join("\n"), "li-0");
    expect(projectedMultiLineChecked(checked.multiLineProjection!)).toBe(true);
  });

  it("an ordered multi-line leaf item projects marker-free, delimiter/number captured, listKind 'ordered'", () => {
    const loaded = loadStandalone(["12. 十二番目の項目", "    続きの説明"].join("\n"), "li-0");
    expect(loaded.multiLineProjection).not.toBeNull();
    expect(loaded.multiLineProjection!.listKind).toBe("ordered");
    expect(projectedMultiLineNumberText(loaded.multiLineProjection!)).toBe("12");
    expect(projectedMultiLineBodyText(loaded.multiLineProjection!)).toBe("十二番目の項目\n続きの説明");
  });

  it("an unordered '*'/'+' marker multi-line item also projects marker-free — every unordered marker character, not just '-'", () => {
    const star = loadStandalone(["* 一行目", "  続き"].join("\n"), "li-0");
    const plus = loadStandalone(["+ 一行目", "  続き"].join("\n"), "li-0");
    expect(star.multiLineProjection!.listKind).toBe("unordered");
    expect(plus.multiLineProjection!.listKind).toBe("unordered");
  });

  it("an ordered ')' delimiter multi-line item projects marker-free identically to the '.' delimiter case", () => {
    const loaded = loadStandalone(["1) 校合済みの転写", "   続きの注記"].join("\n"), "li-0");
    expect(loaded.multiLineProjection!.listKind).toBe("ordered");
    expect(projectedMultiLineNumberText(loaded.multiLineProjection!)).toBe("1");
  });

  it("a blank line inside the continuation is preserved as an empty string in the projected body", () => {
    const loaded = loadStandalone(["- 一行目", "  二行目", "", "  四行目"].join("\n"), "li-0");
    expect(projectedMultiLineBodyText(loaded.multiLineProjection!)).toBe("一行目\n二行目\n\n四行目");
  });

  it("a multi-line leaf item nested under a parent list item captures its own indentation, and the parent line is untouched", () => {
    const text = ["- 親項目", "  - 一行目の本文", "    続きの説明"].join("\n");
    const doc = parseDocument(text);
    const extracted = extractSubtreeText(doc, "li-1");
    expect(extracted.ok).toBe(true);
    const node = doc.nodes.get("li-1");
    expect(
      node &&
        isListNode(node) &&
        isStandaloneMultiLineLeafListItemEligibleForProjection(node) &&
        !hasComplexBlockInMultiLineListItemContinuation(doc, node)
    ).toBe(true);
    const built = buildMultiLineListItemProjection(extracted.text);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.projection.continuationIndent).toBe("    ");
      expect(built.projection.body).toBe("一行目の本文\n続きの説明");
    }
  });

  it("extra indentation beyond the canonical continuation indent is preserved as CONTENT, not stripped further", () => {
    const loaded = loadStandalone(["- 一行目", "    余分に字下げされた続き"].join("\n"), "li-0");
    // canonical indent is 2 ("- "); the continuation line has 4 leading
    // spaces, so 2 remain as body content.
    expect(projectedMultiLineBodyText(loaded.multiLineProjection!)).toBe("一行目\n  余分に字下げされた続き");
  });

  it("Markdown constructs that merely LOOK like markers/links/embeds inside the continuation body are captured verbatim, never misparsed", () => {
    const loaded = loadStandalone(
      ["- 一行目", "  [link](https://example.com) ![[embed.png]] **強調** `code`"].join("\n"),
      "li-0"
    );
    expect(projectedMultiLineBodyText(loaded.multiLineProjection!)).toBe(
      "一行目\n[link](https://example.com) ![[embed.png]] **強調** `code`"
    );
  });
});

describe("Phase 5L-4: single-line items still route through the existing three single-line projections — never the multi-line one (mutual exclusivity, Phase 5L-1/5L-2/5L-3 regression guard)", () => {
  it("a plain single-line unordered/task/ordered item never builds a multi-line projection", () => {
    for (const text of ["- 一行だけ", "- [ ] 一行だけ", "1. 一行だけ"]) {
      const loaded = loadStandalone(text, "li-0");
      expect(loaded.multiLineProjection).toBeNull();
    }
  });
});

describe("Phase 5L-4: Apply preserves marker/checkbox/number/indentation and writes back through the existing, unmodified applySubtreeEdit path", () => {
  it("unordered: editing only the body reconstructs the marker+indentation byte-for-byte, continuation re-indented canonically", () => {
    const loaded = loadStandalone(["- 元の一行目", "  元の続き"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "編集後の一行目\n編集後の続き");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe(["- 編集後の一行目", "  編集後の続き"].join("\n"));
    expect(result.outcome.changed).toBe(true);
    expect(result.outcome.lines).toEqual(["- 編集後の一行目", "  編集後の続き"]);
  });

  it("task: editing ONLY the checkbox (body untouched) toggles '[ ]' to '[x]' and preserves every continuation line verbatim", () => {
    const loaded = loadStandalone(["- [ ] 一行目", "  続き一", "  続き二"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(
      loaded,
      true,
      "",
      projectedMultiLineBodyText(loaded.multiLineProjection!)
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe(["- [x] 一行目", "  続き一", "  続き二"].join("\n"));
  });

  it("ordered: editing ONLY the number (body untouched) writes the new number, and the continuation stays indented to the projection's OWN canonical (load-time) indent — never re-widened to match the edited number's own new column width", () => {
    const loaded = loadStandalone(["1. 一行目", "   続き"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(
      loaded,
      false,
      "42",
      projectedMultiLineBodyText(loaded.multiLineProjection!)
    );
    if (!result.ok) throw new Error("expected ok");
    // "1. " is 3 columns wide; "42. " would be 4 — the canonical
    // continuationIndent was fixed at LOAD time from the original "1. "
    // and is never recomputed from the edited number, so the
    // continuation keeps its original 3-space indent.
    expect(result.newRawText).toBe(["42. 一行目", "   続き"].join("\n"));
  });

  it("ordered: editing BOTH number and body (including a continuation line) in the same Apply applies all three changes together", () => {
    const loaded = loadStandalone(["1. 元の一行目", "   元の続き"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "7", "更新後の一行目\n更新後の続き");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe(["7. 更新後の一行目", "   更新後の続き"].join("\n"));
  });

  it("task: editing checkbox AND body (including adding a new continuation line) applies all changes together", () => {
    const loaded = loadStandalone(["- [ ] 一行目", "  続き"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, true, "", "更新後の一行目\n更新後の続き\n新しい続き");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe(
      ["- [x] 更新後の一行目", "  更新後の続き", "  新しい続き"].join("\n")
    );
  });

  it("removing every continuation line (collapsing to a single line) is a valid Apply — the resulting raw text is just the reconstructed first line", () => {
    const loaded = loadStandalone(["- 一行目", "  続き"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "一行だけに");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe("- 一行だけに");
    expect(result.outcome.lines).toEqual(["- 一行だけに"]);
  });

  it("splitting one continuation line into two (adding a line) is a valid Apply", () => {
    const loaded = loadStandalone(["- 一行目", "  続きの本文"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "一行目\n続きの\n本文");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual(["- 一行目", "  続きの", "  本文"]);
  });

  it("merging two continuation lines into one (removing a line) is a valid Apply", () => {
    const loaded = loadStandalone(["- 一行目", "  続きの", "  本文"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "一行目\n続きの本文");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual(["- 一行目", "  続きの本文"]);
  });

  it("pasting several new lines in place of the whole body is a valid Apply — each new line is canonically re-indented", () => {
    const loaded = loadStandalone(["- 一行目", "  続き"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "新一行目\n新二行目\n新三行目\n新四行目");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual(["- 新一行目", "  新二行目", "  新三行目", "  新四行目"]);
  });

  it("inserting a blank line into the middle of the continuation reconstructs a genuinely blank raw line (no canonical indent synthesized onto it)", () => {
    const loaded = loadStandalone(["- 一行目", "  続き"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "一行目\n\n続き");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual(["- 一行目", "", "  続き"]);
  });

  it("an indented (nested-leaf) multi-line item preserves its OWN indentation on every reconstructed line, and never disturbs the parent's own line or a following sibling", () => {
    const text = ["- 親項目", "  - 一行目", "    続き", "- 別の兄弟項目"].join("\n");
    const doc = parseDocument(text);
    const extracted = extractSubtreeText(doc, "li-1");
    const built = buildMultiLineListItemProjection(extracted.text);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertMultiLineListItemProjection(built.projection, false, "", "編集後の一行目\n編集後の続き");
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    const outcome = applySubtreeEdit(doc, "li-1", extracted.text, inverted.rawText);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- 親項目",
      "  - 編集後の一行目",
      "    編集後の続き",
      "- 別の兄弟項目",
    ]);
  });

  it("re-opening the same item after Apply shows the UPDATED number/checkbox/body, marker-free, via the same load path", () => {
    const loaded = loadStandalone(["1. 一行目", "   続き"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "9", "更新後の一行目\n更新後の続き");
    if (!result.ok) throw new Error("expected ok");
    const reloaded = loadStandalone(result.outcome.lines.join("\n"), "li-0");
    expect(reloaded.multiLineProjection).not.toBeNull();
    expect(projectedMultiLineNumberText(reloaded.multiLineProjection!)).toBe("9");
    expect(projectedMultiLineBodyText(reloaded.multiLineProjection!)).toBe("更新後の一行目\n更新後の続き");
  });

  it("no line outside the edited item's own range changes — range-outside-unchanged", () => {
    const text = ["# 見出し", "- 前の項目", "- 一行目", "  続き", "- 後の項目"].join("\n");
    const loaded = loadStandalone(text, "li-1");
    const result = applyStandaloneMultiLine(loaded, false, "", "編集後の一行目\n編集後の続き");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual([
      "# 見出し",
      "- 前の項目",
      "- 編集後の一行目",
      "  編集後の続き",
      "- 後の項目",
    ]);
  });

  it("duplicate/non-sequential/reverse-order sibling numbers are NEVER an Apply-rejection reason for a multi-line ordered item either — no automatic renumbering of siblings is ever performed", () => {
    const text = ["5. 一番目", "5. 二番目（重複番号）", "   続き", "1. 三番目（逆順）"].join("\n");
    const loaded = loadStandalone(text, "li-1");
    expect(loaded.multiLineProjection).not.toBeNull();
    const result = applyStandaloneMultiLine(loaded, false, "5", "編集後の二番目\n編集後の続き");
    if (!result.ok) throw new Error("expected ok, sibling numbering must never block Apply");
    expect(result.outcome.lines).toEqual([
      "5. 一番目",
      "5. 編集後の二番目",
      "   編集後の続き",
      "1. 三番目（逆順）",
    ]);
    expect(result.outcome.lines[0]).toBe("5. 一番目");
    expect(result.outcome.lines[3]).toBe("1. 三番目（逆順）");
  });
});

describe("Phase 5L-4: strict number validation — every invalid ordered number text is refused with reason 'invalid-number', every draft field preserved, applySubtreeEdit never reached", () => {
  const cases: Array<[string, string]> = [
    ["empty string", ""],
    ["zero", "0"],
    ["negative number", "-1"],
    ["decimal point", "1.5"],
    ["a plus sign", "+1"],
    ["internal whitespace", "1 2"],
  ];
  it.each(cases)("rejects %s ('%s')", (_label, invalidNumberText) => {
    const loaded = loadStandalone(["1. 一行目", "   続き"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(
      loaded,
      false,
      invalidNumberText,
      projectedMultiLineBodyText(loaded.multiLineProjection!)
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("invalid-number");
    expect(loaded.doc.lines).toEqual(["1. 一行目", "   続き"]);
  });
});

describe("Phase 5L-4: Apply-rejection — a reconstructed candidate that would manufacture new document structure is refused with reason 'unsafe-structure', every draft field preserved, applySubtreeEdit never reached", () => {
  it("a continuation line that would reparse as a nested CHILD LIST item is refused", () => {
    const loaded = loadStandalone(["- 一行目", "  普通の続き"].join("\n"), "li-0");
    // The canonical continuation indent here is 2 spaces ("- "); a typed
    // "- " at that same column, once re-indented, would parse as a real
    // nested child list item under this same leaf.
    const result = applyStandaloneMultiLine(loaded, false, "", "一行目\n- 子リストのように見える行");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("unsafe-structure");
    expect(loaded.doc.lines).toEqual(["- 一行目", "  普通の続き"]);
  });

  it("a continuation line that would reparse as a BLOCKQUOTE is refused", () => {
    const loaded = loadStandalone(["- 一行目", "  普通の続き"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "一行目\n> 引用のように見える行");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("unsafe-structure");
  });

  it("a continuation line that would reparse as a CALLOUT is refused", () => {
    const loaded = loadStandalone(["- 一行目", "  普通の続き"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "一行目\n> [!note] タイトル\n> 本文");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("unsafe-structure");
  });

  it("continuation lines that would reparse as a FENCED CODE BLOCK are refused", () => {
    const loaded = loadStandalone(["- 一行目", "  普通の続き"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "一行目\n```\ncode\n```");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("unsafe-structure");
  });

  it("continuation lines that would reparse as a TABLE are refused", () => {
    const loaded = loadStandalone(["- 一行目", "  普通の続き"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "一行目\n| a | b |\n| - | - |\n| 1 | 2 |");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("unsafe-structure");
  });
});

describe("Phase 5L-4: stale snapshot conflict is refused by the EXISTING, unmodified applySubtreeEdit safety check", () => {
  it("Apply is refused with reason 'conflict' when the note changed elsewhere since load, and the draft/original doc are unaffected", () => {
    const loaded = loadStandalone(["- 一行目", "  続き"].join("\n"), "li-0");
    const externallyEditedDoc = parseDocument(["- 他者による変更後の内容", "  変更後の続き"].join("\n"));
    const inverted = invertMultiLineListItemProjection(loaded.multiLineProjection!, false, "", "編集後の一行目\n編集後の続き");
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    const outcome = applySubtreeEdit(externallyEditedDoc, "li-0", loaded.originalText, inverted.rawText);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("conflict");
  });
});

describe("Phase 5L-4: ineligible/unsupported structures fall back to raw editing (never refused, never treated as an error)", () => {
  it("a parent item that owns a nested CHILD LIST falls back to raw, even though its own range spans multiple lines", () => {
    const text = ["- 親項目", "  - 子項目"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.listProjection).toBeNull();
    expect(loaded.taskProjection).toBeNull();
    expect(loaded.orderedProjection).toBeNull();
    expect(loaded.multiLineProjection).toBeNull();
    expect(loaded.originalText).toBe(text);
  });

  it("a callout-containing continuation falls back to raw", () => {
    const text = ["- 一行目", "  > [!note] 備考", "  > 本文"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.multiLineProjection).toBeNull();
    expect(loaded.originalText).toBe(text);
  });

  it("a blockquote-containing continuation falls back to raw", () => {
    const text = ["- 一行目", "  > 引用"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.multiLineProjection).toBeNull();
  });

  it("a fenced-code-containing continuation falls back to raw", () => {
    const text = ["- 一行目", "  ```", "  code", "  ```"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.multiLineProjection).toBeNull();
  });

  it("a table-containing continuation falls back to raw", () => {
    const text = ["- 一行目", "  | a | b |", "  | - | - |", "  | 1 | 2 |"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.multiLineProjection).toBeNull();
  });

  it("a thematic-break-containing continuation falls back to raw", () => {
    const text = ["- 一行目", "  補足", "  ***"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.multiLineProjection).toBeNull();
  });

  it("malformed (too-shallow) continuation indentation falls back to raw — BUILD-time, never a hard error", () => {
    const text = ["- 一行目", " 不十分な字下げ"].join("\n");
    const doc = parseDocument(text);
    const node = doc.nodes.get("li-0");
    // Structurally still eligible (no child list, no ComplexBlock) — the
    // refusal is purely a buildMultiLineListItemProjection-level one.
    expect(node && isListNode(node) && isStandaloneMultiLineLeafListItemEligibleForProjection(node)).toBe(
      true
    );
    const extracted = extractSubtreeText(doc, "li-0");
    const built = buildMultiLineListItemProjection(extracted.text);
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error("expected refusal");
    expect(built.reason).toBe("malformed-continuation-indent");
  });

  it("an unsupported checkbox status on the first line falls back to raw (first-line-not-projectable)", () => {
    const text = ["- [~] 未対応のステータス", "  続き"].join("\n");
    const doc = parseDocument(text);
    const extracted = extractSubtreeText(doc, "li-0");
    const built = buildMultiLineListItemProjection(extracted.text);
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error("expected refusal");
    expect(built.reason).toBe("first-line-not-projectable");
  });

  it("a genuinely single-line item passed directly to buildMultiLineListItemProjection is refused with 'single-line' (defensive — loadStandalone's own eligibility gate never reaches this)", () => {
    const built = buildMultiLineListItemProjection("- 一行だけ");
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error("expected refusal");
    expect(built.reason).toBe("single-line");
  });
});

describe("Phase 5L-5 (\"Leaf List Item Blank-Line Continuation Projection\"): structured Apply with blank lines in the continuation body — full real pipeline", () => {
  it("unordered: a trailing blank line typed into the edited body is silently dropped on Apply (no raw trailing blank line written)", () => {
    const loaded = loadStandalone(["- 一行目", "  二行目"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "編集後の一行目\n編集後の二行目\n\n");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe(["- 編集後の一行目", "  編集後の二行目"].join("\n"));
    expect(result.outcome.lines).toEqual(["- 編集後の一行目", "  編集後の二行目"]);
  });

  it("task: a trailing blank line is dropped while the checkbox change is still applied", () => {
    const loaded = loadStandalone(["- [ ] 一行目", "  続き"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, true, "", "一行目\n続き\n\n\n");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe(["- [x] 一行目", "  続き"].join("\n"));
  });

  it("ordered: a trailing blank line is dropped while the number change is still applied", () => {
    const loaded = loadStandalone(["1. 一行目", "   続き"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "3", "一行目\n続き\n");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe(["3. 一行目", "   続き"].join("\n"));
  });

  it("a MID-continuation blank line (paragraph break) round-trips through the full pipeline, unedited", () => {
    const text = ["- 一段落目", "  続き", "", "  二段落目"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.multiLineProjection).not.toBeNull();
    expect(projectedMultiLineBodyText(loaded.multiLineProjection!)).toBe("一段落目\n続き\n\n二段落目");
    const result = applyStandaloneMultiLine(
      loaded,
      false,
      "",
      projectedMultiLineBodyText(loaded.multiLineProjection!)
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe(text);
  });

  it("adding a NEW blank line to split the body into two paragraphs is a valid Apply", () => {
    const loaded = loadStandalone(["- 一行目", "  結合されている本文"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "一行目\n一段落目\n\n二段落目");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual(["- 一行目", "  一段落目", "", "  二段落目"]);
  });

  it("removing a mid-continuation blank line (merging two paragraphs back into one) is a valid Apply", () => {
    const text = ["- 一行目", "  一段落目", "", "  二段落目"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "一行目\n一段落目\n二段落目（結合）");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual(["- 一行目", "  一段落目", "  二段落目（結合）"]);
  });

  it("adding CONSECUTIVE blank lines mid-body (an extra paragraph break) is a valid Apply, and every blank line is preserved exactly", () => {
    const loaded = loadStandalone(["- 一行目", "  本文"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "一行目\n一段落目\n\n\n二段落目");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual(["- 一行目", "  一段落目", "", "", "  二段落目"]);
  });

  it("a multi-line paste that itself contains a blank line (pasting two paragraphs at once) is a valid Apply", () => {
    const loaded = loadStandalone(["- 一行目", "  既存の本文"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "一行目\n貼り付け1段落目\n\n貼り付け2段落目\n既存の本文");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual([
      "- 一行目",
      "  貼り付け1段落目",
      "",
      "  貼り付け2段落目",
      "  既存の本文",
    ]);
  });

  it("simultaneous marker(number)+body(with a blank line)+ trailing-blank edit in one Apply applies everything together, with indentation preserved", () => {
    const loaded = loadStandalone(["1. 元の一行目", "   元の続き"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "8", "新一行目\n一段落目\n\n二段落目\n\n");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual(["8. 新一行目", "   一段落目", "", "   二段落目"]);
  });

  it("re-opening the item after an Apply that added a mid-continuation blank line correctly reloads the blank-line-containing structured body", () => {
    const loaded = loadStandalone(["- 一行目", "  本文"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "一行目\n一段落目\n\n二段落目");
    if (!result.ok) throw new Error("expected ok");
    const reloaded = loadStandalone(result.outcome.lines.join("\n"), "li-0");
    expect(reloaded.multiLineProjection).not.toBeNull();
    expect(projectedMultiLineBodyText(reloaded.multiLineProjection!)).toBe("一行目\n一段落目\n\n二段落目");
  });

  it("out-of-range Markdown (a preceding heading and a following sibling item) never changes when the edited body contains blank lines", () => {
    const text = ["# 見出し", "- 前の項目", "- 一行目", "  本文", "- 後の項目"].join("\n");
    const loaded = loadStandalone(text, "li-1");
    const result = applyStandaloneMultiLine(loaded, false, "", "編集後の一行目\n一段落目\n\n二段落目\n");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual([
      "# 見出し",
      "- 前の項目",
      "- 編集後の一行目",
      "  一段落目",
      "",
      "  二段落目",
      "- 後の項目",
    ]);
  });
});

describe("Phase 5L-5: blank-line-adjacent scenarios resolve exactly per the confirmed real parser behavior (not assumption)", () => {
  it("blank-line-then-SIBLING-ITEM: the trailing blank is NOT part of this item's own range at all (the parser trims it before closing) — the item loads/builds/Applies completely normally, and the blank line + sibling are simply untouched, out-of-range content", () => {
    const text = ["- 一行目", "  本文", "", "- 別の項目"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.multiLineProjection).not.toBeNull();
    expect(loaded.originalText).toBe(["- 一行目", "  本文"].join("\n"));
    const result = applyStandaloneMultiLine(loaded, false, "", "編集後の一行目\n編集後の本文");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual(["- 編集後の一行目", "  編集後の本文", "", "- 別の項目"]);
  });

  it("blank-line-then-HEADING: identically to the sibling case, the trailing blank (and the heading) are NOT part of this item's own range — loads/builds/Applies normally, heading untouched", () => {
    const text = ["- 一行目", "  本文", "", "# 見出し"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.multiLineProjection).not.toBeNull();
    expect(loaded.originalText).toBe(["- 一行目", "  本文"].join("\n"));
    const result = applyStandaloneMultiLine(loaded, false, "", "編集後の一行目\n編集後の本文");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual(["- 編集後の一行目", "  編集後の本文", "", "# 見出し"]);
  });

  it("blank-line-then-CALLOUT: unlike a trailing blank at end-of-range, a blank line followed by MORE non-blank content (here a callout) IS absorbed into the item's own range — this correctly falls back to raw editing via the existing ComplexBlock eligibility gate, with zero Phase 5L-5-specific logic", () => {
    const text = ["- 一行目", "", "  > [!note] タイトル", "  > 本文"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.multiLineProjection).toBeNull();
    expect(loaded.originalText).toBe(text);
  });

  it("blank-line-then-BLOCKQUOTE: same absorption behavior as callout — raw fallback", () => {
    const text = ["- 一行目", "", "  > 引用"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.multiLineProjection).toBeNull();
    expect(loaded.originalText).toBe(text);
  });

  it("blank-line-then-FENCED-CODE: same absorption behavior — raw fallback", () => {
    const text = ["- 一行目", "", "  ```", "  code", "  ```"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.multiLineProjection).toBeNull();
    expect(loaded.originalText).toBe(text);
  });

  it("blank-line-then-TABLE: same absorption behavior — raw fallback", () => {
    const text = ["- 一行目", "", "  | a | b |", "  | - | - |", "  | 1 | 2 |"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.multiLineProjection).toBeNull();
    expect(loaded.originalText).toBe(text);
  });

  it("blank-line-then-deeper-indented-list-marker-looking-line: correctly parsed as a genuine nested CHILD list item (childIds populated) — raw fallback via the existing eligibility gate, no new logic required", () => {
    const text = ["- 一行目", "  本文", "", "  - 子項目っぽい行"].join("\n");
    const doc = parseDocument(text);
    const node = doc.nodes.get("li-0");
    expect(node && isListNode(node) && node.childIds.length > 0).toBe(true);
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.multiLineProjection).toBeNull();
  });
});

describe("Phase 5L-5: Apply-rejection scenarios specific to blank-line-containing edits", () => {
  it("a body edit that adds a blank line and then a line that would manufacture a nested CHILD LIST is refused with 'unsafe-structure', and every draft field is preserved", () => {
    const loaded = loadStandalone(["- 一行目", "  本文"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "一行目\n\n- 子リストのように見える行");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("unsafe-structure");
    expect(loaded.doc.lines).toEqual(["- 一行目", "  本文"]);
  });

  it("a body edit that adds a blank line and then a BLOCKQUOTE-looking line is refused with 'unsafe-structure'", () => {
    const loaded = loadStandalone(["- 一行目", "  本文"].join("\n"), "li-0");
    const result = applyStandaloneMultiLine(loaded, false, "", "一行目\n\n> 引用のように見える行");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("unsafe-structure");
  });

  it("a stale-snapshot conflict is still detected (and every draft field preserved) when the edited body itself contains a blank line", () => {
    const loaded = loadStandalone(["- 一行目", "  本文"].join("\n"), "li-0");
    const externallyEditedDoc = parseDocument(["- 他者による変更後", "  変更後の本文"].join("\n"));
    const inverted = invertMultiLineListItemProjection(
      loaded.multiLineProjection!,
      false,
      "",
      "編集後の一行目\n一段落目\n\n二段落目"
    );
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    const outcome = applySubtreeEdit(externallyEditedDoc, "li-0", loaded.originalText, inverted.rawText);
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("conflict");
  });
});

/**
 * Phase 5L-3 ("Ordered List Marker-Free Partial Edit"): end-to-end
 * integration tests that reproduce view/PartialEditView.ts's own
 * loadNodeInternal (list branch) / buildStandaloneListProjections /
 * applyEdit (standalone node branch, ordered-list arm) EXACTLY, using the
 * real, unmodified backend functions they call (parser/parseDocument.ts,
 * edit/partialEdit.ts, edit/standaloneListMarkerProjection.ts,
 * edit/standaloneTaskListProjection.ts, edit/standaloneOrderedListProjection.ts,
 * edit/listMarkerProjection.ts, edit/taskListProjection.ts,
 * edit/orderedListProjection.ts) — never a mock, never a hand-typed
 * snapshot for a success-path fixture. Mirrors
 * tests/taskListMarkerPartialEdit.test.ts's own structure exactly, since
 * this file is that one's ordered-list counterpart.
 * tests/orderedListPartialEditUiWiring.test.ts (a separate file) covers
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
import { buildListMarkerProjection, ListMarkerProjection } from "../src/edit/listMarkerProjection";
import { buildTaskListProjection, TaskListProjection } from "../src/edit/taskListProjection";
import {
  buildOrderedListProjection,
  invertOrderedListProjection,
  OrderedListProjection,
} from "../src/edit/orderedListProjection";

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

/** Reproduces loadNodeInternal's own list-branch gate exactly. */
function loadStandalone(text: string, nodeId: string) {
  const doc = parseDocument(text);
  const extracted = extractSubtreeText(doc, nodeId);
  expect(extracted.ok).toBe(true);
  const node = doc.nodes.get(nodeId);
  const listEligible =
    extracted.kind === "list" && !!node && isListNode(node) &&
    isStandaloneListItemEligibleForMarkerFreeProjection(node);
  const taskEligible =
    extracted.kind === "list" && !!node && isListNode(node) &&
    isStandaloneTaskListItemEligibleForMarkerFreeProjection(node);
  const orderedEligible =
    extracted.kind === "list" && !!node && isListNode(node) &&
    isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node);
  const { list, task, ordered } = buildStandaloneListProjections(
    listEligible,
    taskEligible,
    orderedEligible,
    extracted.text
  );
  return {
    doc,
    nodeId,
    originalText: extracted.text,
    listProjection: list,
    taskProjection: task,
    orderedProjection: ordered,
  };
}

type Loaded = ReturnType<typeof loadStandalone>;

/** Reproduces applyEdit's own standalone-node branch (ordered-list arm) exactly. */
function applyStandaloneOrdered(loaded: Loaded, editedNumberText: string, editedBody: string) {
  if (!loaded.orderedProjection) throw new Error("test setup error: no ordered projection loaded");
  const inverted = invertOrderedListProjection(loaded.orderedProjection, editedNumberText, editedBody);
  if (!inverted.ok) return { ok: false as const, reason: inverted.reason };
  const outcome = applySubtreeEdit(loaded.doc, loaded.nodeId, loaded.originalText, inverted.rawLine);
  return { ok: true as const, outcome, newRawText: inverted.rawLine };
}

describe("Phase 5L-3: ordered-list marker-free projection on real single-item fixtures", () => {
  it("a '.' delimiter ordered leaf item projects marker-free with its number captured verbatim", () => {
    const loaded = loadStandalone("1. 未確認の史料", "li-0");
    expect(loaded.listProjection).toBeNull();
    expect(loaded.taskProjection).toBeNull();
    expect(loaded.orderedProjection).not.toBeNull();
    expect(loaded.orderedProjection!.number).toBe("1");
    expect(loaded.orderedProjection!.delimiter).toBe(".");
    expect(loaded.orderedProjection!.body).toBe("未確認の史料");
  });

  it("a ')' delimiter ordered leaf item projects marker-free, delimiter captured but never editable", () => {
    const loaded = loadStandalone("1) 校合済みの転写", "li-0");
    expect(loaded.orderedProjection).not.toBeNull();
    expect(loaded.orderedProjection!.delimiter).toBe(")");
    expect(loaded.orderedProjection!.body).toBe("校合済みの転写");
  });

  it("a multi-digit number is preserved verbatim, including a leading-zero-padded number", () => {
    const twelve = loadStandalone("12. 別系統の検討", "li-0");
    expect(twelve.orderedProjection!.number).toBe("12");
    const padded = loadStandalone("007. 桁揃えされた番号", "li-0");
    expect(padded.orderedProjection!.number).toBe("007");
  });

  it("an indented leaf ordered item (nested under a parent) projects marker-free with its indentation captured", () => {
    const doc = parseDocument(["- 親項目", "  1. 入れ子の leaf item"].join("\n"));
    const extracted = extractSubtreeText(doc, "li-1");
    expect(extracted.ok).toBe(true);
    const node = doc.nodes.get("li-1");
    expect(
      node && isListNode(node) && isStandaloneOrderedListItemEligibleForMarkerFreeProjection(node)
    ).toBe(true);
    const built = buildOrderedListProjection(extracted.text);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.projection.indent).toBe("  ");
      expect(built.projection.body).toBe("入れ子の leaf item");
    }
  });

  it("an unordered item on the SAME code path still projects via ListMarkerProjection, never OrderedListProjection — Phase 5L-1 regression guard", () => {
    const loaded = loadStandalone("- 通常のリスト項目", "li-0");
    expect(loaded.orderedProjection).toBeNull();
    expect(loaded.listProjection).not.toBeNull();
    expect(loaded.listProjection!.body).toBe("通常のリスト項目");
  });
});

describe("Phase 5L-3: Apply preserves the number/delimiter/indentation and writes back through the existing applySubtreeEdit path", () => {
  it("editing ONLY the body (number untouched) restores '1. ' byte-for-byte", () => {
    const loaded = loadStandalone("1. 原本と写本を照合する", "li-0");
    const result = applyStandaloneOrdered(loaded, "1", "編集後の確認事項");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe("1. 編集後の確認事項");
    expect(result.outcome.changed).toBe(true);
    expect(result.outcome.lines[0]).toBe("1. 編集後の確認事項");
  });

  it("editing ONLY the number (body untouched) writes the new number and preserves body text exactly", () => {
    const loaded = loadStandalone("1. 原本と写本を照合する", "li-0");
    const result = applyStandaloneOrdered(loaded, "2", loaded.orderedProjection!.body);
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe("2. 原本と写本を照合する");
    expect(result.outcome.lines[0]).toBe("2. 原本と写本を照合する");
  });

  it("editing BOTH number and body in the same Apply applies both changes together", () => {
    const loaded = loadStandalone("1. 原本と写本を照合する", "li-0");
    const result = applyStandaloneOrdered(loaded, "42", "校合作業を完了した");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe("42. 校合作業を完了した");
  });

  it("the ')' delimiter is preserved unchanged across a number+body edit — delimiter is structurally never an edited field", () => {
    const loaded = loadStandalone("1) 別系統の検討", "li-0");
    const result = applyStandaloneOrdered(loaded, "9", "更新後の論点");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe("9) 更新後の論点");
  });

  it("an indented leaf ordered item preserves BOTH the number/delimiter and the indentation, and never disturbs the parent's own line or sibling structure", () => {
    const text = ["- 親項目", "  1. 入れ子の leaf item", "- 別の兄弟項目"].join("\n");
    const doc = parseDocument(text);
    const extracted = extractSubtreeText(doc, "li-1");
    const built = buildOrderedListProjection(extracted.text);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, "3", "完了した子項目");
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawLine).toBe("  3. 完了した子項目");
    const outcome = applySubtreeEdit(doc, "li-1", extracted.text, inverted.rawLine);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- 親項目", "  3. 完了した子項目", "- 別の兄弟項目"]);
  });

  it("typing text that LOOKS like a marker into the body never creates a double marker", () => {
    const loaded = loadStandalone("1. 元の内容", "li-0");
    const result = applyStandaloneOrdered(loaded, "1", "2. 注入されたテキスト");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe("1. 2. 注入されたテキスト");
    expect(result.outcome.lines[0]).toBe("1. 2. 注入されたテキスト");
  });

  it("Markdown constructs in the body (link, embed, bold, inline code, blockquote-looking text, literal digits+period) round-trip verbatim, uncorrupted", () => {
    const loaded = loadStandalone("1. 元の内容", "li-0");
    const body = "[link](https://example.com) ![[embed.png]] **強調** `code` > 引用風 2. テキスト";
    const result = applyStandaloneOrdered(loaded, "1", body);
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe(`1. ${body}`);
    expect(result.outcome.lines[0]).toBe(`1. ${body}`);
  });

  it("clearing the body to empty reconstructs a valid, bare-number list line, not a broken one", () => {
    const loaded = loadStandalone("1. 史料の確認事項", "li-0");
    const result = applyStandaloneOrdered(loaded, "1", "");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText.startsWith("1.")).toBe(true);
    expect(result.outcome.changed).toBe(true);
  });

  it("re-opening the same item after Apply shows the UPDATED number and body, marker-free", () => {
    const loaded = loadStandalone("1. 史料の確認事項", "li-0");
    const result = applyStandaloneOrdered(loaded, "5", "編集後の確認事項");
    if (!result.ok) throw new Error("expected ok");
    const reloaded = loadStandalone(result.outcome.lines.join("\n"), "li-0");
    expect(reloaded.orderedProjection).not.toBeNull();
    expect(reloaded.orderedProjection!.number).toBe("5");
    expect(reloaded.orderedProjection!.body).toBe("編集後の確認事項");
    expect(reloaded.orderedProjection!.delimiter).toBe(".");
  });

  it("no line outside the edited item's own single line changes — range-outside-unchanged", () => {
    const text = ["# 見出し", "1. 前の項目", "2. 史料の確認事項", "3. 後の項目"].join("\n");
    const loaded = loadStandalone(text, "li-1");
    const result = applyStandaloneOrdered(loaded, "2", "編集後の確認事項");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual([
      "# 見出し",
      "1. 前の項目",
      "2. 編集後の確認事項",
      "3. 後の項目",
    ]);
  });

  it("duplicate/non-sequential/reverse-order sibling numbers are NEVER an Apply-rejection reason — no automatic renumbering of siblings is ever performed", () => {
    const text = ["5. 一番目", "5. 二番目（重複番号）", "1. 三番目（逆順）"].join("\n");
    const loaded = loadStandalone(text, "li-1");
    const result = applyStandaloneOrdered(loaded, "5", "編集後の二番目");
    if (!result.ok) throw new Error("expected ok, sibling numbering must never block Apply");
    expect(result.outcome.lines).toEqual(["5. 一番目", "5. 編集後の二番目", "1. 三番目（逆順）"]);
    // The untouched sibling lines are byte-for-byte unchanged — no
    // renumbering side effect was ever applied to them.
    expect(result.outcome.lines[0]).toBe("5. 一番目");
    expect(result.outcome.lines[2]).toBe("1. 三番目（逆順）");
  });
});

describe("Phase 5L-3: genuine safety-error refusal — multiline body edit is rejected, number+body draft preserved, applySubtreeEdit never reached", () => {
  it("a body edit containing a newline is refused with reason 'multiline-body', even when the number was ALSO edited in the same Apply", () => {
    const loaded = loadStandalone("1. 史料の確認事項", "li-0");
    const result = applyStandaloneOrdered(loaded, "2", "1行目\n2行目");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("multiline-body");
    // The original note text is untouched — applySubtreeEdit was never
    // invoked on this path.
    expect(loaded.doc.lines).toEqual(["1. 史料の確認事項"]);
  });
});

describe("Phase 5L-3: strict number validation — every invalid number text is refused with reason 'invalid-number', draft preserved, applySubtreeEdit never reached", () => {
  const cases: Array<[string, string]> = [
    ["empty string", ""],
    ["zero", "0"],
    ["all-zero, multi-digit", "00"],
    ["negative number", "-1"],
    ["decimal point", "1.5"],
    ["exponential notation", "1e2"],
    ["the literal string NaN", "NaN"],
    ["the literal string Infinity", "Infinity"],
    ["leading whitespace", " 1"],
    ["trailing whitespace", "1 "],
    ["internal whitespace", "1 2"],
    ["a plus sign", "+1"],
    ["full-width digits", "１"],
  ];
  it.each(cases)("rejects %s ('%s')", (_label, invalidNumberText) => {
    const loaded = loadStandalone("1. 史料の確認事項", "li-0");
    const result = applyStandaloneOrdered(loaded, invalidNumberText, loaded.orderedProjection!.body);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("invalid-number");
    expect(loaded.doc.lines).toEqual(["1. 史料の確認事項"]);
  });

  it("a body edit ALSO present in the same Apply is preserved (never silently applied) when the number is invalid", () => {
    const loaded = loadStandalone("1. 元の内容", "li-0");
    const result = applyStandaloneOrdered(loaded, "0", "編集されたが適用されないはずの本文");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("invalid-number");
    expect(loaded.doc.lines).toEqual(["1. 元の内容"]);
  });
});

describe("Phase 5L-3: stale snapshot conflict is refused by the EXISTING, unmodified applySubtreeEdit safety check", () => {
  it("Apply is refused with reason 'conflict' when the note changed elsewhere since load, and the draft/original doc are unaffected", () => {
    const loaded = loadStandalone("1. 史料の確認事項", "li-0");
    const externallyEditedDoc = parseDocument("1. 他者による変更後の内容");
    const outcome = applySubtreeEdit(
      externallyEditedDoc,
      "li-0",
      loaded.originalText,
      "2. 編集後の確認事項"
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("conflict");
  });
});

describe("Phase 5L-3: ineligible/unsupported structures fall back to the raw list row (never refused, never treated as an error)", () => {
  it("an ordered task-list item ('1. [ ] ...') is out of this ticket's scope entirely — buildListMarkerProjection's own 'ordered-marker' refusal (marker shape is checked before body content) routes it to buildOrderedListProjection, which itself refuses with 'task-list-marker' on the checkbox body, so ALL THREE projections stay null and it falls back to raw, exactly like an unordered task-list item did in Phase 5L-2 before this ticket, and exactly as edit/orderedListProjection.ts's own top doc comment documents", () => {
    const loaded = loadStandalone("1. [ ] 史料の確認事項", "li-0");
    expect(loaded.orderedProjection).toBeNull();
    expect(loaded.listProjection).toBeNull();
    expect(loaded.taskProjection).toBeNull();
    expect(loaded.originalText).toBe("1. [ ] 史料の確認事項");
  });

  it("a multi-line ordered item (continuation paragraph) falls back to raw — the WHOLE subtree text is what the raw fallback shows and Applies", () => {
    const text = ["1. 項目本文", "   続きの段落。"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.orderedProjection).toBeNull();
    expect(loaded.listProjection).toBeNull();
    expect(loaded.taskProjection).toBeNull();
    expect(loaded.originalText).toBe(text);
  });

  it("a parent ordered item that owns a nested child list falls back to raw", () => {
    const text = ["1. 親項目", "   1. 子項目"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.orderedProjection).toBeNull();
    expect(loaded.listProjection).toBeNull();
    expect(loaded.taskProjection).toBeNull();
    expect(loaded.originalText).toBe(text);
  });

  it("CompositeBlock-adjacent ordered items are out of this ticket's scope and never reach a CompositeBlock code path at all — reproduced here by confirming an ordered item immediately followed by a callout (a CompositeBlock shape) still projects fine on its OWN nodeId, independent of the trailing member", () => {
    const text = ["1. 史料の確認事項", "> [!note] 備考"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.orderedProjection).not.toBeNull();
    expect(loaded.orderedProjection!.body).toBe("史料の確認事項");
  });
});

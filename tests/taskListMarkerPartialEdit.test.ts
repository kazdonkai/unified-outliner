/**
 * Phase 5L-2 ("Task List Marker-Free Partial Edit"): end-to-end
 * integration tests that reproduce view/PartialEditView.ts's own
 * loadNodeInternal (list branch) / buildStandaloneListProjections /
 * applyEdit (standalone node branch, task-list arm) EXACTLY, using the
 * real, unmodified backend functions they call (parser/parseDocument.ts,
 * edit/partialEdit.ts, edit/standaloneListMarkerProjection.ts,
 * edit/standaloneTaskListProjection.ts, edit/listMarkerProjection.ts,
 * edit/taskListProjection.ts) — never a mock, never a hand-typed snapshot
 * for a success-path fixture. Mirrors
 * tests/standaloneListMarkerPartialEdit.test.ts's own structure exactly,
 * since this file is that one's task-list counterpart.
 * tests/taskListPartialEditUiWiring.test.ts (a separate file) covers the
 * actual View wiring — that this exact sequence of function calls is
 * really what loadNodeInternal/applyEdit's source does.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { extractSubtreeText, applySubtreeEdit } from "../src/edit/partialEdit";
import { isListNode } from "../src/model/block";
import { isStandaloneListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneListMarkerProjection";
import { isStandaloneTaskListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneTaskListProjection";
import { buildListMarkerProjection, ListMarkerProjection } from "../src/edit/listMarkerProjection";
import {
  buildTaskListProjection,
  invertTaskListProjection,
  TaskListProjection,
} from "../src/edit/taskListProjection";

/** Reproduces view/PartialEditView.ts's own buildStandaloneListProjections exactly. */
function buildStandaloneListProjections(
  listEligible: boolean,
  taskEligible: boolean,
  rawLine: string
): { list: ListMarkerProjection | null; task: TaskListProjection | null } {
  if (!listEligible) return { list: null, task: null };
  const built = buildListMarkerProjection(rawLine);
  if (built.ok) return { list: built.projection, task: null };
  if (built.reason === "task-list-marker" && taskEligible) {
    const taskBuilt = buildTaskListProjection(rawLine);
    return { list: null, task: taskBuilt.ok ? taskBuilt.projection : null };
  }
  return { list: null, task: null };
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
  const { list, task } = buildStandaloneListProjections(listEligible, taskEligible, extracted.text);
  return { doc, nodeId, originalText: extracted.text, listProjection: list, taskProjection: task };
}

type Loaded = ReturnType<typeof loadStandalone>;

/** Reproduces applyEdit's own standalone-node branch (task-list arm) exactly. */
function applyStandaloneTask(loaded: Loaded, checked: boolean, editedBody: string) {
  if (!loaded.taskProjection) throw new Error("test setup error: no task projection loaded");
  const inverted = invertTaskListProjection(loaded.taskProjection, checked, editedBody);
  if (!inverted.ok) return { ok: false as const, reason: inverted.reason };
  const outcome = applySubtreeEdit(loaded.doc, loaded.nodeId, loaded.originalText, inverted.rawLine);
  return { ok: true as const, outcome, newRawText: inverted.rawLine };
}

describe("Phase 5L-2: task-list marker-free projection on real single-item fixtures", () => {
  it("an unchecked '-' marker task leaf item projects marker-free/checkbox-free", () => {
    const loaded = loadStandalone("- [ ] 未確認の史料", "li-0");
    expect(loaded.listProjection).toBeNull();
    expect(loaded.taskProjection).not.toBeNull();
    expect(loaded.taskProjection!.marker).toBe("-");
    expect(loaded.taskProjection!.checked).toBe(false);
    expect(loaded.taskProjection!.body).toBe("未確認の史料");
  });

  it("a checked '-' marker task leaf item projects with checked: true", () => {
    const loaded = loadStandalone("- [x] 校合済みの転写", "li-0");
    expect(loaded.taskProjection).not.toBeNull();
    expect(loaded.taskProjection!.checked).toBe(true);
    expect(loaded.taskProjection!.body).toBe("校合済みの転写");
  });

  it("'*' and '+' marker task items both project marker-free/checkbox-free", () => {
    const star = loadStandalone("* [ ] 別系統の検討", "li-0");
    const plus = loadStandalone("+ [X] 確認済みの論点", "li-0");
    expect(star.taskProjection!.marker).toBe("*");
    expect(plus.taskProjection!.marker).toBe("+");
    expect(plus.taskProjection!.checked).toBe(true);
  });

  it("an indented leaf task item (nested under a parent) projects marker-free/checkbox-free with its indentation captured", () => {
    const doc = parseDocument(["- 親項目", "  - [ ] 入れ子の leaf task"].join("\n"));
    const extracted = extractSubtreeText(doc, "li-1");
    expect(extracted.ok).toBe(true);
    const node = doc.nodes.get("li-1");
    expect(
      node && isListNode(node) && isStandaloneTaskListItemEligibleForMarkerFreeProjection(node)
    ).toBe(true);
    const built = buildTaskListProjection(extracted.text);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.projection.indent).toBe("  ");
      expect(built.projection.body).toBe("入れ子の leaf task");
    }
  });

  it("a non-task item on the SAME code path still projects via ListMarkerProjection, never TaskListProjection — Phase 5L-1 regression guard", () => {
    const loaded = loadStandalone("- 通常のリスト項目", "li-0");
    expect(loaded.taskProjection).toBeNull();
    expect(loaded.listProjection).not.toBeNull();
    expect(loaded.listProjection!.body).toBe("通常のリスト項目");
  });
});

describe("Phase 5L-2: Apply preserves marker/checkbox/indentation and writes back through the existing applySubtreeEdit path", () => {
  it("editing ONLY the body (checkbox untouched) restores '- [ ] ' byte-for-byte", () => {
    const loaded = loadStandalone("- [ ] 原本と写本を照合する", "li-0");
    const result = applyStandaloneTask(loaded, false, "編集後の確認事項");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe("- [ ] 編集後の確認事項");
    expect(result.outcome.changed).toBe(true);
    expect(result.outcome.lines[0]).toBe("- [ ] 編集後の確認事項");
  });

  it("toggling ONLY the checkbox (body untouched) writes the canonical checked marker and preserves body text exactly", () => {
    const loaded = loadStandalone("- [ ] 原本と写本を照合する", "li-0");
    const result = applyStandaloneTask(loaded, true, loaded.taskProjection!.body);
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe("- [x] 原本と写本を照合する");
    expect(result.outcome.lines[0]).toBe("- [x] 原本と写本を照合する");
  });

  it("editing BOTH checkbox and body in the same Apply applies both changes together", () => {
    const loaded = loadStandalone("- [ ] 原本と写本を照合する", "li-0");
    const result = applyStandaloneTask(loaded, true, "校合作業を完了した");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe("- [x] 校合作業を完了した");
  });

  it("unchecking a checked item preserves the '*' marker", () => {
    const loaded = loadStandalone("* [x] 別系統の検討", "li-0");
    const result = applyStandaloneTask(loaded, false, loaded.taskProjection!.body);
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe("* [ ] 別系統の検討");
  });

  it("an indented leaf task item preserves BOTH the marker/checkbox and the indentation, and never disturbs the parent's own line or sibling structure", () => {
    const text = ["- 親項目", "  - [ ] 入れ子の leaf task", "- 別の兄弟項目"].join("\n");
    const doc = parseDocument(text);
    const extracted = extractSubtreeText(doc, "li-1");
    const built = buildTaskListProjection(extracted.text);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertTaskListProjection(built.projection, true, "完了した子タスク");
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawLine).toBe("  - [x] 完了した子タスク");
    const outcome = applySubtreeEdit(doc, "li-1", extracted.text, inverted.rawLine);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- 親項目",
      "  - [x] 完了した子タスク",
      "- 別の兄弟項目",
    ]);
  });

  it("typing text that LOOKS like a marker/checkbox into the body never creates a double marker/checkbox", () => {
    const loaded = loadStandalone("- [ ] 元の内容", "li-0");
    const result = applyStandaloneTask(loaded, false, "- [x] 注入されたテキスト");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe("- [ ] - [x] 注入されたテキスト");
    expect(result.outcome.lines[0]).toBe("- [ ] - [x] 注入されたテキスト");
  });

  it("Markdown constructs in the body (link, embed, bold, inline code, blockquote-looking text, literal '[ ]') round-trip verbatim, uncorrupted", () => {
    const loaded = loadStandalone("- [ ] 元の内容", "li-0");
    const body = "[link](https://example.com) ![[embed.png]] **強調** `code` > 引用風 [ ] テキスト";
    const result = applyStandaloneTask(loaded, false, body);
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe(`- [ ] ${body}`);
    expect(result.outcome.lines[0]).toBe(`- [ ] ${body}`);
  });

  it("clearing the body to empty reconstructs a valid, bare-checkbox list line, not a broken one", () => {
    const loaded = loadStandalone("- [ ] 史料の確認事項", "li-0");
    const result = applyStandaloneTask(loaded, false, "");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText.startsWith("- [ ]")).toBe(true);
    expect(result.outcome.changed).toBe(true);
  });

  it("re-opening the same item after Apply shows the UPDATED checkbox state and body, marker-free/checkbox-free", () => {
    const loaded = loadStandalone("- [ ] 史料の確認事項", "li-0");
    const result = applyStandaloneTask(loaded, true, "編集後の確認事項");
    if (!result.ok) throw new Error("expected ok");
    const reloaded = loadStandalone(result.outcome.lines.join("\n"), "li-0");
    expect(reloaded.taskProjection).not.toBeNull();
    expect(reloaded.taskProjection!.checked).toBe(true);
    expect(reloaded.taskProjection!.body).toBe("編集後の確認事項");
    expect(reloaded.taskProjection!.marker).toBe("-");
  });

  it("no line outside the edited item's own single line changes — range-outside-unchanged", () => {
    const text = ["# 見出し", "- [ ] 前の項目", "- [ ] 史料の確認事項", "- [ ] 後の項目"].join("\n");
    const loaded = loadStandalone(text, "li-1");
    const result = applyStandaloneTask(loaded, true, "編集後の確認事項");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual([
      "# 見出し",
      "- [ ] 前の項目",
      "- [x] 編集後の確認事項",
      "- [ ] 後の項目",
    ]);
  });
});

describe("Phase 5L-2: genuine safety-error refusal — multiline body edit is rejected, checkbox+body draft preserved, applySubtreeEdit never reached", () => {
  it("a body edit containing a newline is refused with reason 'multiline-body', even when the checkbox was ALSO toggled in the same Apply", () => {
    const loaded = loadStandalone("- [ ] 史料の確認事項", "li-0");
    const result = applyStandaloneTask(loaded, true, "1行目\n2行目");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("multiline-body");
    // The original note text is untouched — applySubtreeEdit was never
    // invoked on this path.
    expect(loaded.doc.lines).toEqual(["- [ ] 史料の確認事項"]);
  });
});

describe("Phase 5L-2: stale snapshot conflict is refused by the EXISTING, unmodified applySubtreeEdit safety check", () => {
  it("Apply is refused with reason 'conflict' when the note changed elsewhere since load, and the draft/original doc are unaffected", () => {
    const loaded = loadStandalone("- [ ] 史料の確認事項", "li-0");
    const externallyEditedDoc = parseDocument("- [ ] 他者による変更後の内容");
    const outcome = applySubtreeEdit(
      externallyEditedDoc,
      "li-0",
      loaded.originalText,
      "- [x] 編集後の確認事項"
    );
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("conflict");
  });
});

describe("Phase 5L-2: ineligible/unsupported structures fall back to the raw list row (never refused, never treated as an error)", () => {
  it("an ordered-marker task-like item is never structurally eligible — no projection is attempted at all", () => {
    const loaded = loadStandalone("1. [ ] 史料の確認事項", "li-0");
    expect(loaded.listProjection).toBeNull();
    expect(loaded.taskProjection).toBeNull();
    expect(loaded.originalText).toBe("1. [ ] 史料の確認事項");
  });

  it("a multi-line task item (continuation paragraph) falls back to raw — the WHOLE subtree text is what the raw fallback shows and Applies", () => {
    const text = ["- [ ] 項目本文", "  続きの段落。"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.listProjection).toBeNull();
    expect(loaded.taskProjection).toBeNull();
    expect(loaded.originalText).toBe(text);
  });

  it("a parent task item that owns a nested child list falls back to raw", () => {
    const text = ["- [ ] 親タスク", "  - [ ] 子タスク"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.listProjection).toBeNull();
    expect(loaded.taskProjection).toBeNull();
    expect(loaded.originalText).toBe(text);
  });

  it("an unsupported checkbox status ('- [/] ...') is structurally eligible but buildTaskListProjection itself refuses it — falls back to raw, both projections null", () => {
    const loaded = loadStandalone("- [/] 進行中の項目", "li-0");
    expect(loaded.listProjection).toBeNull();
    expect(loaded.taskProjection).toBeNull();
    expect(loaded.originalText).toBe("- [/] 進行中の項目");
  });

  it("CompositeBlock member task list items are out of this ticket's scope and never reach this standalone code path at all — reproduced here by confirming a task item immediately followed by a callout (a CompositeBlock shape) still projects fine on its OWN nodeId, independent of the trailing member", () => {
    const text = ["- [ ] 史料の確認事項", "> [!note] 備考"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.taskProjection).not.toBeNull();
    expect(loaded.taskProjection!.body).toBe("史料の確認事項");
  });
});

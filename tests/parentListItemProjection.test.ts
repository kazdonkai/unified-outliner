/**
 * Phase 5L-6 ("Parent List Item Structured Partial Edit"): unit tests for
 * edit/parentListItemProjection.ts's own pure resolveParentListItemOwnTextRange
 * / buildParentListItemProjection / invertParentListItemProjection /
 * applyParentListItemOwnTextEdit quartet, in isolation from the standalone
 * Partial Edit Pane wiring — mirrors tests/multiLineListItemProjection.test.ts's
 * own structure, the sibling this module's own top doc comment names as its
 * own single-item-leaf counterpart.
 *
 * Every fixture that needs a real ListBlockNode/ParsedDocument goes through
 * the REAL parser (parser/parseDocument.ts) — never a hand-built node
 * literal — matching this project's own "prefer a real fixture over a
 * hand-typed snapshot" convention. The "real pipeline" integration coverage
 * (eligibility gates, View wiring, full loadNodeInternal/applyEdit
 * reproduction) lives in tests/parentListItemStructuredPartialEdit.test.ts
 * and tests/parentListItemPartialEditUiWiring.test.ts instead.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode, ListBlockNode, ParsedDocument } from "../src/model/block";
import {
  applyParentListItemOwnTextEdit,
  buildParentListItemProjection,
  invertParentListItemProjection,
  projectedParentBodyText,
  projectedParentChecked,
  projectedParentNumberText,
  resolveParentListItemOwnTextRange,
} from "../src/edit/parentListItemProjection";

function doc(text: string): ParsedDocument {
  return parseDocument(text);
}

function node(d: ParsedDocument, nodeId: string): ListBlockNode {
  const n = d.nodes.get(nodeId);
  if (!n || !isListNode(n)) {
    throw new Error(`fixture error: ${nodeId} did not resolve to a list node`);
  }
  return n;
}

describe("resolveParentListItemOwnTextRange: eligible shapes", () => {
  it("a single-line unordered parent with one child splits own-text as just its own line", () => {
    const d = doc(["- 親本文", "  - 子1"].join("\n"));
    const result = resolveParentListItemOwnTextRange(d, node(d, "li-0"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.resolution.ownTextRange).toEqual({ startLine: 0, endLine: 0 });
    expect(result.resolution.childSubtreeRange).toEqual({ startLine: 1, endLine: 1 });
  });

  it("a parent with several children: own-text ends right before the FIRST child, child-subtree spans through the LAST child", () => {
    const d = doc(["- 親本文", "  - 子1", "  - 子2", "  - 子3"].join("\n"));
    const result = resolveParentListItemOwnTextRange(d, node(d, "li-0"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.resolution.ownTextRange).toEqual({ startLine: 0, endLine: 0 });
    expect(result.resolution.childSubtreeRange).toEqual({ startLine: 1, endLine: 3 });
  });

  it("a multi-line own-text (continuation before the first child) is captured entirely in ownTextRange", () => {
    const d = doc(["- 親本文", "  続きの行", "  - 子1"].join("\n"));
    const result = resolveParentListItemOwnTextRange(d, node(d, "li-0"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.resolution.ownTextRange).toEqual({ startLine: 0, endLine: 1 });
    expect(result.resolution.childSubtreeRange).toEqual({ startLine: 2, endLine: 2 });
  });

  it("a blank line between the parent's own text and its first child does NOT close the parent item — the blank line is part of own-text, the child still attaches", () => {
    const d = doc(["- 親本文", "", "  - 子1", "  - 子2"].join("\n"));
    const parent = node(d, "li-0");
    expect(parent.childIds.length).toBe(2);
    const result = resolveParentListItemOwnTextRange(d, parent);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.resolution.ownTextRange).toEqual({ startLine: 0, endLine: 1 });
    expect(result.resolution.childSubtreeRange).toEqual({ startLine: 2, endLine: 3 });
  });

  it("a grandchild nesting: only DIRECT children are consulted, not grandchildren — own-text still ends right before the first direct child", () => {
    const d = doc(["- 親本文", "  - 子1", "    - 孫1"].join("\n"));
    const parent = node(d, "li-0");
    expect(parent.childIds.length).toBe(1);
    const result = resolveParentListItemOwnTextRange(d, parent);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.resolution.ownTextRange).toEqual({ startLine: 0, endLine: 0 });
    expect(result.resolution.childSubtreeRange).toEqual({ startLine: 1, endLine: 2 });
  });

  it("a task/ordered parent resolves own-text/child-subtree identically to the unordered case", () => {
    const taskDoc = doc(["- [ ] 親タスク", "  - 子1"].join("\n"));
    const taskResult = resolveParentListItemOwnTextRange(taskDoc, node(taskDoc, "li-0"));
    expect(taskResult.ok).toBe(true);

    const orderedDoc = doc(["1. 親項目", "   - 子1"].join("\n"));
    const orderedResult = resolveParentListItemOwnTextRange(orderedDoc, node(orderedDoc, "li-0"));
    expect(orderedResult.ok).toBe(true);
    if (!orderedResult.ok) throw new Error("expected ok");
    expect(orderedResult.resolution.ownTextRange).toEqual({ startLine: 0, endLine: 0 });
  });

  it("trailing blank lines at the very end of the document (after all children) are trimmed by the parser and never affect the parent's own range", () => {
    const d = doc(["- 親本文", "  - 子1", "", ""].join("\n"));
    const result = resolveParentListItemOwnTextRange(d, node(d, "li-0"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.resolution.childSubtreeRange).toEqual({ startLine: 1, endLine: 1 });
  });
});

describe("resolveParentListItemOwnTextRange: refusals", () => {
  it("refuses ('no-children') a plain leaf item — childIds.length === 0", () => {
    const d = doc("- 一行だけ");
    const result = resolveParentListItemOwnTextRange(d, node(d, "li-0"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("no-children");
  });

  it("refuses ('unsafe-indent') a mixed tab/space indented parent", () => {
    const d = doc(["- 親", "\t - 一行目の親", "\t   - 子1"].join("\n"));
    const nested = node(d, "li-1");
    expect(nested.unsafeIndent).toBe(true);
    const result = resolveParentListItemOwnTextRange(d, nested);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("unsafe-indent");
  });

  it("refuses ('interleaved-content') when a plain continuation-looking line after a closed child gets silently reattached to the parent's own range", () => {
    // Empirically confirmed against the real parser (see this module's own
    // top doc comment): a plain, non-list-marker line placed immediately
    // after a closed child, at the same indent as that child's own marker
    // column, is reattached to the PARENT's own range by
    // parser/parseDocument.ts's own line-ownership-fill pass — so the
    // parent's own range extends PAST its last child's own range.
    const d = doc(["- 親本文", "  - 子1", "  さらに親の続き？"].join("\n"));
    const parent = node(d, "li-0");
    const child = node(d, "li-1");
    expect(parent.range.endLine).toBe(2);
    expect(child.range.endLine).toBe(1);
    const result = resolveParentListItemOwnTextRange(d, parent);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("interleaved-content");
  });
});

describe("buildParentListItemProjection: success shapes", () => {
  it("unordered, single-line own-text: continuationIndent is empty, body is the first line's own body", () => {
    const d = doc(["- 親本文", "  - 子1"].join("\n"));
    const built = buildParentListItemProjection(d, node(d, "li-0"));
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error("expected ok");
    expect(built.projection.ownText.listKind).toBe("unordered");
    expect(built.projection.ownText.continuationIndent).toBe("");
    expect(projectedParentBodyText(built.projection)).toBe("親本文");
    expect(built.projection.expectedChildCount).toBe(1);
    expect(built.projection.childSubtreeText).toBe("  - 子1");
  });

  it("task, single-line own-text: checkbox state captured via projectedParentChecked", () => {
    const uncheckedDoc = doc(["- [ ] 親タスク", "  - 子1"].join("\n"));
    const unchecked = buildParentListItemProjection(uncheckedDoc, node(uncheckedDoc, "li-0"));
    expect(unchecked.ok).toBe(true);
    if (!unchecked.ok) throw new Error("expected ok");
    expect(unchecked.projection.ownText.listKind).toBe("task");
    expect(projectedParentChecked(unchecked.projection)).toBe(false);

    const checkedDoc = doc(["- [x] 親タスク", "  - 子1"].join("\n"));
    const checked = buildParentListItemProjection(checkedDoc, node(checkedDoc, "li-0"));
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error("expected ok");
    expect(projectedParentChecked(checked.projection)).toBe(true);
  });

  it("ordered, single-line own-text: number captured via projectedParentNumberText", () => {
    const d = doc(["12. 親項目", "    - 子1"].join("\n"));
    const built = buildParentListItemProjection(d, node(d, "li-0"));
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error("expected ok");
    expect(built.projection.ownText.listKind).toBe("ordered");
    expect(projectedParentNumberText(built.projection)).toBe("12");
  });

  it("multi-line own-text (continuation + blank line before the first child) delegates to buildMultiLineListItemProjection unmodified", () => {
    const d = doc(["- 親本文", "  続きの説明", "", "  さらに続き", "  - 子1"].join("\n"));
    const built = buildParentListItemProjection(d, node(d, "li-0"));
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error("expected ok");
    expect(built.projection.ownText.continuationIndent).toBe("  ");
    expect(projectedParentBodyText(built.projection)).toBe("親本文\n続きの説明\n\nさらに続き");
  });

  it("a task/ordered own-text row activates the SAME shared shape as the leaf multi-line projection — cross-kind default accessors return false/empty for unordered", () => {
    const d = doc(["- 親本文", "  - 子1"].join("\n"));
    const built = buildParentListItemProjection(d, node(d, "li-0"));
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error("expected ok");
    expect(projectedParentChecked(built.projection)).toBe(false);
    expect(projectedParentNumberText(built.projection)).toBe("");
  });
});

describe("buildParentListItemProjection: propagates resolveParentListItemOwnTextRange's own refusals verbatim", () => {
  it("propagates 'no-children'", () => {
    const d = doc("- 一行だけ");
    const built = buildParentListItemProjection(d, node(d, "li-0"));
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error("expected refusal");
    expect(built.reason).toBe("no-children");
  });

  it("propagates 'interleaved-content'", () => {
    const d = doc(["- 親本文", "  - 子1", "  さらに親の続き？"].join("\n"));
    const built = buildParentListItemProjection(d, node(d, "li-0"));
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error("expected refusal");
    expect(built.reason).toBe("interleaved-content");
  });
});

describe("buildParentListItemProjection: own-text-level refusals (range resolution succeeded, but the own-text substring itself fails to project)", () => {
  it("refuses ('first-line-not-projectable') an unsupported task checkbox status character on the parent's own first line", () => {
    const d = doc(["- [/] 親（未対応ステータス）", "  - 子1"].join("\n"));
    const built = buildParentListItemProjection(d, node(d, "li-0"));
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error("expected refusal");
    expect(built.reason).toBe("first-line-not-projectable");
  });

  it("refuses ('malformed-continuation-indent') a multi-line own-text whose continuation is indented shallower than the canonical prefix", () => {
    const d = doc(["- 親本文", " 足りないインデント", "  - 子1"].join("\n"));
    const built = buildParentListItemProjection(d, node(d, "li-0"));
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error("expected refusal");
    expect(built.reason).toBe("malformed-continuation-indent");
  });
});

describe("invertParentListItemProjection: round trips and edits (own-text only, child subtree never touched)", () => {
  function build(text: string, nodeId = "li-0") {
    const d = doc(text);
    const built = buildParentListItemProjection(d, node(d, nodeId));
    if (!built.ok) throw new Error(`fixture error: ${built.reason}`);
    return built.projection;
  }

  it("an UNEDITED unordered round trip reconstructs the own-text raw substring byte-for-byte", () => {
    const projection = build(["- 親本文", "  - 子1", "  - 子2"].join("\n"));
    const inverted = invertParentListItemProjection(projection, false, "", projection.ownText.body);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.ownTextRawText).toBe("- 親本文");
  });

  it("editing only the checkbox keeps the body untouched and the child subtree is never inspected", () => {
    const projection = build(["- [ ] 親タスク", "  - 子1"].join("\n"));
    const inverted = invertParentListItemProjection(projection, true, "", projection.ownText.body);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.ownTextRawText).toBe("- [x] 親タスク");
  });

  it("editing only the number keeps the body untouched", () => {
    const projection = build(["1. 親項目", "   - 子1"].join("\n"));
    const inverted = invertParentListItemProjection(projection, false, "42", projection.ownText.body);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.ownTextRawText).toBe("42. 親項目");
  });

  it("editing the body of a multi-line own-text (continuation + blank line, ordered) applies all edits together and reconstructs the own-text substring only", () => {
    const projection = build(
      ["1. 親項目", "   続きの説明", "", "   さらに続き", "   - 子1", "   - 子2"].join("\n")
    );
    const editedBody = "編集後の親項目\n編集後の続き\n\n編集後のさらに続き";
    const inverted = invertParentListItemProjection(projection, false, "9", editedBody);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.ownTextRawText).toBe(
      ["9. 編集後の親項目", "   編集後の続き", "", "   編集後のさらに続き"].join("\n")
    );
  });

  it("rejects ('invalid-number') an invalid ordered-number edit, never touching the body", () => {
    const projection = build(["1. 親項目", "   - 子1"].join("\n"));
    for (const badNumber of ["", "0", "-1", "1.5", "abc"]) {
      const inverted = invertParentListItemProjection(projection, false, badNumber, "編集後の本文");
      expect(inverted.ok).toBe(false);
      if (inverted.ok) throw new Error(`expected refusal for ${JSON.stringify(badNumber)}`);
      expect(inverted.reason).toBe("invalid-number");
    }
  });

  it("rejects ('own-text-unsafe-structure') a single-line own-text body edit that introduces a line break — never silently upgraded to a multi-line own-text", () => {
    const projection = build(["- 親本文", "  - 子1"].join("\n"));
    const inverted = invertParentListItemProjection(projection, false, "", "本文\n改行を含む本文");
    expect(inverted.ok).toBe(false);
    if (inverted.ok) throw new Error("expected refusal");
    expect(inverted.reason).toBe("own-text-unsafe-structure");
  });

  it("rejects ('own-text-unsafe-structure') a multi-line continuation edit that would manufacture a FENCED CODE BLOCK once canonically indented", () => {
    const projection = build(["- 親本文", "  続き", "  - 子1"].join("\n"));
    const editedBody = "本文\n```\nコードのように見える行\n```";
    const inverted = invertParentListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(false);
    if (inverted.ok) throw new Error("expected refusal");
    expect(inverted.reason).toBe("own-text-unsafe-structure");
  });

  it("rejects ('own-text-unsafe-structure') a multi-line continuation edit that would itself manufacture a NESTED CHILD list item — the own-text-alone re-parse safety net", () => {
    const projection = build(["- 親本文", "  続き", "  - 子1"].join("\n"));
    const editedBody = "本文\n- 子リストのように見える行";
    const inverted = invertParentListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(false);
    if (inverted.ok) throw new Error("expected refusal");
    expect(inverted.reason).toBe("own-text-unsafe-structure");
  });

  it("does NOT reject when the edited own-text, once spliced with the original child subtree, still safely owns the SAME child count — the splice-safety net's positive case", () => {
    const projection = build(["- 親本文", "  - 子1", "  - 子2"].join("\n"));
    const inverted = invertParentListItemProjection(projection, false, "", "編集後の親本文");
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.ownTextRawText).toBe("- 編集後の親本文");
  });

  it("preserves the exact draft on a rejected Apply — no partial write: ownTextRawText is only returned on ok:true", () => {
    const projection = build(["- 親本文", "  - 子1"].join("\n"));
    const inverted = invertParentListItemProjection(projection, false, "", "本文\n- 危険な行");
    expect(inverted.ok).toBe(false);
    expect((inverted as { ownTextRawText?: string }).ownTextRawText).toBeUndefined();
  });

  it("a trailing blank line typed at the end of a multi-line own-text body is silently trimmed on invert, exactly like the leaf multi-line projection's own Phase 5L-5 policy — even when nothing else in that blank line was edited", () => {
    const projection = build(["- 親本文", "  続き", "  - 子1"].join("\n"));
    const editedBody = "本文\n続き\n";
    const inverted = invertParentListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.ownTextRawText).toBe(["- 本文", "  続き"].join("\n"));
  });
});

describe("applyParentListItemOwnTextEdit: splices ONLY the own-text range, one single splice", () => {
  it("replaces the own-text range and leaves every child-subtree line byte-identical", () => {
    const d = doc(["- 親本文", "  - 子1", "  - 子2"].join("\n"));
    const outcome = applyParentListItemOwnTextEdit(d, "li-0", "- 親本文", "- 編集後の親本文");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- 編集後の親本文", "  - 子1", "  - 子2"]);
    expect(outcome.newStartLine).toBe(0);
  });

  it("a multi-line own-text splice replaces exactly those lines, never touching lines before/after the item", () => {
    const d = doc(["# 見出し", "- 前の項目", "- 親本文", "  続き", "  - 子1", "- 後の項目"].join("\n"));
    const outcome = applyParentListItemOwnTextEdit(
      d,
      "li-1",
      "- 親本文\n  続き",
      "- 編集後の親本文\n  編集後の続き"
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "# 見出し",
      "- 前の項目",
      "- 編集後の親本文",
      "  編集後の続き",
      "  - 子1",
      "- 後の項目",
    ]);
  });

  it("an EXTERNAL change to the child subtree alone NEVER blocks this Apply, since the conflict check only ever compares the own-text substring", () => {
    // Simulates: the pane loaded li-0's own-text as "- 親本文" against the
    // child snapshot "  - 子1", but by Apply time the live document's child
    // subtree has since changed (e.g. a Tree drag-drop, or a direct edit in
    // a child's own Partial Edit session) to a DIFFERENT child body — the
    // own-text itself is still exactly what it was at load time, so the
    // Apply must still succeed.
    const liveDoc = doc(["- 親本文", "  - 変更後の子1"].join("\n"));
    const outcome = applyParentListItemOwnTextEdit(liveDoc, "li-0", "- 親本文", "- 編集後の親本文");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["- 編集後の親本文", "  - 変更後の子1"]);
  });

  it("rejects ('parent-own-text-conflict') when the own-text itself changed externally since the snapshot was taken", () => {
    const liveDoc = doc(["- 外部で変更された親本文", "  - 子1"].join("\n"));
    const outcome = applyParentListItemOwnTextEdit(liveDoc, "li-0", "- 元の親本文", "- 編集後の親本文");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("parent-own-text-conflict");
  });

  it("rejects ('parent-own-text-range-unresolvable') when the node no longer safely separates its own-text from its child subtree (e.g. now interleaved)", () => {
    const liveDoc = doc(["- 親本文", "  - 子1", "  さらに親の続き？"].join("\n"));
    const outcome = applyParentListItemOwnTextEdit(liveDoc, "li-0", "- 親本文", "- 編集後の親本文");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("parent-own-text-range-unresolvable");
  });

  it("rejects ('resolve-failed') when the nodeId no longer resolves at all", () => {
    const d = doc(["- 親本文", "  - 子1"].join("\n"));
    const outcome = applyParentListItemOwnTextEdit(d, "li-999", "- 親本文", "- 編集後の親本文");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("resolve-failed");
  });

  it("rejects ('unsafe-indent') when the resolved node itself carries mixed tab/space indentation", () => {
    const d = doc(["- 親", "\t - 一行目の親", "\t   - 子1"].join("\n"));
    const outcome = applyParentListItemOwnTextEdit(d, "li-1", "- 一行目の親", "- 編集後");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("unsafe-indent");
  });
});

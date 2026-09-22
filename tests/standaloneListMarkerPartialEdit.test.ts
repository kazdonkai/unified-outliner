/**
 * Phase 5L-1 ("Standalone Single-Line Unordered List Marker-Free Partial
 * Edit"): end-to-end integration tests that reproduce view/
 * PartialEditView.ts's own loadNodeInternal (list branch) and applyEdit
 * (standalone node branch) EXACTLY, using the real, unmodified backend
 * functions they call (parser/parseDocument.ts, edit/partialEdit.ts,
 * edit/standaloneListMarkerProjection.ts, edit/listMarkerProjection.ts) —
 * never a mock, never a hand-typed snapshot for a success-path fixture.
 * Nothing here touches an Editor, view/PartialEditView.ts, main.ts, or
 * view/OutlineTreeView.ts — same testing boundary as
 * tests/listMarkerCompositePartialEdit.test.ts (see its own doc comment)
 * and tests/compositeBlockPartialEdit.test.ts.
 * tests/standaloneListMarkerFreePartialEditUiWiring.test.ts (a separate
 * file) covers the actual View wiring — that this exact sequence of
 * function calls is really what loadNodeInternal/applyEdit's source does.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { extractSubtreeText, applySubtreeEdit } from "../src/edit/partialEdit";
import { isListNode } from "../src/model/block";
import { isStandaloneListItemEligibleForMarkerFreeProjection } from "../src/edit/standaloneListMarkerProjection";
import {
  buildListMarkerProjection,
  invertListMarkerProjection,
  ListMarkerProjection,
} from "../src/edit/listMarkerProjection";

/** Reproduces loadNodeInternal's own list-branch gate exactly. */
function loadStandalone(text: string, nodeId: string) {
  const doc = parseDocument(text);
  const extracted = extractSubtreeText(doc, nodeId);
  expect(extracted.ok).toBe(true);
  const node = doc.nodes.get(nodeId);
  const eligible =
    extracted.kind === "list" &&
    !!node &&
    isListNode(node) &&
    isStandaloneListItemEligibleForMarkerFreeProjection(node);
  const built = eligible ? buildListMarkerProjection(extracted.text) : null;
  return {
    doc,
    nodeId,
    originalText: extracted.text,
    projection: (built?.ok ? built.projection : null) as ListMarkerProjection | null,
  };
}

type Loaded = ReturnType<typeof loadStandalone>;

/** Reproduces applyEdit's own standalone-node branch exactly. */
function applyStandalone(loaded: Loaded, editedValue: string) {
  let newRawText: string;
  if (loaded.projection) {
    const inverted = invertListMarkerProjection(loaded.projection, editedValue);
    if (!inverted.ok) return { ok: false as const, reason: inverted.reason };
    newRawText = inverted.rawLine;
  } else {
    newRawText = editedValue;
  }
  const outcome = applySubtreeEdit(loaded.doc, loaded.nodeId, loaded.originalText, newRawText);
  return { ok: true as const, outcome, newRawText };
}

describe("Phase 5L-1: marker-free projection on real single-item fixtures", () => {
  it("a '-' marker leaf item projects marker-free — the loaded projection's body excludes the marker", () => {
    const loaded = loadStandalone("- 史料の確認事項", "li-0");
    expect(loaded.projection).not.toBeNull();
    expect(loaded.projection!.marker).toBe("-");
    expect(loaded.projection!.body).toBe("史料の確認事項");
  });

  it("a '*' marker leaf item projects marker-free", () => {
    const loaded = loadStandalone("* 史料の確認事項", "li-0");
    expect(loaded.projection).not.toBeNull();
    expect(loaded.projection!.marker).toBe("*");
    expect(loaded.projection!.body).toBe("史料の確認事項");
  });

  it("a '+' marker leaf item projects marker-free", () => {
    const loaded = loadStandalone("+ 史料の確認事項", "li-0");
    expect(loaded.projection).not.toBeNull();
    expect(loaded.projection!.marker).toBe("+");
    expect(loaded.projection!.body).toBe("史料の確認事項");
  });

  it("an indented leaf item (nested under a parent) projects marker-free with its indentation captured", () => {
    const doc = parseDocument(["- 親項目", "  - 史料の確認事項"].join("\n"));
    const extracted = extractSubtreeText(doc, "li-1");
    expect(extracted.ok).toBe(true);
    const node = doc.nodes.get("li-1");
    expect(node && isListNode(node) && isStandaloneListItemEligibleForMarkerFreeProjection(node)).toBe(true);
    const built = buildListMarkerProjection(extracted.text);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.projection.indent).toBe("  ");
      expect(built.projection.body).toBe("史料の確認事項");
    }
  });
});

describe("Phase 5L-1: Apply preserves marker/indentation and writes back through the existing applySubtreeEdit path", () => {
  it("editing ONLY the body restores marker '-' byte-for-byte", () => {
    const loaded = loadStandalone("- 史料の確認事項", "li-0");
    const result = applyStandalone(loaded, "編集後の確認事項");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe("- 編集後の確認事項");
    expect(result.outcome.changed).toBe(true);
    expect(result.outcome.lines[0]).toBe("- 編集後の確認事項");
  });

  it("editing the body of a '*' marker item restores '*'", () => {
    const loaded = loadStandalone("* 史料の確認事項", "li-0");
    const result = applyStandalone(loaded, "編集後の確認事項");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe("* 編集後の確認事項");
  });

  it("editing the body of a '+' marker item restores '+'", () => {
    const loaded = loadStandalone("+ 史料の確認事項", "li-0");
    const result = applyStandalone(loaded, "編集後の確認事項");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe("+ 編集後の確認事項");
  });

  it("editing the body of an indented leaf item preserves BOTH the marker and the indentation, and never disturbs the parent's own line or sibling structure", () => {
    const text = ["- 親項目", "  - 史料の確認事項", "- 別の兄弟項目"].join("\n");
    const doc = parseDocument(text);
    const extracted = extractSubtreeText(doc, "li-1");
    const node = doc.nodes.get("li-1");
    const eligible = node && isListNode(node) && isStandaloneListItemEligibleForMarkerFreeProjection(node);
    expect(eligible).toBe(true);
    const built = buildListMarkerProjection(extracted.text);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertListMarkerProjection(built.projection, "編集後の確認事項");
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawLine).toBe("  - 編集後の確認事項");
    const outcome = applySubtreeEdit(doc, "li-1", extracted.text, inverted.rawLine);
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual([
      "- 親項目",
      "  - 編集後の確認事項",
      "- 別の兄弟項目",
    ]);
  });

  it("clearing the body to empty reconstructs a valid, bare-marker list line, not a broken one", () => {
    const loaded = loadStandalone("- 史料の確認事項", "li-0");
    const result = applyStandalone(loaded, "");
    if (!result.ok) throw new Error("expected ok");
    // markerSpacing is reused verbatim (not re-synthesized) when the body
    // becomes empty — see edit/listMarkerProjection.ts's own doc comment.
    expect(result.newRawText.startsWith("-")).toBe(true);
    expect(result.outcome.changed).toBe(true);
  });

  it("typing text that itself LOOKS like a marker into the body never creates a double marker — the original marker/spacing are reused verbatim, the typed text is just body content", () => {
    const loaded = loadStandalone("- 元の内容", "li-0");
    const result = applyStandalone(loaded, "- 注入されたテキスト");
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe("- - 注入されたテキスト");
    // Reconstructs to exactly one leading marker followed by the body's
    // own (unrelated) leading "- " — never collapsed, never doubled up
    // into some OTHER shape.
    expect(result.outcome.lines[0]).toBe("- - 注入されたテキスト");
  });

  it("Markdown constructs in the body (link, embed, bold, inline code, blockquote-looking text) round-trip verbatim, uncorrupted", () => {
    const loaded = loadStandalone("- 元の内容", "li-0");
    const body = "[link](https://example.com) ![[embed.png]] **強調** `code` > 引用風テキスト";
    const result = applyStandalone(loaded, body);
    if (!result.ok) throw new Error("expected ok");
    expect(result.newRawText).toBe(`- ${body}`);
    expect(result.outcome.lines[0]).toBe(`- ${body}`);
  });

  it("re-opening the same item after Apply shows the UPDATED body marker-free", () => {
    const loaded = loadStandalone("- 史料の確認事項", "li-0");
    const result = applyStandalone(loaded, "編集後の確認事項");
    if (!result.ok) throw new Error("expected ok");
    const reloaded = loadStandalone(result.outcome.lines.join("\n"), "li-0");
    expect(reloaded.projection).not.toBeNull();
    expect(reloaded.projection!.body).toBe("編集後の確認事項");
    expect(reloaded.projection!.marker).toBe("-");
  });

  it("no line outside the edited item's own single line changes — range-outside-unchanged", () => {
    const text = ["# 見出し", "- 前の項目", "- 史料の確認事項", "- 後の項目"].join("\n");
    const loaded = loadStandalone(text, "li-1");
    const result = applyStandalone(loaded, "編集後の確認事項");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual([
      "# 見出し",
      "- 前の項目",
      "- 編集後の確認事項",
      "- 後の項目",
    ]);
  });
});

describe("Phase 5L-1: genuine safety-error refusal — multiline body edit is rejected, draft preserved, applySubtreeEdit never reached", () => {
  it("a body edit containing a newline is refused with reason 'multiline-body', BEFORE applySubtreeEdit is ever called", () => {
    const loaded = loadStandalone("- 史料の確認事項", "li-0");
    const result = applyStandalone(loaded, "1行目\n2行目");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refusal");
    expect(result.reason).toBe("multiline-body");
    // The original note text is untouched — loaded.doc.lines (what
    // applySubtreeEdit would have spliced into) still reads exactly as
    // it did at load time, since applySubtreeEdit itself was never
    // invoked on this path.
    expect(loaded.doc.lines).toEqual(["- 史料の確認事項"]);
  });
});

describe("Phase 5L-1: stale snapshot conflict is refused by the EXISTING, unmodified applySubtreeEdit safety check", () => {
  it("Apply is refused with reason 'conflict' when the note changed elsewhere since load, and the draft/original doc are unaffected", () => {
    const loaded = loadStandalone("- 史料の確認事項", "li-0");
    // Simulate an external edit to the SAME line between load and Apply:
    // re-parse a DIFFERENT current text, but still Apply against the
    // pane's own stale originalText snapshot — applySubtreeEdit's own
    // re-extraction-and-compare catches the mismatch.
    const externallyEditedDoc = parseDocument("- 他者による変更後の内容");
    const outcome = applySubtreeEdit(externallyEditedDoc, "li-0", loaded.originalText, "- 編集後の確認事項");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("conflict");
  });
});

describe("Phase 5L-1: ineligible structures fall back to the raw list row (never refused, never treated as an error)", () => {
  it("an ordered-marker item is never structurally eligible — no projection is attempted", () => {
    const loaded = loadStandalone("1. 史料の確認事項", "li-0");
    expect(loaded.projection).toBeNull();
    expect(loaded.originalText).toBe("1. 史料の確認事項");
  });

  it("a task-list item is structurally eligible but buildListMarkerProjection itself refuses it (task-list-marker) — projection stays null, raw fallback", () => {
    const loaded = loadStandalone("- [ ] 確認する", "li-0");
    expect(loaded.projection).toBeNull();
    expect(loaded.originalText).toBe("- [ ] 確認する");
  });

  it("a multi-line item (continuation paragraph) falls back to raw — the WHOLE subtree text (both lines) is what the raw fallback shows and Applies", () => {
    const text = ["- 項目本文", "  続きの段落。"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.projection).toBeNull();
    expect(loaded.originalText).toBe(text);
    const result = applyStandalone(loaded, "- 編集後の項目本文\n  編集後の続き。");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines).toEqual(["- 編集後の項目本文", "  編集後の続き。"]);
  });

  it("a parent item that owns a nested child list falls back to raw — its own extracted text includes the WHOLE nested subtree, Applied as one raw blob exactly as before this ticket", () => {
    const text = ["- 親項目", "  - 子項目"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.projection).toBeNull();
    expect(loaded.originalText).toBe(text);
  });

  it("a list item containing a fenced code block as a continuation falls back to raw (range spans multiple lines, same mechanism as any other continuation)", () => {
    const text = ["- 項目本文", "  ```", "  code here", "  ```"].join("\n");
    const loaded = loadStandalone(text, "li-0");
    expect(loaded.projection).toBeNull();
    expect(loaded.originalText).toBe(text);
  });
});

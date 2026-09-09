import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { applySubtreeEdit, extractSubtreeText } from "../src/edit/partialEdit";
import {
  buildQuotePrefixProjection,
  CalloutFoldMarker,
  invertQuotePrefixProjection,
  QuotePrefixProjection,
  reconstructQuoteHeader,
} from "../src/edit/quotePrefixProjection";

/**
 * "Unified Outliner — Phase 5D-1.5: 単独 Callout / Blockquote Partial
 * Edit Pane の可変長本文編集（行追加・行削除・複数行貼付け）" — integration
 * tests for the exact pipeline view/PartialEditView.ts's applyEdit now
 * runs for a projecting callout/blockquote whose body edit ADDS, REMOVES,
 * or otherwise changes the number of lines: buildQuotePrefixProjection ->
 * (edit) -> invertQuotePrefixProjection -> [reconstructQuoteHeader, when
 * the title/type/marker was also edited] -> a structural re-verification
 * against the CURRENT parser/scanner (mirrors applyEdit's own; see
 * applyProjected below) -> applySubtreeEdit.
 *
 * PartialEditView itself cannot be constructed in vitest (ItemView is
 * Obsidian-dependent — see tests/paragraphPartialEditViewWiring.test.ts's
 * own doc comment for the established precedent). This file exercises
 * the identical sequence of pure calls the View makes, directly, mirroring
 * tests/quotePrefixPartialEditApply.test.ts's own established pattern —
 * that file's own applyProjected helper covers the SAME-line-count title/
 * marker/type editing scenarios (Phase 5D-1A/5D-1B/5D-1C); this file
 * covers every scenario this ticket's own section 6 requires, built
 * directly from that section's own worked examples (fixture text and
 * expected output transcribed verbatim from the approved ticket).
 */

/** Mirrors applyEdit's exact sequence for a projecting callout/blockquote, including the Phase 5D-1.5 structural re-verification step. */
function applyProjected(
  doc: ReturnType<typeof parseDocument>,
  id: string,
  extractedText: string,
  projection: QuotePrefixProjection,
  editedBodyDisplay: string,
  newTypeValue: string,
  newMarkerValue: CalloutFoldMarker,
  newTitleValue: string
):
  | { applied: false; stage: "invert"; reason: "blockquote-empty" }
  | { applied: false; stage: "reconstruct"; reason: "newline" | "invalid-marker" | "invalid-type" }
  | { applied: false; stage: "revalidate" }
  | { applied: true; outcome: ReturnType<typeof applySubtreeEdit>; newRawText: string } {
  const inverted = invertQuotePrefixProjection(projection, editedBodyDisplay);
  if (!inverted.ok) {
    return { applied: false, stage: "invert", reason: inverted.reason };
  }
  let newRawText = inverted.rawText;
  const titleSlot = projection.titleSlot;
  if (titleSlot) {
    const reconstructed = reconstructQuoteHeader(titleSlot, newTypeValue, newMarkerValue, newTitleValue);
    if (!reconstructed.ok) {
      return { applied: false, stage: "reconstruct", reason: reconstructed.reason };
    }
    const bodyOnlyLines = newRawText.split("\n").slice(1);
    newRawText = [reconstructed.header, ...bodyOnlyLines].join("\n");
  }
  const candidateDoc = parseDocument(newRawText);
  const candidateBlock = scanComplexBlocks(candidateDoc).blocks.find((b) => b.kind === projection.kind);
  const expectedEndLine = newRawText.split("\n").length - 1;
  const structurallyValid =
    !!candidateBlock &&
    candidateBlock.range.startLine === 0 &&
    candidateBlock.range.endLine === expectedEndLine &&
    candidateBlock.editability === "supported";
  if (!structurallyValid) {
    return { applied: false, stage: "revalidate" };
  }
  const outcome = applySubtreeEdit(doc, id, extractedText, newRawText);
  return { applied: true, outcome, newRawText };
}

function calloutId(doc: ReturnType<typeof parseDocument>): string {
  const b = scanComplexBlocks(doc).blocks.find((x) => x.kind === "callout");
  if (!b) throw new Error("no callout in fixture");
  return b.id;
}

function blockquoteId(doc: ReturnType<typeof parseDocument>): string {
  const b = scanComplexBlocks(doc).blocks.find((x) => x.kind === "blockquote");
  if (!b) throw new Error("no blockquote in fixture");
  return b.id;
}

// ---- 6-1: Callout の可変長 body (growth) ----------------------------------

describe("6-1: callout body growth (line added)", () => {
  it("matches the ticket's own worked example exactly", () => {
    const raw = ["> [!note]+ テスト", "> 第一行", "> 第二行"].join("\n");
    const doc = parseDocument(raw);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const titleSlot = built.projection.titleSlot!;

    const editedBody = ["第一行", "追加した第二行", "第三行"].join("\n");
    const result = applyProjected(
      doc,
      id,
      extracted.text,
      built.projection,
      editedBody,
      titleSlot.type,
      titleSlot.marker,
      titleSlot.title
    );
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.newRawText).toBe(
      ["> [!note]+ テスト", "> 第一行", "> 追加した第二行", "> 第三行"].join("\n")
    );
    expect(result.outcome.changed).toBe(true);
    if (!result.outcome.changed) return;
    expect(result.outcome.lines.join("\n")).toBe(result.newRawText);
  });
});

// ---- 6-2: Callout の行削除（内容クリア、同一行数） --------------------------

describe("6-2: callout line content cleared (same line count, blank-line normalization)", () => {
  it("matches the ticket's own worked example exactly — the cleared line becomes a bare '>'", () => {
    const raw = ["> [!note]+ テスト", "> 第一行", "> 第二行", "> 第三行"].join("\n");
    const doc = parseDocument(raw);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const titleSlot = built.projection.titleSlot!;

    const editedBody = ["第一行", "", "第三行"].join("\n");
    const result = applyProjected(
      doc,
      id,
      extracted.text,
      built.projection,
      editedBody,
      titleSlot.type,
      titleSlot.marker,
      titleSlot.title
    );
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.newRawText).toBe(
      ["> [!note]+ テスト", "> 第一行", ">", "> 第三行"].join("\n")
    );
  });
});

// ---- 6-3: Callout の空行保持（段落間に空行を挿入） --------------------------

describe("6-3: callout paragraph blank-line preservation (line count grows to insert a blank line)", () => {
  it("matches the ticket's own worked example — the inserted blank line survives as a bare '>', never a body-splitting bare empty line", () => {
    const raw = ["> [!note] テスト", "> 第一段落", "> 第二段落"].join("\n");
    const doc = parseDocument(raw);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const titleSlot = built.projection.titleSlot!;

    const editedBody = ["第一段落", "", "第二段落"].join("\n");
    const result = applyProjected(
      doc,
      id,
      extracted.text,
      built.projection,
      editedBody,
      titleSlot.type,
      titleSlot.marker,
      titleSlot.title
    );
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.newRawText).toBe(
      ["> [!note] テスト", "> 第一段落", ">", "> 第二段落"].join("\n")
    );
    // The reconstructed block must still be ONE contiguous, "supported"
    // callout spanning all 4 lines — the blank line must never register
    // as a bare, quote-breaking empty line that would terminate the
    // block early.
    const rebuiltDoc = parseDocument(result.newRawText);
    const rebuiltBlock = scanComplexBlocks(rebuiltDoc).blocks.find((b) => b.kind === "callout");
    expect(rebuiltBlock?.editability).toBe("supported");
    expect(rebuiltBlock?.range).toEqual({ startLine: 0, endLine: 3 });
  });
});

// ---- 6-4: Callout body の全削除（許可） ------------------------------------

describe("6-4: callout body fully deleted — allowed, header survives alone", () => {
  it("matches the ticket's own worked example exactly", () => {
    const raw = ["> [!note]+ テスト", "> 本文"].join("\n");
    const doc = parseDocument(raw);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const titleSlot = built.projection.titleSlot!;

    const result = applyProjected(
      doc,
      id,
      extracted.text,
      built.projection,
      "",
      titleSlot.type,
      titleSlot.marker,
      titleSlot.title
    );
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.newRawText).toBe("> [!note]+ テスト");
    expect(result.outcome.changed).toBe(true);
    if (!result.outcome.changed) return;
    expect(result.outcome.lines.join("\n")).toBe("> [!note]+ テスト");
  });

  it("range outside the callout is untouched by a full-body deletion", () => {
    const doc = parseDocument(
      ["# Before", "> [!note]+ テスト", "> 本文", "# After", "still here"].join("\n")
    );
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const titleSlot = built.projection.titleSlot!;
    const result = applyProjected(
      doc,
      id,
      extracted.text,
      built.projection,
      "",
      titleSlot.type,
      titleSlot.marker,
      titleSlot.title
    );
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.outcome.changed).toBe(true);
    if (!result.outcome.changed) return;
    expect(result.outcome.lines.join("\n")).toBe(
      ["# Before", "> [!note]+ テスト", "# After", "still here"].join("\n")
    );
  });
});

// ---- 6-5: Callout header と可変長 body の同時編集 ---------------------------

describe("6-5: callout header (type/marker/title) and variable-length body edited together", () => {
  it("matches the ticket's own worked example exactly", () => {
    const raw = ["> [!note]+ 古いタイトル", "> A", "> B"].join("\n");
    const doc = parseDocument(raw);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const editedBody = ["X", "Y", "Z"].join("\n");
    const result = applyProjected(
      doc,
      id,
      extracted.text,
      built.projection,
      editedBody,
      "warning",
      "",
      "新しいタイトル"
    );
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.newRawText).toBe(
      ["> [!warning] 新しいタイトル", "> X", "> Y", "> Z"].join("\n")
    );
  });
});

// ---- 6-6: Blockquote の行追加 ----------------------------------------------

describe("6-6: blockquote line added", () => {
  it("matches the ticket's own worked example exactly", () => {
    const raw = ["> 第一行", "> 第二行"].join("\n");
    const doc = parseDocument(raw);
    const id = blockquoteId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const editedBody = ["第一行", "追加した第二行", "", "第三行"].join("\n");
    const result = applyProjected(doc, id, extracted.text, built.projection, editedBody, "", "", "");
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.newRawText).toBe(
      ["> 第一行", "> 追加した第二行", ">", "> 第三行"].join("\n")
    );
  });
});

// ---- 6-7: Blockquote の行削除 ----------------------------------------------

describe("6-7: blockquote line removed entirely", () => {
  it("matches the ticket's own worked example exactly", () => {
    const raw = ["> 第一行", "> 第二行", "> 第三行"].join("\n");
    const doc = parseDocument(raw);
    const id = blockquoteId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const editedBody = ["第一行", "第三行"].join("\n");
    const result = applyProjected(doc, id, extracted.text, built.projection, editedBody, "", "", "");
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.newRawText).toBe(["> 第一行", "> 第三行"].join("\n"));
  });
});

// ---- 6-8: Blockquote の全削除拒否 -------------------------------------------

describe("6-8: blockquote body fully deleted — refused, note untouched, no partial write", () => {
  it("refuses at the invert stage, never reaching applySubtreeEdit, and the ORIGINAL doc is never mutated", () => {
    const raw = ["> 第一行", "> 第二行"].join("\n");
    const doc = parseDocument(raw);
    const id = blockquoteId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const result = applyProjected(doc, id, extracted.text, built.projection, "", "", "", "");
    expect(result).toEqual({ applied: false, stage: "invert", reason: "blockquote-empty" });
    // Zero-byte-change: `doc` itself was never touched — applySubtreeEdit
    // was never even called (confirmed structurally by
    // tests/quotePrefixPartialEditViewWiring.test.ts's own ordering
    // check on applyEdit).
    expect(doc.lines.join("\n")).toBe(raw);
  });
});

// ---- 6-9: 対象 range 外の不変性 ---------------------------------------------

describe("6-9: content outside the edited block's own range is untouched by a variable-length edit", () => {
  const FIXTURE = [
    "---",
    "title: test",
    "---",
    "# Before heading",
    "some paragraph text",
    "- a list item",
    "> [!warning] Another callout",
    "> untouched callout body",
    "",
    "> [!note]+ Target",
    "> keep",
    "> lose this one",
    "> keep another",
    "",
    "# After heading",
    "still here",
  ].join("\n");

  it("growing the target callout's body leaves every other line — frontmatter, heading, paragraph, list, sibling callout, trailing section — byte-identical", () => {
    const doc = parseDocument(FIXTURE);
    const blocks = scanComplexBlocks(doc).blocks.filter((b) => b.kind === "callout");
    const id = blocks.find((b) => doc.lines[b.range.startLine].includes("Target"))!.id;
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const titleSlot = built.projection.titleSlot!;

    const editedBody = ["keep", "replaced", "keep another", "and a brand new fourth line"].join(
      "\n"
    );
    const result = applyProjected(
      doc,
      id,
      extracted.text,
      built.projection,
      editedBody,
      titleSlot.type,
      titleSlot.marker,
      titleSlot.title
    );
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.outcome.changed).toBe(true);
    if (!result.outcome.changed) return;
    expect(result.outcome.lines.join("\n")).toBe(
      [
        "---",
        "title: test",
        "---",
        "# Before heading",
        "some paragraph text",
        "- a list item",
        "> [!warning] Another callout",
        "> untouched callout body",
        "",
        "> [!note]+ Target",
        "> keep",
        "> replaced",
        "> keep another",
        "> and a brand new fourth line",
        "",
        "# After heading",
        "still here",
      ].join("\n")
    );
  });
});

// ---- 6-10: conflict / stale-range 再解決 -----------------------------------

describe("6-10: conflict detection is unaffected by a variable-length edit", () => {
  it("a variable-length edit still refuses with 'conflict' when the note changed elsewhere between load and Apply", () => {
    const raw = ["> [!note]+ テスト", "> A", "> B"].join("\n");
    const doc = parseDocument(raw);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const titleSlot = built.projection.titleSlot!;

    // Note changed elsewhere (a DIFFERENT parse) since the pane loaded —
    // Apply must re-extract fresh and refuse, never blindly splice
    // against the pane's own stale `doc`.
    const changedElsewhere = parseDocument(raw.replace("> A", "> A changed by someone else"));
    const editedBody = ["A", "B", "a brand new third line"].join("\n");
    const result = applyProjected(
      changedElsewhere,
      id,
      extracted.text,
      built.projection,
      editedBody,
      titleSlot.type,
      titleSlot.marker,
      titleSlot.title
    );
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.outcome.changed).toBe(false);
    expect(result.outcome.reason).toBe("conflict");
    expect(result.outcome.lines).toBe(changedElsewhere.lines);
  });

  it("a variable-length edit still refuses with 'resolve-failed' when the target callout was deleted before Apply", () => {
    const raw = ["> [!note]+ テスト", "> A", "> B"].join("\n");
    const doc = parseDocument(raw);
    const id = calloutId(doc);
    const extracted = extractSubtreeText(doc, id);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const built = buildQuotePrefixProjection(extracted.text, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const titleSlot = built.projection.titleSlot!;

    const withCalloutDeleted = parseDocument("nothing but plain text now");
    const editedBody = ["A", "B", "a brand new third line"].join("\n");
    const result = applyProjected(
      withCalloutDeleted,
      id,
      extracted.text,
      built.projection,
      editedBody,
      titleSlot.type,
      titleSlot.marker,
      titleSlot.title
    );
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.outcome.changed).toBe(false);
    expect(result.outcome.reason).toBe("resolve-failed");
  });
});

// ---- 6-11: 既存機能回帰なし -------------------------------------------------

describe("6-11: no regression — section/list Partial Edit already supported variable-length edits and are untouched by this ticket", () => {
  it("applySubtreeEdit for a SECTION already accepted a line-count-changing edit before this ticket, and still does — this path never went through quoteProjection at all", () => {
    const doc = parseDocument(["# A Section", "one line of body text"].join("\n"));
    const sectionId = [...doc.nodes.values()].find(
      (n) => n.type === "section" && n.headingText === "A Section"
    )!.id;
    const extracted = extractSubtreeText(doc, sectionId);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const grownText = ["# A Section", "one line of body text", "a second, newly added line"].join(
      "\n"
    );
    const outcome = applySubtreeEdit(doc, sectionId, extracted.text, grownText);
    expect(outcome.changed).toBe(true);
    if (!outcome.changed) return;
    expect(outcome.lines.join("\n")).toBe(grownText);
  });

  it("a nested-quote-projecting callout is still refused at LOAD time (buildQuotePrefixProjection), never reaching this ticket's variable-length Apply logic at all", () => {
    const raw = ["> [!note] Title", "> outer", "> > nested"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built).toEqual({ ok: false, reason: "nested" });
  });
});

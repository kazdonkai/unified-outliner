import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "../src/parser/parseDocument";
import { resolveParagraphAtCursor } from "../src/resolver/resolveParagraphAtCursor";
import {
  applyParagraphEdit,
  buildParagraphEditAnchor,
  ParagraphEditAnchor,
  resolveParagraphAnchorText,
} from "../src/edit/paragraphPartialEdit";

/**
 * Phase 5A-1 hardening §2: real-assertion coverage for
 * resolveParagraphAnchorText — the dedicated, explicitly read-only
 * resolver that replaces the discarded-result
 * applyParagraphEdit(doc, anchor, anchor.originalText) no-op-probe pattern
 * view/PartialEditView.ts's resolveCurrentTarget used before this
 * hardening round. Mirrors tests/paragraphPartialEdit.test.ts's own
 * `anchorAt` fixture-building convention (the "one true builder" —
 * buildParagraphEditAnchor — never a hand-built object literal, except
 * where a test deliberately needs an anchor whose id cannot possibly
 * still resolve, in which case that is called out explicitly).
 */
function anchorAt(text: string, cursorLine: number): ParagraphEditAnchor {
  const doc = parseDocument(text);
  const resolved = resolveParagraphAtCursor(doc, cursorLine);
  if (!resolved.paragraph) throw new Error("expected a paragraph to resolve for this test fixture");
  return buildParagraphEditAnchor(doc, resolved.paragraph);
}

describe("resolveParagraphAnchorText: resolves without ever mutating the document", () => {
  it("resolves by id when nothing changed — returns the anchor's own unchanged text", () => {
    const text = ["# H", "Before.", "", "Target paragraph.", "", "After."].join("\n");
    const anchor = anchorAt(text, 3);
    const doc = parseDocument(text);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: true, text: "Target paragraph.", ambiguous: false });
    // Read-only: the document's own lines must be byte-identical to before.
    expect(doc.lines).toEqual(text.split("\n"));
  });

  it("resolves via the existing structural fallback after a same-parent paragraph<->paragraph swap, with its own text unchanged", () => {
    const original = ["# H", "Alpha paragraph.", "", "Beta paragraph.", ""].join("\n");
    const anchor = anchorAt(original, 1); // "Alpha paragraph."
    // A Phase 5P-4-style swap: same two paragraphs, same parent/depth,
    // reordered — this re-numbers every paragraph-kind candidate's own
    // scan-local id from this point on (parser/complexBlocks.ts), so the
    // anchor's OLD complexBlockId no longer points at "Alpha paragraph."
    // in this new scan.
    const swapped = ["# H", "Beta paragraph.", "", "Alpha paragraph.", ""].join("\n");
    const doc = parseDocument(swapped);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: true, text: "Alpha paragraph.", ambiguous: false });
  });

  it("distinguishes 'content changed, position resolvable' from an unresolved anchor — and reveals the CURRENT text, unlike applyParagraphEdit's own 'content-changed' refusal", () => {
    const original = ["# H", "Original text."].join("\n");
    const anchor = anchorAt(original, 1);
    const changedText = ["# H", "Someone else edited this line."].join("\n");
    const doc = parseDocument(changedText);

    const readResult = resolveParagraphAnchorText(doc, anchor);
    expect(readResult).toEqual({ ok: true, text: "Someone else edited this line.", ambiguous: false });

    // Non-regression + the two functions' own intentionally different
    // contracts, side by side: applyParagraphEdit (the splice path) still
    // safely REFUSES the exact same situation, since Apply must never
    // silently overwrite drifted content — it only ever reports that the
    // content changed, never the new text itself. This is exactly why
    // PartialEditView needed a SEPARATE read-only resolver in the first
    // place (see resolveParagraphAnchorText's own doc comment).
    const applyResult = applyParagraphEdit(doc, anchor, "should never be written");
    expect(applyResult.changed).toBe(false);
    expect(applyResult.reason).toBe("content-changed");
  });

  it("never guesses/substitutes a different paragraph when the anchor is genuinely unresolved (population changed, e.g. the target was deleted)", () => {
    const original = ["# H", "Before.", "", "Target paragraph.", "", "After."].join("\n");
    const anchor = anchorAt(original, 3);
    expect(anchor.siblingCount).toBe(3);
    const changedText = ["# H", "Before.", "", "", "After."].join("\n"); // deleted
    const doc = parseDocument(changedText);

    const readResult = resolveParagraphAnchorText(doc, anchor);
    expect(readResult.ok).toBe(false);
    expect(readResult.text).toBeNull();
    expect(readResult.ambiguous).toBe(true);

    // Same fixture, same non-regression cross-check as above.
    const applyResult = applyParagraphEdit(doc, anchor, "should never be written");
    expect(applyResult.changed).toBe(false);
    expect(applyResult.reason).toBe("anchor-unresolved");
  });

  it("never returns text when two same-parent siblings share byte-identical text and the anchor's own id no longer structurally matches either one", () => {
    const text = ["# H", "Duplicate text.", "", "Duplicate text.", "", "Filler."].join("\n");
    const doc = parseDocument(text);
    const firstResolved = resolveParagraphAtCursor(doc, 1);
    if (!firstResolved.paragraph) throw new Error("fixture setup: expected a paragraph to resolve");
    // Deliberately hand-built (never buildParagraphEditAnchor) with a
    // complexBlockId guaranteed not to exist in `doc` — the only way to
    // force Pass 1's structural fast path to miss regardless of scan-order
    // id assignment, isolating Pass 2's own "2+ exact matches -> ambiguous"
    // branch.
    const anchor: ParagraphEditAnchor = {
      complexBlockId: "paragraph-does-not-exist-in-this-scan",
      parentId: firstResolved.paragraph.parentId,
      depth: firstResolved.paragraph.depth,
      originalText: "Duplicate text.",
      siblingCount: 2,
      // Phase 5A-1 hardening §5: these three new fields must be supplied
      // even in this deliberately hand-built (never buildParagraphEditAnchor)
      // literal now that ParagraphEditAnchor requires them — their exact
      // values are irrelevant to this particular test, since Pass 2's own
      // "2+ exact matches -> ambiguous" branch resolves before Pass 3 is
      // ever reached, but they must still type-check and be internally
      // plausible (first of the two duplicates: no previous sibling, next
      // sibling is the second duplicate).
      siblingIndex: 0,
      prevSiblingText: null,
      nextSiblingText: "Duplicate text.",
    };
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result.ok).toBe(false);
    expect(result.text).toBeNull();
    expect(result.ambiguous).toBe(true);
  });

  it("works for a list-item-child paragraph, matching applyParagraphEdit's own scope (paragraphs are not section-only)", () => {
    const text = ["- item1", "  Child paragraph of item1.", "- item2"].join("\n");
    const anchor = anchorAt(text, 1);
    const doc = parseDocument(text);
    const result = resolveParagraphAnchorText(doc, anchor);
    // The paragraph's own range is extracted verbatim (leading indentation
    // included) — same convention as applyParagraphEdit's own `extract`
    // helper and resolveParagraphAtCursor's own `text` field, neither of
    // which trims a list-item-child paragraph's leading whitespace.
    expect(result).toEqual({ ok: true, text: "  Child paragraph of item1.", ambiguous: false });
  });
});

describe("resolveParagraphAnchorText: non-regression — applyParagraphEdit's own success/failure reasons are unchanged", () => {
  // A focused re-run of a representative slice of
  // tests/paragraphPartialEdit.test.ts's own, still fully intact,
  // unmodified fixtures — not a replacement for that file (which remains
  // the authoritative, complete coverage for applyParagraphEdit itself),
  // but an explicit, side-by-side confirmation that extracting the shared
  // supportedParagraphCandidates/extractParagraphText helpers in this
  // hardening round did not change applyParagraphEdit's own observable
  // behavior in any of these cases.
  it("successful apply: still replaces only the target paragraph's own range", () => {
    const text = ["# H", "Before.", "", "Target paragraph.", "", "After."].join("\n");
    const anchor = anchorAt(text, 3);
    const doc = parseDocument(text);
    const outcome = applyParagraphEdit(doc, anchor, "Edited target paragraph.");
    expect(outcome.changed).toBe(true);
    expect(outcome.lines).toEqual(["# H", "Before.", "", "Edited target paragraph.", "", "After."]);
    expect(outcome.newStartLine).toBe(3);
  });

  it("still rejects (blank-line-not-allowed) when newText itself contains a blank line", () => {
    const text = ["# H", "Target."].join("\n");
    const anchor = anchorAt(text, 1);
    const doc = parseDocument(text);
    const outcome = applyParagraphEdit(doc, anchor, "Line one.\n\nLine two.");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("blank-line-not-allowed");
  });

  it("still rejects (anchor-unresolved) when the paragraph was merged with an adjacent paragraph", () => {
    const original = ["# H", "First.", "", "Second."].join("\n");
    const anchor = anchorAt(original, 1);
    const changedText = ["# H", "First.", "Second."].join("\n");
    const doc = parseDocument(changedText);
    const outcome = applyParagraphEdit(doc, anchor, "should never be written");
    expect(outcome.changed).toBe(false);
    expect(outcome.reason).toBe("anchor-unresolved");
  });
});

describe("resolveParagraphAnchorText / applyParagraphEdit: zero Obsidian dependency", () => {
  it("edit/paragraphPartialEdit.ts imports nothing from 'obsidian'", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../src/edit/paragraphPartialEdit.ts"),
      "utf-8"
    );
    expect(source).not.toMatch(/from\s+["']obsidian["']/);
  });
});

describe("resolveParagraphAnchorText: Pass 3 (Phase 5A-1 hardening §5) — normal recovery", () => {
  it("recovers a content-changed target among exactly 2 same-slot siblings", () => {
    const original = ["# H", "Alpha.", "", "Beta."].join("\n");
    const anchor = anchorAt(original, 3); // "Beta."
    expect(anchor).toMatchObject({
      siblingCount: 2,
      siblingIndex: 1,
      prevSiblingText: "Alpha.",
      nextSiblingText: null,
    });
    const changed = ["# H", "Alpha.", "", "Beta v2."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: true, text: "Beta v2.", ambiguous: false });
  });

  it("recovers a content-changed target among 3 same-slot siblings — head position", () => {
    const original = ["# H", "Alpha.", "", "Beta.", "", "Gamma."].join("\n");
    const anchor = anchorAt(original, 1); // "Alpha."
    expect(anchor).toMatchObject({
      siblingCount: 3,
      siblingIndex: 0,
      prevSiblingText: null,
      nextSiblingText: "Beta.",
    });
    const changed = ["# H", "Alpha v2.", "", "Beta.", "", "Gamma."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: true, text: "Alpha v2.", ambiguous: false });
  });

  it("recovers a content-changed target among 3 same-slot siblings — middle position", () => {
    const original = ["# H", "Alpha.", "", "Beta.", "", "Gamma."].join("\n");
    const anchor = anchorAt(original, 3); // "Beta."
    expect(anchor).toMatchObject({
      siblingCount: 3,
      siblingIndex: 1,
      prevSiblingText: "Alpha.",
      nextSiblingText: "Gamma.",
    });
    const changed = ["# H", "Alpha.", "", "Beta v2.", "", "Gamma."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: true, text: "Beta v2.", ambiguous: false });
  });

  it("recovers a content-changed target among 3 same-slot siblings — tail position", () => {
    const original = ["# H", "Alpha.", "", "Beta.", "", "Gamma."].join("\n");
    const anchor = anchorAt(original, 5); // "Gamma."
    expect(anchor).toMatchObject({
      siblingCount: 3,
      siblingIndex: 2,
      prevSiblingText: "Beta.",
      nextSiblingText: null,
    });
    const changed = ["# H", "Alpha.", "", "Beta.", "", "Gamma v2."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: true, text: "Gamma v2.", ambiguous: false });
  });

  it("reproduces the reported '123追加→Apply→本文Undo→Reload' scenario as a pure-function test: recovers via Pass 3 after the pane's own post-Apply re-anchor", () => {
    const original = ["# H", "Original text.", "", "Second paragraph."].join("\n");
    const preApplyAnchor = anchorAt(original, 1);
    const docBeforeApply = parseDocument(original);
    const applyOutcome = applyParagraphEdit(docBeforeApply, preApplyAnchor, "Original text.123");
    expect(applyOutcome.changed).toBe(true);
    const afterApplyText = applyOutcome.lines.join("\n");

    // PartialEditView re-anchors from the freshly-applied document
    // immediately after a successful Apply (see buildParagraphEditAnchor's
    // own doc comment) — it never keeps holding the stale pre-Apply anchor.
    const docAfterApply = parseDocument(afterApplyText);
    const resolvedAfterApply = resolveParagraphAtCursor(docAfterApply, 1);
    if (!resolvedAfterApply.paragraph) throw new Error("fixture setup: expected a paragraph to resolve");
    const postApplyAnchor = buildParagraphEditAnchor(docAfterApply, resolvedAfterApply.paragraph);
    expect(postApplyAnchor.originalText).toBe("Original text.123");

    // The user then Undoes in the BODY editor (not the pane), reverting
    // "123" — this is exactly the reported scenario: the target
    // paragraph's own text differs from postApplyAnchor.originalText, but
    // the population, position, and both neighbors are otherwise exactly
    // as remembered.
    const docAfterUndo = parseDocument(original);
    const reloadResult = resolveParagraphAnchorText(docAfterUndo, postApplyAnchor);
    expect(reloadResult).toEqual({ ok: true, text: "Original text.", ambiguous: false });
  });

  it("recovers a content-changed target for a list-item-child paragraph with a same-slot sibling", () => {
    const original = [
      "- item1",
      "  First child paragraph.",
      "",
      "  Second child paragraph.",
      "- item2",
    ].join("\n");
    const anchor = anchorAt(original, 1); // "  First child paragraph."
    if (anchor.siblingCount < 2) {
      // If this fixture's blank line does not keep both paragraphs under
      // the same list-item slot in this codebase's parser, Pass 3's
      // 2+-sibling recovery path simply does not apply to this shape —
      // recorded here rather than silently assumed away.
      return;
    }
    const changed = [
      "- item1",
      "  First child paragraph v2.",
      "",
      "  Second child paragraph.",
      "- item2",
    ].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: true, text: "  First child paragraph v2.", ambiguous: false });
  });

  it("confirms the exact ok:true/ambiguous:false shape Pass 3 must report on a successful recovery (never ok:true with ambiguous:true, never a partial result)", () => {
    const original = ["# H", "Alpha.", "", "Beta."].join("\n");
    const anchor = anchorAt(original, 3);
    const changed = ["# H", "Alpha.", "", "Beta v2."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result.ok).toBe(true);
    expect(result.ambiguous).toBe(false);
    expect(typeof result.text).toBe("string");
  });
});

describe("resolveParagraphAnchorText: Pass 3 — fail-closed, never a misselection", () => {
  it("does not recover when a paragraph was inserted directly before the target AND the target's own text also changed (front insertion)", () => {
    const original = ["# H", "Beta.", "", "Gamma."].join("\n");
    const anchor = anchorAt(original, 1); // "Beta."
    expect(anchor.siblingCount).toBe(2);
    const changed = ["# H", "NewFront.", "", "Beta v2.", "", "Gamma."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: false, text: null, ambiguous: true });
  });

  it("does not recover when a paragraph was inserted directly after the target AND the target's own text also changed (back insertion)", () => {
    const original = ["# H", "Alpha.", "", "Beta."].join("\n");
    const anchor = anchorAt(original, 3); // "Beta."
    expect(anchor.siblingCount).toBe(2);
    const changed = ["# H", "Alpha.", "", "Beta v2.", "", "NewBack."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: false, text: null, ambiguous: true });
  });

  it("does not recover when the preceding neighbor was deleted AND the target's own text also changed (front neighbor deletion)", () => {
    const original = ["# H", "Alpha.", "", "Beta.", "", "Gamma."].join("\n");
    const anchor = anchorAt(original, 3); // "Beta."
    expect(anchor.siblingCount).toBe(3);
    const changed = ["# H", "Beta v2.", "", "Gamma."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: false, text: null, ambiguous: true });
  });

  it("does not recover when the following neighbor was deleted AND the target's own text also changed (back neighbor deletion)", () => {
    const original = ["# H", "Alpha.", "", "Beta.", "", "Gamma."].join("\n");
    const anchor = anchorAt(original, 3); // "Beta."
    expect(anchor.siblingCount).toBe(3);
    const changed = ["# H", "Alpha.", "", "Beta v2."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: false, text: null, ambiguous: true });
  });

  it("does not recover when a count-preserving delete+insert compensation coincidentally satisfies the population/index checks (duplicate-text fingerprint mismatch)", () => {
    // Counterexample verified against the real scanner/parser before this
    // hardening round: before = Alpha./Beta./Gamma. (3 siblings, target =
    // Beta. at index 1). After = Beta. is removed and a duplicate of
    // Gamma. is appended in its place — population stays 3, the anchor's
    // own siblingIndex (1) is still a valid index, but the candidate now
    // sitting at index 1 is NOT Beta.'s successor; it is an unrelated copy
    // of Gamma.'s own text. Without the duplicate-text guard this would
    // have silently resolved to the wrong content.
    const original = ["# H", "Alpha.", "", "Beta.", "", "Gamma."].join("\n");
    const anchor = anchorAt(original, 3); // "Beta."
    expect(anchor.siblingCount).toBe(3);
    const changed = ["# H", "Alpha.", "", "Gamma.", "", "Gamma."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: false, text: null, ambiguous: true });
  });

  it("does not recover across a paragraph split (blank line inserted inside the target's own text)", () => {
    const original = ["# H", "Target paragraph line one.", "line two."].join("\n");
    const anchor = anchorAt(original, 1);
    expect(anchor.siblingCount).toBe(1);
    const changed = ["# H", "Target paragraph line one.", "", "line two."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: false, text: null, ambiguous: true });
  });

  it("does not recover across a paragraph merge (blank line between the target and its neighbor removed)", () => {
    const original = ["# H", "First.", "", "Second."].join("\n");
    const anchor = anchorAt(original, 1); // "First."
    expect(anchor.siblingCount).toBe(2);
    const changed = ["# H", "First.", "Second."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: false, text: null, ambiguous: true });
  });

  it("a pure reorder never causes a misselection — Pass 2's own exact-text match still resolves it correctly, Pass 3 is never even needed", () => {
    const original = ["# H", "Alpha.", "", "Beta.", "", "Gamma."].join("\n");
    const anchor = anchorAt(original, 1); // "Alpha."
    // Rotate: Alpha. moves from the front to the back; its own text is
    // untouched.
    const changed = ["# H", "Beta.", "", "Gamma.", "", "Alpha."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: true, text: "Alpha.", ambiguous: false });
  });

  it("pre-existing duplicate-content siblings elsewhere in the slot force ambiguous even when the target's own position/neighbors line up (no misselection)", () => {
    const original = ["# H", "Same.", "", "Same.", "", "Target."].join("\n");
    const anchor = anchorAt(original, 5); // "Target." (index 2, prev = "Same.")
    expect(anchor.siblingCount).toBe(3);
    const changed = ["# H", "Same.", "", "Same.", "", "Target v2."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: false, text: null, ambiguous: true });
  });

  it("an explicit 'prev/next coincidentally identical' construction: local neighbor match alone would misselect, the global duplicate guard still refuses", () => {
    // 4 siblings; the target (Beta., index 1) is replaced by a byte-for-
    // byte copy of Delta.'s own text. In isolation, the immediate
    // neighbors (Alpha. before, Gamma. after) still match the anchor
    // exactly — a prev/next-only check would have wrongly resolved this to
    // "Delta." at Beta.'s old position. The duplicate-text guard (which
    // compares across the WHOLE current slot, not just the immediate
    // neighbors) catches this and still refuses.
    const original = ["# H", "Alpha.", "", "Beta.", "", "Gamma.", "", "Delta."].join("\n");
    const anchor = anchorAt(original, 3); // "Beta."
    expect(anchor).toMatchObject({
      siblingCount: 4,
      siblingIndex: 1,
      prevSiblingText: "Alpha.",
      nextSiblingText: "Gamma.",
    });
    const changed = ["# H", "Alpha.", "", "Delta.", "", "Gamma.", "", "Delta."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: false, text: null, ambiguous: true });
  });

  it("does not recover when the target's parentId/depth changed (a new heading inserted directly above it) — excluded upstream by the sameSlot filter itself", () => {
    const original = ["# H1", "Target."].join("\n");
    const anchor = anchorAt(original, 1);
    expect(anchor.siblingCount).toBe(1);
    const changed = ["# H1", "## H2", "Target."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: false, text: null, ambiguous: true });
  });

  it("never substitutes a neighboring paragraph when the target itself was deleted outright (3-sibling case)", () => {
    const original = ["# H", "Alpha.", "", "Beta.", "", "Gamma."].join("\n");
    const anchor = anchorAt(original, 3); // "Beta."
    expect(anchor.siblingCount).toBe(3);
    const changed = ["# H", "Alpha.", "", "Gamma."].join("\n");
    const doc = parseDocument(changed);
    const result = resolveParagraphAnchorText(doc, anchor);
    expect(result).toEqual({ ok: false, text: null, ambiguous: true });
    // Never returns "Alpha." or "Gamma." as a substitute for the deleted "Beta.".
    expect(result.text).not.toBe("Alpha.");
    expect(result.text).not.toBe("Gamma.");
  });
});

describe("resolveParagraphAnchorText / applyParagraphEdit: Pass 3 is exclusively read-only — Apply's own fail-closed contract is untouched", () => {
  it("applyParagraphEdit still rejects with 'content-changed' in a case where resolveParagraphAnchorText NOW resolves via Pass 3 — the two functions' contracts remain fully independent", () => {
    const original = ["# H", "Alpha.", "", "Beta."].join("\n");
    const anchor = anchorAt(original, 3); // "Beta."
    const changed = ["# H", "Alpha.", "", "Beta v2."].join("\n");
    const doc = parseDocument(changed);

    const readResult = resolveParagraphAnchorText(doc, anchor);
    expect(readResult).toEqual({ ok: true, text: "Beta v2.", ambiguous: false });

    // applyParagraphEdit's own Pass 2 fallback (population unchanged ->
    // "content-changed") is completely unmodified by this hardening round
    // — it never consults siblingIndex/prevSiblingText/nextSiblingText,
    // and never uses Pass 3's recovered text as a write target. A dirty
    // Pane must never be able to Apply on the strength of Pass 3's
    // read-only recovery alone.
    const applyResult = applyParagraphEdit(doc, anchor, "should never be written");
    expect(applyResult.changed).toBe(false);
    expect(applyResult.reason).toBe("content-changed");
    expect(applyResult.lines).toEqual(doc.lines);
  });
});

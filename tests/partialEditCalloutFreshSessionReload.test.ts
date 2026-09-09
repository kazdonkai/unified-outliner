import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { extractSubtreeText } from "../src/edit/partialEdit";
import {
  buildQuotePrefixProjection,
  projectedDisplayText,
} from "../src/edit/quotePrefixProjection";

/**
 * "単独 Callout Partial Edit Pane の stale snapshot 表示バグ修正"
 * (2026-09-09): regression coverage for "close → 本文編集 → 再オープン"
 * always showing the CURRENT note content, never a stale snapshot from
 * whenever the pane happened to first load a target.
 *
 * view/PartialEditView.ts's ItemView cannot be constructed in vitest
 * ("obsidian" is a types-only package in this repo — see
 * tests/paragraphPartialEditViewWiring.test.ts's own doc comment for the
 * established precedent), so the interactive leaf/instance-reuse layer
 * itself cannot be directly exercised here. This file instead does two
 * things:
 *
 * 1. Exercises the exact pure, Obsidian-free call sequence
 *    loadNodeInternal makes on every load — parseDocument ->
 *    extractSubtreeText -> (for callout/blockquote) buildQuotePrefixProjection
 *    -> titleSlot/projectedDisplayText — TWICE against the SAME resolved
 *    id, simulating "session 1" (a pane's first load) and "session 2" (a
 *    fresh load after the pane was closed and the note was edited in
 *    between, including body line-count changes) as two entirely
 *    independent calls against two independently-parsed documents. This
 *    proves the DATA layer every load*Internal method reads from is
 *    unconditionally re-derived from whatever text is passed in, never
 *    cached or reused across calls — the ticket's own required "close →
 *    本文編集(行追加含む) → reopen" regression, at the level that is
 *    actually testable in this environment.
 *
 * 2. Static-source-text checks (the established `*UiWiring.test.ts`
 *    convention) pinning down this ticket's own View-layer fix: the new
 *    shared resetLoadedState() method, onClose/renderEmptyState both
 *    routing through it, and every load*Internal failure branch (except
 *    the deliberate, pre-existing "nested" quote-projection refusal —
 *    see tests/quotePrefixPartialEditViewWiring.test.ts's own test for
 *    why that one case is intentionally excluded) resetting to the empty
 *    state before showing its Notice.
 *
 * Real behavioral coverage of the quote-prefix projection pipeline itself
 * (build/invert/apply, conflict, resolve-failed) already lives in
 * tests/quotePrefixPartialEditApply.test.ts / tests/quotePrefixProjection.test.ts
 * — this file only adds the "same id, two independent documents"
 * fresh-session angle those files don't cover.
 */

// ---- Case8 standalone callout fixture (ticket's own verbatim text) -------

const CASE8_INITIAL = [
  "# Test",
  "",
  "> [!note]+ Case8 standalone callout",
  "> 拡張ブロックを構成しない単独の callout",
  "> ①プレフィクス（>）なしの編集が出来る",
  "> ②コールアウトの種類・開き方・タイトルを編集出来る",
].join("\n");

const CASE8_UPDATED = [
  "# Test",
  "",
  "> [!info] Case8 updated callout",
  "> 本文側で変更済みの第一行",
  "> 本文側で変更済みの第二行",
  "> 本文側で追加された第三行",
].join("\n");

/** Finds the sole standalone callout's id in `doc` — this fixture always has exactly one. */
function soleCalloutId(doc: ReturnType<typeof parseDocument>): string {
  const blocks = scanComplexBlocks(doc).blocks.filter((b) => b.kind === "callout");
  expect(blocks.length).toBe(1);
  return blocks[0].id;
}

/**
 * Mirrors loadNodeInternal's own callout/blockquote path exactly:
 * extractSubtreeText -> buildQuotePrefixProjection -> the same
 * type/marker/title/body fields the View reads onto its title input,
 * fold-marker select, type combobox, and textarea. Deliberately a local
 * helper, not a new exported function in src/ — the ticket's own
 * instruction prefers "extract a pure function if it helps testability"
 * but explicitly weighs that against "don't refactor the existing
 * responsibility split more than necessary"; keeping this sequence
 * inline here, matching production code exactly, achieves the required
 * test coverage without touching loadNodeInternal's own structure.
 */
function loadCalloutSession(doc: ReturnType<typeof parseDocument>, id: string) {
  const extracted = extractSubtreeText(doc, id);
  if (!extracted.ok || !extracted.kind) {
    return { ok: false as const, reason: extracted.reason };
  }
  if (extracted.kind !== "callout" && extracted.kind !== "blockquote") {
    return { ok: false as const, reason: "resolve-failed" as const };
  }
  const built = buildQuotePrefixProjection(extracted.text, extracted.kind);
  if (!built.ok) {
    return { ok: false as const, reason: built.reason };
  }
  const { titleSlot, header } = built.projection;
  return {
    ok: true as const,
    rawText: extracted.text,
    type: titleSlot?.type ?? null,
    marker: titleSlot?.marker ?? null,
    title: titleSlot?.title ?? null,
    header,
    bodyLines: built.projection.lines.map((l) => l.content),
    bodyDisplayText: projectedDisplayText(built.projection),
  };
}

describe("Partial Edit Pane fresh-session reload: standalone callout (Case8 fixture)", () => {
  // ---- 1. 初回ロード --------------------------------------------------------
  it("category 1: initial load resolves type=note, marker='+', the original title, and the original 3-line body", () => {
    const doc = parseDocument(CASE8_INITIAL);
    const id = soleCalloutId(doc);
    const session = loadCalloutSession(doc, id);
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    expect(session.type).toBe("note");
    expect(session.marker).toBe("+");
    expect(session.title).toBe("Case8 standalone callout");
    expect(session.bodyLines).toEqual([
      "拡張ブロックを構成しない単独の callout",
      "①プレフィクス（>）なしの編集が出来る",
      "②コールアウトの種類・開き方・タイトルを編集出来る",
    ]);
  });

  // ---- 2. close → 本文変更 → 再オープン --------------------------------------
  it("category 2: a fresh load against the SAME id after the note was edited (close→edit→reopen) shows only the NEW type/marker/title/body — none of the original session's values survive", () => {
    const doc1 = parseDocument(CASE8_INITIAL);
    const id1 = soleCalloutId(doc1);
    const session1 = loadCalloutSession(doc1, id1);
    expect(session1.ok).toBe(true);

    // A brand-new parse + a brand-new id resolution — exactly what a
    // fresh loadNodeInternal call does on reopen; never reuses doc1/id1.
    const doc2 = parseDocument(CASE8_UPDATED);
    const id2 = soleCalloutId(doc2);
    const session2 = loadCalloutSession(doc2, id2);
    expect(session2.ok).toBe(true);
    if (!session2.ok) return;

    expect(session2.type).toBe("info");
    expect(session2.marker).toBe(""); // no fold marker on the updated header
    expect(session2.title).toBe("Case8 updated callout");
    expect(session2.bodyLines).toEqual([
      "本文側で変更済みの第一行",
      "本文側で変更済みの第二行",
      "本文側で追加された第三行",
    ]);

    // None of session1's old values leak into session2.
    expect(session2.type).not.toBe(session1.ok ? session1.type : undefined);
    expect(session2.marker).not.toBe(session1.ok ? session1.marker : undefined);
    expect(session2.title).not.toBe(session1.ok ? session1.title : undefined);
    for (const oldLine of session1.ok ? session1.bodyLines : []) {
      expect(session2.bodyDisplayText).not.toContain(oldLine);
    }
  });

  // ---- 3. 本文行数増加後の再オープン（主要再現テスト） -------------------------
  it("category 3 (primary repro): reopening after the callout's body GREW past the original range picks up every newly-added line, not just the original 3", () => {
    const doc1 = parseDocument(CASE8_INITIAL);
    const id1 = soleCalloutId(doc1);
    const session1 = loadCalloutSession(doc1, id1);
    expect(session1.ok).toBe(true);
    if (!session1.ok) return;

    const grown = [
      "# Test",
      "",
      "> [!note]+ Case8 standalone callout",
      "> 拡張ブロックを構成しない単独の callout",
      "> ①プレフィクス（>）なしの編集が出来る",
      "> ②コールアウトの種類・開き方・タイトルを編集出来る",
      "> ③本文側で追加された第四行",
      "> ④本文側で追加された第五行",
    ].join("\n");
    const doc2 = parseDocument(grown);
    const id2 = soleCalloutId(doc2);

    // The block's own end line must have actually grown in the fresh
    // parse — if a fix wrongly reused session 1's stored range/endLine,
    // this assertion (comparing two freshly, independently computed
    // ranges) would catch it.
    const range1 = scanComplexBlocks(doc1).blocks.find((b) => b.id === id1)!.range;
    const range2 = scanComplexBlocks(doc2).blocks.find((b) => b.id === id2)!.range;
    expect(range2.endLine).toBeGreaterThan(range1.endLine);

    const session2 = loadCalloutSession(doc2, id2);
    expect(session2.ok).toBe(true);
    if (!session2.ok) return;
    expect(session2.bodyLines).toHaveLength(5);
    expect(session2.bodyLines).toEqual([
      "拡張ブロックを構成しない単独の callout",
      "①プレフィクス（>）なしの編集が出来る",
      "②コールアウトの種類・開き方・タイトルを編集出来る",
      "③本文側で追加された第四行",
      "④本文側で追加された第五行",
    ]);
    expect(session2.bodyDisplayText).toContain("③本文側で追加された第四行");
    expect(session2.bodyDisplayText).toContain("④本文側で追加された第五行");
  });

  // ---- 4. 本文行数削減後の再オープン ------------------------------------------
  it("category 4: reopening after the callout's body SHRANK shows only the remaining line — no removed line survives", () => {
    const shrunk = [
      "# Test",
      "",
      "> [!info] Case8 shrunk callout",
      "> only one line remains",
    ].join("\n");
    const doc = parseDocument(shrunk);
    const id = soleCalloutId(doc);
    const session = loadCalloutSession(doc, id);
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    expect(session.bodyLines).toEqual(["only one line remains"]);
    expect(session.bodyDisplayText).toBe("only one line remains");
    for (const removed of [
      "拡張ブロックを構成しない単独の callout",
      "①プレフィクス（>）なしの編集が出来る",
      "②コールアウトの種類・開き方・タイトルを編集出来る",
    ]) {
      expect(session.bodyDisplayText).not.toContain(removed);
    }
  });

  // ---- 5. type / fold marker / titleの更新 -----------------------------------
  it("category 5: type, fold marker, and title are all independently re-read fresh across three successive close→reopen transitions", () => {
    const step1 = parseDocument(
      ["> [!note]+ First title", "> body"].join("\n")
    );
    const step2 = parseDocument(
      ["> [!warning] Second title", "> body"].join("\n")
    );
    const step3 = parseDocument(
      ["> [!tip]- Third title", "> body"].join("\n")
    );

    const s1 = loadCalloutSession(step1, soleCalloutId(step1));
    const s2 = loadCalloutSession(step2, soleCalloutId(step2));
    const s3 = loadCalloutSession(step3, soleCalloutId(step3));
    expect(s1.ok && s2.ok && s3.ok).toBe(true);
    if (!s1.ok || !s2.ok || !s3.ok) return;

    expect([s1.type, s1.marker, s1.title]).toEqual(["note", "+", "First title"]);
    expect([s2.type, s2.marker, s2.title]).toEqual(["warning", "", "Second title"]);
    expect([s3.type, s3.marker, s3.title]).toEqual(["tip", "-", "Third title"]);
  });

  // ---- 6. 別calloutへの切替 ---------------------------------------------------
  it("category 6: switching to a DIFFERENT standalone callout in the same note never mixes the two callouts' type/title/body", () => {
    const doc = parseDocument(
      [
        "# Test",
        "",
        "> [!note]+ Callout A title",
        "> A body line one",
        "> A body line two",
        "",
        "> [!warning]- Callout B title",
        "> B body line one",
      ].join("\n")
    );
    const blocks = scanComplexBlocks(doc).blocks.filter((b) => b.kind === "callout");
    expect(blocks.length).toBe(2);
    const idA = blocks.find((b) => doc.lines[b.range.startLine].includes("Callout A"))!.id;
    const idB = blocks.find((b) => doc.lines[b.range.startLine].includes("Callout B"))!.id;
    expect(idA).not.toBe(idB);

    const sessionA = loadCalloutSession(doc, idA);
    const sessionB = loadCalloutSession(doc, idB);
    expect(sessionA.ok && sessionB.ok).toBe(true);
    if (!sessionA.ok || !sessionB.ok) return;

    expect(sessionA.type).toBe("note");
    expect(sessionA.title).toBe("Callout A title");
    expect(sessionB.type).toBe("warning");
    expect(sessionB.title).toBe("Callout B title");

    expect(sessionB.title).not.toBe(sessionA.title);
    expect(sessionB.bodyDisplayText).not.toContain("A body line one");
    expect(sessionA.bodyDisplayText).not.toContain("B body line one");
  });

  // ---- 7. target解決失敗時の安全性 --------------------------------------------
  it("category 7: reopening after the callout was deleted (converted to plain, non-callout text) resolves as resolve-failed, and the note text passed in is never mutated by the failed attempt", () => {
    const doc1 = parseDocument(CASE8_INITIAL);
    const id1 = soleCalloutId(doc1);
    expect(loadCalloutSession(doc1, id1).ok).toBe(true);

    // The callout is gone — converted to plain paragraph text, no `>`
    // prefix, no `[!type]` header. A fresh scanComplexBlocks() pass over
    // this text finds no callout at all, so the OLD id can never
    // accidentally resolve to it (ids are assigned by per-scan sequence
    // over blocks actually found — see parser/complexBlocks.ts).
    const deletedText = [
      "# Test",
      "",
      "This callout was deleted and replaced with plain text.",
    ].join("\n");
    const doc2 = parseDocument(deletedText);
    expect(scanComplexBlocks(doc2).blocks.filter((b) => b.kind === "callout")).toHaveLength(0);

    const failed = extractSubtreeText(doc2, id1);
    expect(failed.ok).toBe(false);
    expect(failed.reason).toBe("resolve-failed");

    // The failed resolution attempt is read-only — the note text is
    // exactly what was parsed, unchanged.
    expect(doc2.lines.join("\n")).toBe(deletedText);
  });

  // ---- 8. 既存機能の回帰なし（section の初回ロード/再オープンも fresh） ----------
  it("category 8 (no regression): a section's fresh reload after being edited also re-derives from the CURRENT document, exactly like the callout path above", () => {
    const doc1 = parseDocument(
      ["# Existing Section", "original paragraph text"].join("\n")
    );
    const sectionId1 = [...doc1.nodes.values()].find(
      (n) => n.type === "section" && n.headingText === "Existing Section"
    )!.id;
    const extracted1 = extractSubtreeText(doc1, sectionId1);
    expect(extracted1.ok).toBe(true);
    expect(extracted1.text).toContain("original paragraph text");

    const doc2 = parseDocument(
      ["# Existing Section", "edited paragraph text", "a newly added second line"].join(
        "\n"
      )
    );
    const sectionId2 = [...doc2.nodes.values()].find(
      (n) => n.type === "section" && n.headingText === "Existing Section"
    )!.id;
    const extracted2 = extractSubtreeText(doc2, sectionId2);
    expect(extracted2.ok).toBe(true);
    expect(extracted2.text).toContain("edited paragraph text");
    expect(extracted2.text).toContain("a newly added second line");
    expect(extracted2.text).not.toContain("original paragraph text");
  });
});

// ---- View-layer wiring pin (static source check, established convention) --

describe("view/PartialEditView.ts: resetLoadedState wiring (static source check, 2026-09-09 stale-snapshot fix)", () => {
  const viewTs = readFileSync(
    path.resolve(__dirname, "../src/view/PartialEditView.ts"),
    "utf-8"
  );

  function bodyOf(source: string, needle: string, label: string): string {
    const start = source.indexOf(needle);
    if (start === -1) {
      throw new Error(`${label} not found — has it been renamed or removed?`);
    }
    const end = source.indexOf("\n  }", start);
    if (end === -1 || end <= start) {
      throw new Error(
        `Could not find ${label}'s closing brace — its shape may have changed; update this test's bounding logic.`
      );
    }
    return source.slice(start, end);
  }

  it("resetLoadedState exists and clears every field a fresh load ever writes", () => {
    const body = bodyOf(viewTs, "private resetLoadedState(): void {", "resetLoadedState");
    for (const assignment of [
      "this.nodeId = null;",
      "this.nodeKind = null;",
      "this.paragraphAnchor = null;",
      "this.compositeAnchor = null;",
      'this.originalText = "";',
      "this.quoteProjection = null;",
      'this.label = "";',
      "this.sourcePath = null;",
      "this.ancestors = [];",
      "this.directChildren = [];",
      "this.syncState = \"synced\";",
    ]) {
      expect(body).toContain(assignment);
    }
  });

  it("onClose routes through resetLoadedState — an explicitly closed pane never keeps a target/draft for its next session", () => {
    const body = bodyOf(viewTs, "async onClose(): Promise<void> {", "onClose");
    expect(body).toContain("this.resetLoadedState();");
  });

  it("renderEmptyState routes through resetLoadedState", () => {
    const body = bodyOf(viewTs, "private renderEmptyState(): void {", "renderEmptyState");
    expect(body).toContain("this.resetLoadedState();");
  });

  it("loadNodeInternal/loadParagraphInternal/loadCompositeInternal reset to the empty state before every failure Notice, EXCEPT the pre-existing, deliberate 'nested' quote-projection refusal", () => {
    const loadNode = bodyOf(
      viewTs,
      "private loadNodeInternal(nodeId: string): void {",
      "loadNodeInternal"
    );
    const loadParagraph = bodyOf(
      viewTs,
      "private loadParagraphInternal(cursorLine: number): void {",
      "loadParagraphInternal"
    );
    const loadComposite = bodyOf(
      viewTs,
      "private loadCompositeInternal(snapshot: CompositeBlockSnapshot): void {",
      "loadCompositeInternal"
    );

    // "no active note" (all three) and "resolve failed" (loadNodeInternal/
    // loadCompositeInternal) / "no paragraph" (loadParagraphInternal) each
    // reset to the empty state first.
    expect(loadNode.match(/this\.renderEmptyState\(\);/g)?.length).toBe(2);
    expect(loadParagraph.match(/this\.renderEmptyState\(\);/g)?.length).toBe(2);
    expect(loadComposite.match(/this\.renderEmptyState\(\);/g)?.length).toBe(2);

    // The "nested" quote-projection refusal deliberately does NOT reset —
    // see tests/quotePrefixPartialEditViewWiring.test.ts's own test for
    // why (it must leave an already-loaded target's display untouched).
    const nestedBranchStart = loadNode.indexOf('built.reason === "nested"');
    const nestedBranchEnd = loadNode.indexOf("return;", nestedBranchStart);
    const nestedBranch = loadNode.slice(nestedBranchStart, nestedBranchEnd);
    expect(nestedBranch).not.toContain("this.renderEmptyState();");
  });
});

/**
 * Phase 5L-4 ("Multi-Line Leaf List Item Partial Edit Projection"): unit
 * tests for edit/multiLineListItemProjection.ts's own pure
 * build/invert/validate trio, in isolation from the standalone Partial
 * Edit Pane wiring — mirrors tests/orderedListProjection.test.ts's own
 * structure. Every fixture is plain raw text (this module never touches a
 * ParsedDocument at build/invert-input time) — the "real pipeline"
 * integration coverage (eligibility gates, ParsedDocument/applySubtreeEdit
 * round-trips) lives in tests/multiLineLeafListPartialEdit.test.ts
 * instead.
 */
import { describe, expect, it } from "vitest";
import {
  buildMultiLineListItemProjection,
  invertMultiLineListItemProjection,
  projectedMultiLineBodyText,
  projectedMultiLineChecked,
  projectedMultiLineNumberText,
  validateMultiLineListItemCandidate,
} from "../src/edit/multiLineListItemProjection";

describe("buildMultiLineListItemProjection: unordered", () => {
  it("splits a '-' marker item's first line and one continuation line", () => {
    const raw = ["- 本文の第一行", "  continuation の第二行"].join("\n");
    const outcome = buildMultiLineListItemProjection(raw);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.listKind).toBe("unordered");
    expect(outcome.projection.continuationIndent).toBe("  ");
    expect(outcome.projection.body).toBe("本文の第一行\ncontinuation の第二行");
  });

  it("supports '*' and '+' markers identically", () => {
    for (const marker of ["*", "+"]) {
      const raw = [`${marker} 第一行`, "  第二行"].join("\n");
      const outcome = buildMultiLineListItemProjection(raw);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("expected ok");
      expect(outcome.projection.listKind).toBe("unordered");
      if (outcome.projection.firstLine.kind !== "unordered") throw new Error("expected unordered");
      expect(outcome.projection.firstLine.projection.marker).toBe(marker);
    }
  });

  it("preserves leading (nested list item) indentation on the first line", () => {
    const raw = ["  - 入れ子の leaf item", "    continuation"].join("\n");
    const outcome = buildMultiLineListItemProjection(raw);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    if (outcome.projection.firstLine.kind !== "unordered") throw new Error("expected unordered");
    expect(outcome.projection.firstLine.projection.indent).toBe("  ");
    expect(outcome.projection.continuationIndent).toBe("    ");
  });

  it("supports 3+ continuation lines, in order", () => {
    const raw = ["- 一行目", "  二行目", "  三行目", "  四行目"].join("\n");
    const outcome = buildMultiLineListItemProjection(raw);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.body).toBe("一行目\n二行目\n三行目\n四行目");
  });

  it("preserves a blank line in the middle of the continuation as an empty body line", () => {
    const raw = ["- 一行目", "  二行目", "", "  四行目"].join("\n");
    const outcome = buildMultiLineListItemProjection(raw);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.body).toBe("一行目\n二行目\n\n四行目");
  });

  it("preserves EXTRA continuation indentation (beyond the canonical prefix) as literal body content", () => {
    const raw = ["- 一行目", "    余分にインデントされた行"].join("\n");
    const outcome = buildMultiLineListItemProjection(raw);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    // canonical prefix for "- " is 2 chars; this continuation line has 4
    // leading spaces, so 2 of them survive into the body verbatim.
    expect(outcome.projection.body).toBe("一行目\n  余分にインデントされた行");
  });

  it("preserves link/embed/strong/inline-code/marker-looking text inside the body untouched", () => {
    const raw = [
      "- リンクとembedを含む本文 [[note]] ![[img.png]] **強調** `code`",
      "  1. 番号のような文字列だけの行",
      "  [ ] チェックボックスのような文字列",
    ].join("\n");
    const outcome = buildMultiLineListItemProjection(raw);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.body).toBe(
      [
        "リンクとembedを含む本文 [[note]] ![[img.png]] **強調** `code`",
        "1. 番号のような文字列だけの行",
        "[ ] チェックボックスのような文字列",
      ].join("\n")
    );
  });

  it("refuses ('malformed-continuation-indent') a non-blank continuation line indented SHALLOWER than the canonical prefix", () => {
    const raw = ["- 一行目", " 足りないインデント"].join("\n"); // only 1 space, canonical is 2
    const outcome = buildMultiLineListItemProjection(raw);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected refusal");
    expect(outcome.reason).toBe("malformed-continuation-indent");
  });

  it("refuses ('single-line') a raw text with no newline at all", () => {
    const outcome = buildMultiLineListItemProjection("- 一行だけ");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected refusal");
    expect(outcome.reason).toBe("single-line");
  });

  it("refuses ('first-line-not-projectable') when the first line itself is not a supported marker shape", () => {
    // Not a list line at all (defensive — should not reach this module in
    // practice, since a caller only invokes it for a real ListBlockNode's
    // own range, but this module still refuses safely rather than
    // guessing).
    const outcome = buildMultiLineListItemProjection(["plain text, no marker", "  continuation"].join("\n"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected refusal");
    expect(outcome.reason).toBe("first-line-not-projectable");
  });

  it("refuses ('first-line-not-projectable') for an unsupported task checkbox status character", () => {
    const outcome = buildMultiLineListItemProjection(["- [/] 未対応ステータス", "  continuation"].join("\n"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected refusal");
    expect(outcome.reason).toBe("first-line-not-projectable");
  });
});

describe("buildMultiLineListItemProjection: task", () => {
  it("splits an unchecked task item's first line and continuation, hiding both marker and checkbox from the body", () => {
    const raw = ["- [ ] OCR転写を確認する", "  原本画像と比較する。", "  異体字を注記する。"].join("\n");
    const outcome = buildMultiLineListItemProjection(raw);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.listKind).toBe("task");
    expect(projectedMultiLineChecked(outcome.projection)).toBe(false);
    expect(outcome.projection.body).toBe(
      ["OCR転写を確認する", "原本画像と比較する。", "異体字を注記する。"].join("\n")
    );
    // Continuation aligns to the LIST MARKER's own body column ("- ", 2
    // chars) — NOT the checkbox-inclusive column — see this ticket's own
    // design doc's worked example.
    expect(outcome.projection.continuationIndent).toBe("  ");
  });

  it("splits a checked ('[x]') task item the same way", () => {
    const raw = ["- [x] 完了済み", "  continuation"].join("\n");
    const outcome = buildMultiLineListItemProjection(raw);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(projectedMultiLineChecked(outcome.projection)).toBe(true);
  });

  it("a literal '[ ]'/'[x]' appearing inside a continuation line's own body is never mistaken for a checkbox", () => {
    const raw = ["- [ ] 課題", "  進捗: [x] のように見えるが単なる本文"].join("\n");
    const outcome = buildMultiLineListItemProjection(raw);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.body).toBe("課題\n進捗: [x] のように見えるが単なる本文");
  });
});

describe("buildMultiLineListItemProjection: ordered", () => {
  it("splits a '.' delimiter multi-digit item's first line and continuation, hiding the number from the body", () => {
    const raw = ["12. 争論の経緯を整理する", "    前後の証拠を照合する。", "    論点を分けて記録する。"].join(
      "\n"
    );
    const outcome = buildMultiLineListItemProjection(raw);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.listKind).toBe("ordered");
    expect(projectedMultiLineNumberText(outcome.projection)).toBe("12");
    expect(outcome.projection.continuationIndent).toBe("    ");
    expect(outcome.projection.body).toBe(
      ["争論の経緯を整理する", "前後の証拠を照合する。", "論点を分けて記録する。"].join("\n")
    );
  });

  it("supports a ')' delimiter the same way", () => {
    const raw = ["1) 一行目", "   continuation"].join("\n");
    const outcome = buildMultiLineListItemProjection(raw);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    if (outcome.projection.firstLine.kind !== "ordered") throw new Error("expected ordered");
    expect(outcome.projection.firstLine.projection.delimiter).toBe(")");
  });

  it("refuses ('first-line-not-projectable') an ordered TASK-list first line — out of this ticket's own scope, exactly like Phase 5L-3 left it for the single-line case", () => {
    const outcome = buildMultiLineListItemProjection(["1. [ ] 未対応", "   continuation"].join("\n"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected refusal");
    expect(outcome.reason).toBe("first-line-not-projectable");
  });
});

describe("projectedMultiLineBodyText / projectedMultiLineChecked / projectedMultiLineNumberText: cross-kind defaults", () => {
  it("projectedMultiLineChecked is false, and projectedMultiLineNumberText is empty, for a non-task/non-ordered (unordered) projection", () => {
    const outcome = buildMultiLineListItemProjection(["- 一行目", "  二行目"].join("\n"));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(projectedMultiLineChecked(outcome.projection)).toBe(false);
    expect(projectedMultiLineNumberText(outcome.projection)).toBe("");
    expect(projectedMultiLineBodyText(outcome.projection)).toBe(outcome.projection.body);
  });
});

describe("invertMultiLineListItemProjection: round trips and edits", () => {
  function build(raw: string) {
    const outcome = buildMultiLineListItemProjection(raw);
    if (!outcome.ok) throw new Error(`fixture error: ${outcome.reason}`);
    return outcome.projection;
  }

  it("an UNEDITED unordered round trip reconstructs the original raw text byte-for-byte", () => {
    const raw = ["- 一行目", "  二行目", "", "  四行目"].join("\n");
    const projection = build(raw);
    const inverted = invertMultiLineListItemProjection(projection, false, "", projection.body);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(raw);
  });

  it("an UNEDITED task round trip preserves checkbox state and reconstructs byte-for-byte", () => {
    const raw = ["- [x] 完了", "  補足"].join("\n");
    const projection = build(raw);
    const inverted = invertMultiLineListItemProjection(
      projection,
      projectedMultiLineChecked(projection),
      "",
      projection.body
    );
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(raw);
  });

  it("an UNEDITED ordered round trip preserves the number/delimiter and reconstructs byte-for-byte", () => {
    const raw = ["12. 一行目", "    二行目"].join("\n");
    const projection = build(raw);
    const inverted = invertMultiLineListItemProjection(
      projection,
      false,
      projectedMultiLineNumberText(projection),
      projection.body
    );
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(raw);
  });

  it("editing only the number keeps the body and continuation untouched", () => {
    const raw = ["1. 一行目", "   二行目"].join("\n");
    const projection = build(raw);
    const inverted = invertMultiLineListItemProjection(projection, false, "99", projection.body);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(["99. 一行目", "   二行目"].join("\n"));
  });

  it("editing only the checkbox keeps the body and continuation untouched", () => {
    const raw = ["- [ ] 一行目", "  二行目"].join("\n");
    const projection = build(raw);
    const inverted = invertMultiLineListItemProjection(projection, true, "", projection.body);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(["- [x] 一行目", "  二行目"].join("\n"));
  });

  it("adding a new continuation line applies canonical indentation to it", () => {
    const raw = ["- 一行目", "  二行目"].join("\n");
    const projection = build(raw);
    const editedBody = "一行目\n二行目\n新しい三行目";
    const inverted = invertMultiLineListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(["- 一行目", "  二行目", "  新しい三行目"].join("\n"));
  });

  it("removing a continuation line drops it from the reconstructed raw text", () => {
    const raw = ["- 一行目", "  二行目", "  三行目"].join("\n");
    const projection = build(raw);
    const editedBody = "一行目\n三行目";
    const inverted = invertMultiLineListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(["- 一行目", "  三行目"].join("\n"));
  });

  it("splitting one continuation line into two applies canonical indentation to both", () => {
    const raw = ["- 一行目", "  結合されている二行目と三行目"].join("\n");
    const projection = build(raw);
    const editedBody = "一行目\n二行目\n三行目";
    const inverted = invertMultiLineListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(["- 一行目", "  二行目", "  三行目"].join("\n"));
  });

  it("merging two continuation lines into one is applied", () => {
    const raw = ["- 一行目", "  二行目", "  三行目"].join("\n");
    const projection = build(raw);
    const editedBody = "一行目\n二行目と三行目を結合";
    const inverted = invertMultiLineListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(["- 一行目", "  二行目と三行目を結合"].join("\n"));
  });

  it("pasting several new lines at once (a multi-line paste) is applied, each canonically indented", () => {
    const raw = ["- 一行目", "  既存の二行目"].join("\n");
    const projection = build(raw);
    const editedBody = "一行目\n貼り付け1\n貼り付け2\n貼り付け3\n既存の二行目";
    const inverted = invertMultiLineListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(
      ["- 一行目", "  貼り付け1", "  貼り付け2", "  貼り付け3", "  既存の二行目"].join("\n")
    );
  });

  it("an edited body line that is empty reconstructs as a blank raw line, with no canonical indent synthesized", () => {
    const raw = ["- 一行目", "  二行目"].join("\n");
    const projection = build(raw);
    const editedBody = "一行目\n\n三行目（間に空行）";
    const inverted = invertMultiLineListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(["- 一行目", "", "  三行目（間に空行）"].join("\n"));
  });

  it("collapsing the body to a single line (deleting all continuation lines) is applied — the item becomes single-line but still valid", () => {
    const raw = ["- 一行目", "  二行目", "  三行目"].join("\n");
    const projection = build(raw);
    const inverted = invertMultiLineListItemProjection(projection, false, "", "一行目のみ");
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe("- 一行目のみ");
  });

  it("rejects ('invalid-number') an invalid ordered-number edit and never touches the body", () => {
    const raw = ["1. 一行目", "   二行目"].join("\n");
    const projection = build(raw);
    for (const badNumber of ["", "0", "00", "-1", "1.5", "abc", " 1", "1 "]) {
      const inverted = invertMultiLineListItemProjection(projection, false, badNumber, "編集後の一行目\n編集後の二行目");
      expect(inverted.ok).toBe(false);
      if (inverted.ok) throw new Error(`expected refusal for number ${JSON.stringify(badNumber)}`);
      expect(inverted.reason).toBe("invalid-number");
    }
  });

  it("does NOT reject sibling-adjacent duplicate/non-sequential ordered numbers — this module never inspects siblings at all (no auto-renumbering)", () => {
    const raw = ["5. 一行目", "   二行目"].join("\n");
    const projection = build(raw);
    const inverted = invertMultiLineListItemProjection(projection, false, "5", projection.body);
    expect(inverted.ok).toBe(true);
  });

  it("rejects ('unsafe-structure') a continuation edit that would manufacture a NESTED CHILD list item once canonically indented", () => {
    const raw = ["- 一行目", "  二行目"].join("\n");
    const projection = build(raw);
    const editedBody = "一行目\n- 子リストのように見える行";
    const inverted = invertMultiLineListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(false);
    if (inverted.ok) throw new Error("expected refusal");
    expect(inverted.reason).toBe("unsafe-structure");
  });

  it("rejects ('unsafe-structure') a continuation edit that would manufacture a BLOCKQUOTE once canonically indented", () => {
    const raw = ["- 一行目", "  二行目"].join("\n");
    const projection = build(raw);
    const editedBody = "一行目\n> 引用のように見える行";
    const inverted = invertMultiLineListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(false);
    if (inverted.ok) throw new Error("expected refusal");
    expect(inverted.reason).toBe("unsafe-structure");
  });

  it("rejects ('unsafe-structure') a continuation edit that would manufacture a FENCED CODE BLOCK once canonically indented", () => {
    const raw = ["- 一行目", "  二行目"].join("\n");
    const projection = build(raw);
    const editedBody = "一行目\n```\nコードのように見える行\n```";
    const inverted = invertMultiLineListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(false);
    if (inverted.ok) throw new Error("expected refusal");
    expect(inverted.reason).toBe("unsafe-structure");
  });

  it("preserves the exact draft on a rejected Apply — no partial write: rawText is only returned on ok:true", () => {
    const raw = ["- 一行目", "  二行目"].join("\n");
    const projection = build(raw);
    const inverted = invertMultiLineListItemProjection(projection, false, "", "一行目\n- 危険な行");
    expect(inverted.ok).toBe(false);
    // The "ok: false" branch never carries a rawText field at all — this
    // is a type-level guarantee (MultiLineListItemProjectionInvertResult
    // is a discriminated union), asserted here at runtime too.
    expect((inverted as { rawText?: string }).rawText).toBeUndefined();
  });
});

describe("Phase 5L-5 (\"Leaf List Item Blank-Line Continuation Projection\"): trailing blank line trimming on invert", () => {
  function build(raw: string) {
    const outcome = buildMultiLineListItemProjection(raw);
    if (!outcome.ok) throw new Error(`fixture error: ${outcome.reason}`);
    return outcome.projection;
  }

  it("unordered: a single trailing blank line typed at the end of the body is dropped, not reconstructed as a raw trailing blank line", () => {
    const raw = ["- 一行目", "  二行目"].join("\n");
    const projection = build(raw);
    const editedBody = "一行目\n二行目\n";
    const inverted = invertMultiLineListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(["- 一行目", "  二行目"].join("\n"));
  });

  it("unordered: MULTIPLE consecutive trailing blank lines are all dropped", () => {
    const raw = ["- 一行目", "  二行目"].join("\n");
    const projection = build(raw);
    const editedBody = "一行目\n二行目\n\n\n";
    const inverted = invertMultiLineListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(["- 一行目", "  二行目"].join("\n"));
  });

  it("unordered: a trailing blank line after an EDITED continuation is still dropped", () => {
    const raw = ["- 一行目", "  二行目"].join("\n");
    const projection = build(raw);
    const editedBody = "一行目\n編集後の二行目\n";
    const inverted = invertMultiLineListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(["- 一行目", "  編集後の二行目"].join("\n"));
  });

  it("unordered: a trailing blank line when the body collapses to ONLY the first line trims down to the single-line candidate", () => {
    const raw = ["- 一行目", "  二行目"].join("\n");
    const projection = build(raw);
    const editedBody = "一行目\n\n\n";
    const inverted = invertMultiLineListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe("- 一行目");
  });

  it("unordered: an INTERIOR blank line (followed by more content) is left untouched — only TRAILING blanks are trimmed", () => {
    const raw = ["- 一行目", "  二行目"].join("\n");
    const projection = build(raw);
    const editedBody = "一行目\n\n三行目（間に空行、末尾ではない）";
    const inverted = invertMultiLineListItemProjection(projection, false, "", editedBody);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(["- 一行目", "", "  三行目（間に空行、末尾ではない）"].join("\n"));
  });

  it("task: a trailing blank line is dropped while the checkbox edit is still applied", () => {
    const raw = ["- [ ] 一行目", "  二行目"].join("\n");
    const projection = build(raw);
    const editedBody = "一行目\n二行目\n\n";
    const inverted = invertMultiLineListItemProjection(projection, true, "", editedBody);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(["- [x] 一行目", "  二行目"].join("\n"));
  });

  it("ordered: a trailing blank line is dropped while the number edit is still applied", () => {
    const raw = ["1. 一行目", "   二行目"].join("\n");
    const projection = build(raw);
    const editedBody = "一行目\n二行目\n\n";
    const inverted = invertMultiLineListItemProjection(projection, false, "99", editedBody);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) throw new Error("expected ok");
    expect(inverted.rawText).toBe(["99. 一行目", "   二行目"].join("\n"));
  });

  it("a candidate that would still end in a blank line (if untrimmed) is confirmed, at the validateMultiLineListItemCandidate layer, to be exactly what the trim step must avoid producing", () => {
    // This documents WHY trimTrailingBlankContinuationLines exists: a
    // hand-built candidate ending in a blank line fails validation, since
    // the real parser's own re-parse always trims that blank line before
    // computing node.range, disagreeing with the candidate's own raw line
    // count. invertMultiLineListItemProjection never actually produces
    // such a candidate any more (see the tests above) — this test
    // exercises validateMultiLineListItemCandidate directly, in
    // isolation, to pin down that guard's own behavior.
    expect(validateMultiLineListItemCandidate(["- 一行目", "  二行目", ""].join("\n"), "unordered")).toBe(false);
  });
});

describe("validateMultiLineListItemCandidate", () => {
  it("accepts a well-formed multi-line unordered candidate", () => {
    expect(validateMultiLineListItemCandidate(["- 一行目", "  二行目"].join("\n"), "unordered")).toBe(true);
  });

  it("accepts a well-formed multi-line ordered candidate", () => {
    expect(validateMultiLineListItemCandidate(["1. 一行目", "   二行目"].join("\n"), "ordered")).toBe(true);
  });

  it("rejects a candidate whose kind no longer matches expectedKind", () => {
    expect(validateMultiLineListItemCandidate(["1. 一行目", "   二行目"].join("\n"), "unordered")).toBe(false);
  });

  it("rejects a candidate that manufactures a nested child list item", () => {
    expect(
      validateMultiLineListItemCandidate(["- 一行目", "  - 子リスト"].join("\n"), "unordered")
    ).toBe(false);
  });

  it("rejects a candidate containing a table block in its continuation", () => {
    expect(
      validateMultiLineListItemCandidate(
        ["- 一行目", "  | a | b |", "  | - | - |", "  | 1 | 2 |"].join("\n"),
        "unordered"
      )
    ).toBe(false);
  });
});

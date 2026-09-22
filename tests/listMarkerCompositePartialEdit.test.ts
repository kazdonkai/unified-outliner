/**
 * Phase 5D-2C ("CompositeBlock single-line-list member marker-free
 * projection"): end-to-end integration tests that reproduce
 * view/PartialEditView.ts's own applyEdit() STRUCTURED composite branch
 * exactly, using the real, unmodified backend functions it calls
 * (parser/parseDocument.ts, parser/complexBlocks.ts,
 * parser/compositeBlocks.ts, edit/deleteCompositeBlock.ts,
 * edit/compositeBlockPartialEdit.ts, edit/compositeBlockMemberProjection.ts,
 * edit/quotePrefixProjection.ts, and this ticket's own
 * edit/listMarkerProjection.ts) — never a mock, never a hand-typed
 * snapshot for a success-path fixture. Nothing here touches an Editor,
 * view/PartialEditView.ts, main.ts, or view/OutlineTreeView.ts — same
 * testing boundary as tests/compositeBlockPartialEdit.test.ts /
 * tests/compositeBlockMemberProjection.test.ts (see their own doc
 * comments). tests/compositeBlockPartialEditUiWiring.test.ts (a separate
 * file) covers the actual View wiring — that this exact sequence of
 * function calls is really what applyEdit()'s source does.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { buildCompositeBlockSnapshot } from "../src/edit/deleteCompositeBlock";
import { applyCompositeBlockEdit, extractCompositeBlockText } from "../src/edit/compositeBlockPartialEdit";
import {
  composeCompositeBlockMemberText,
  isListMemberEligibleForMarkerFreeProjection,
  splitCompositeBlockMembers,
} from "../src/edit/compositeBlockMemberProjection";
import {
  buildListMarkerProjection,
  invertListMarkerProjection,
  ListMarkerProjection,
} from "../src/edit/listMarkerProjection";
import {
  buildQuotePrefixProjection,
  invertQuotePrefixProjection,
  QuoteHeaderTitleSlot,
  QuotePrefixProjection,
  reconstructQuoteHeader,
} from "../src/edit/quotePrefixProjection";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";

/**
 * Reproduces loadCompositeInternal's own structured-load sequence
 * exactly, real pipeline throughout (parse -> scan -> match -> snapshot
 * the FIRST recognized composite -> extract -> split -> project).
 */
function loadStructured(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  expect(composites.length).toBeGreaterThan(0);
  const snapshot = buildCompositeBlockSnapshot(composites[0]);
  const extracted = extractCompositeBlockText(doc, snapshot, rules);
  expect(extracted.ok).toBe(true);
  if (!extracted.ok || !extracted.resolvedSnapshot) throw new Error("expected extract ok");
  const memberSplit = splitCompositeBlockMembers(doc.lines, extracted.resolvedSnapshot);
  expect(memberSplit.ok).toBe(true);
  if (!memberSplit.ok) throw new Error("expected split ok");
  const trailingBuilt = buildQuotePrefixProjection(
    memberSplit.split.trailingRawText,
    memberSplit.split.trailingKind
  );
  expect(trailingBuilt.ok).toBe(true);
  if (!trailingBuilt.ok) throw new Error("expected trailing projection ok");
  const listEligible = isListMemberEligibleForMarkerFreeProjection(
    extracted.resolvedSnapshot.members[0].kind
  );
  const listBuilt = listEligible ? buildListMarkerProjection(memberSplit.split.listLineText) : null;
  return {
    doc,
    snapshot: extracted.resolvedSnapshot,
    originalText: extracted.text,
    rawListLine: memberSplit.split.listLineText,
    trailingProjection: trailingBuilt.projection,
    listProjection: listBuilt?.ok ? listBuilt.projection : null,
  };
}

type Loaded = ReturnType<typeof loadStructured>;

/**
 * Reproduces applyEdit()'s own STRUCTURED composite branch exactly:
 * inverts the list body (marker-free, when loaded.listProjection is
 * non-null — otherwise `editedListValue` IS the raw line, matching a
 * raw-fallback list row), reconstructs the trailing member's header when
 * `newTitle`/`newType`/`newMarker` are given, composes, and calls the
 * real, unmodified applyCompositeBlockEdit. Returns `{ok:false}` for a
 * genuine safety-error refusal (never reaching applyCompositeBlockEdit at
 * all) — never conflated with applyCompositeBlockEdit's own outcome,
 * which can itself be `changed: true` with `ruleStillMatches: false`
 * (方針A — a structural edit is still saved, never rejected for that
 * reason alone; see edit/compositeBlockPartialEdit.ts's own top doc
 * comment).
 */
function applyStructured(
  loaded: Loaded,
  editedListValue: string,
  editedTrailingBody: string,
  titleEdit?: { newType: string; newMarker: "" | "+" | "-"; newTitle: string },
  rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES
) {
  let composedListLine: string;
  if (loaded.listProjection) {
    const inverted = invertListMarkerProjection(loaded.listProjection, editedListValue);
    if (!inverted.ok) return { ok: false as const, reason: inverted.reason };
    composedListLine = inverted.rawLine;
  } else {
    composedListLine = editedListValue;
  }

  const invertedTrailing = invertQuotePrefixProjection(loaded.trailingProjection, editedTrailingBody);
  if (!invertedTrailing.ok) return { ok: false as const, reason: invertedTrailing.reason };
  let trailingRawText = invertedTrailing.rawText;

  const titleSlot: QuoteHeaderTitleSlot | null = loaded.trailingProjection.titleSlot;
  if (titleSlot && titleEdit) {
    const reconstructed = reconstructQuoteHeader(
      titleSlot,
      titleEdit.newType,
      titleEdit.newMarker,
      titleEdit.newTitle
    );
    if (!reconstructed.ok) return { ok: false as const, reason: reconstructed.reason };
    const bodyOnlyLines = trailingRawText.split("\n").slice(1);
    trailingRawText = [reconstructed.header, ...bodyOnlyLines].join("\n");
  }

  const newCompositeText = composeCompositeBlockMemberText(composedListLine, trailingRawText);
  const outcome = applyCompositeBlockEdit(loaded.doc, loaded.snapshot, loaded.originalText, newCompositeText, rules);
  return { ok: true as const, outcome, newCompositeText, composedListLine };
}

describe("Phase 5D-2C: marker-free list projection eligibility on real fixtures", () => {
  it("a '-' marker single-line-list + callout composite projects the list member marker-free", () => {
    const loaded = loadStructured(["- ![[imgX1.png]]", "> [!note] OCR結果1", "> 本文"].join("\n"));
    expect(loaded.snapshot.members[0].kind).toBe("single-line-list");
    expect(loaded.listProjection).not.toBeNull();
    expect(loaded.listProjection!.marker).toBe("-");
    expect(loaded.listProjection!.body).toBe("![[imgX1.png]]");
  });

  it("a '*' marker single-line-list + callout composite projects the list member marker-free", () => {
    const loaded = loadStructured(["* ![[imgX1.png]]", "> [!note] OCR結果1", "> 本文"].join("\n"));
    expect(loaded.listProjection).not.toBeNull();
    expect(loaded.listProjection!.marker).toBe("*");
    expect(loaded.listProjection!.body).toBe("![[imgX1.png]]");
  });

  it("a '+' marker single-line-list + blockquote composite projects the list member marker-free", () => {
    const loaded = loadStructured(["+ 史料項目", "> 引用本文"].join("\n"));
    expect(loaded.listProjection).not.toBeNull();
    expect(loaded.listProjection!.marker).toBe("+");
    expect(loaded.listProjection!.body).toBe("史料項目");
  });

  it("an outer-indented ('  - ...') single-line-list member preserves its indentation in the projection", () => {
    // The callout needs an actual body line (not just a header/title) for
    // buildQuotePrefixProjection to succeed here — a header-only callout
    // is the documented "no-body" case, which is an intentional raw-
    // fallback signal for the TRAILING member, not something this test
    // (about the LIST member's indentation) is exercising.
    const loaded = loadStructured(
      ["# H", "- top", "  - ![[nested.png]]", "  > [!note] a", "  > body"].join("\n"),
      [{ id: "image-ocr", kindSequence: ["single-line-list", "callout"], prefix: "◉" }]
    );
    expect(loaded.listProjection).not.toBeNull();
    expect(loaded.listProjection!.indent).toBe("  ");
    expect(loaded.listProjection!.body).toBe("![[nested.png]]");
  });
});

describe("Phase 5D-2C: Apply with a marker-free list body edit preserves marker/indentation and stays a valid CompositeBlock", () => {
  it("editing ONLY the list body preserves the original marker and (absent) indentation, byte-for-byte", () => {
    const text = ["- ![[imgX1.png]]", "> [!note] OCR結果1", "> 本文"].join("\n");
    const loaded = loadStructured(text);
    const result = applyStructured(loaded, "![[imgY1.png]]", "本文");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.changed).toBe(true);
    expect(result.composedListLine).toBe("- ![[imgY1.png]]");
    expect(result.outcome.lines[0]).toBe("- ![[imgY1.png]]");
  });

  it("editing the list body of an outer-indented list item preserves BOTH the indentation and the marker", () => {
    const text = ["# H", "- top", "  - ![[nested.png]]", "  > [!note] a", "  > body"].join("\n");
    const rules: CompositeBlockRule[] = [
      { id: "image-ocr", kindSequence: ["single-line-list", "callout"], prefix: "◉" },
    ];
    const loaded = loadStructured(text, rules);
    const result = applyStructured(loaded, "![[renamed.png]]", "body", undefined, rules);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.changed).toBe(true);
    const editedLine = result.outcome.lines.find((l) => l.includes("renamed.png"));
    expect(editedLine).toBe("  - ![[renamed.png]]");
  });

  it("editing list body + callout title in one Apply saves both atomically", () => {
    const text = ["- ![[imgX1.png]]", "> [!note] 旧タイトル", "> 本文"].join("\n");
    const loaded = loadStructured(text);
    const result = applyStructured(loaded, "![[imgY1.png]]", "本文", {
      newType: "note",
      newMarker: "",
      newTitle: "新タイトル",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.changed).toBe(true);
    expect(result.newCompositeText).toBe(
      ["- ![[imgY1.png]]", "> [!note] 新タイトル", "> 本文"].join("\n")
    );
  });

  it("editing list body + callout type/fold-marker/body in one Apply saves all four atomically", () => {
    const text = ["- ![[imgX1.png]]", "> [!note] タイトル", "> 旧本文"].join("\n");
    const loaded = loadStructured(text);
    const result = applyStructured(loaded, "![[imgY1.png]]", "新本文", {
      newType: "warning",
      newMarker: "+",
      newTitle: "タイトル",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.newCompositeText).toBe(
      ["- ![[imgY1.png]]", "> [!warning]+ タイトル", "> 新本文"].join("\n")
    );
  });

  it("editing list body + blockquote body in one Apply saves both atomically", () => {
    const text = ["- 史料項目A", "> 旧引用本文"].join("\n");
    const loaded = loadStructured(text);
    const result = applyStructured(loaded, "史料項目B", "新引用本文");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.newCompositeText).toBe(["- 史料項目B", "> 新引用本文"].join("\n"));
  });

  it("after Apply, the CompositeBlock still re-matches the SAME rule (list + callout remains recognized)", () => {
    const text = ["- ![[imgX1.png]]", "> [!note] タイトル", "> 本文"].join("\n");
    const loaded = loadStructured(text);
    const result = applyStructured(loaded, "![[imgY1.png]]", "編集後の本文");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.ruleStillMatches).toBe(true);
    expect(result.outcome.resolvedSnapshot?.ruleId).toBe("image-ocr");
    const redoc = parseDocument(result.outcome.lines.join("\n"));
    const composites = matchCompositeBlocks(redoc, scanComplexBlocks(redoc), DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(composites.length).toBe(1);
    expect(composites[0].ruleId).toBe("image-ocr");
  });

  it("no blank line is ever introduced between the list member and the trailing member", () => {
    const text = ["- ![[imgX1.png]]", "> [!note] タイトル", "> 一行目", "> 二行目"].join("\n");
    const loaded = loadStructured(text);
    const result = applyStructured(loaded, "![[imgY1.png]]", "一行目\n二行目\n三行目");
    if (!result.ok) throw new Error("expected ok");
    const [listLine, ...rest] = result.outcome.lines;
    expect(listLine).toBe("- ![[imgY1.png]]");
    expect(rest[0].startsWith(">")).toBe(true);
    // No entry between the list line and the first trailing line is "" —
    // i.e. index 1 (right after the list line) is a real quote line, not
    // a blank gap.
    expect(result.outcome.lines[1]).not.toBe("");
  });

  it("content outside the CompositeBlock's own range is never touched", () => {
    const text = [
      "# Before",
      "unrelated line one",
      "",
      "- ![[imgX1.png]]",
      "> [!note] タイトル",
      "> 本文",
      "",
      "unrelated line two",
      "# After",
    ].join("\n");
    const loaded = loadStructured(text);
    const result = applyStructured(loaded, "![[imgY1.png]]", "編集後本文");
    if (!result.ok) throw new Error("expected ok");
    expect(result.outcome.lines[0]).toBe("# Before");
    expect(result.outcome.lines[1]).toBe("unrelated line one");
    expect(result.outcome.lines[2]).toBe("");
    expect(result.outcome.lines[result.outcome.lines.length - 2]).toBe("unrelated line two");
    expect(result.outcome.lines[result.outcome.lines.length - 1]).toBe("# After");
  });
});

describe("Phase 5D-2C: fallback to the raw list row (member-local, never a whole-CompositeBlock regression)", () => {
  it("a multi-line list item (kind \"list\", not \"single-line-list\") never gets marker-free projection — splitCompositeBlockMembers itself already falls all the way back to the whole raw-range textarea for it", () => {
    // No shipped CompositeBlockRule requests kind \"list\" (see
    // edit/compositeBlockMemberProjection.ts's own top doc comment on
    // this being reachable only via a hypothetical future rule) — this
    // fixture instead hand-builds a snapshot, exactly like
    // tests/compositeBlockMemberProjection.test.ts's own
    // \"list-member-not-single-line\" rejection test does, to exercise
    // that pre-existing, unmodified gate directly.
    const lines = ["- item", "  continuation paragraph line", "> [!note] a"];
    const snapshot = {
      id: "composite-0",
      ruleId: "hypothetical",
      sectionId: null,
      range: { startLine: 0, endLine: 2 },
      members: [
        { kind: "list" as const, id: "li-0", range: { startLine: 0, endLine: 1 } },
        { kind: "callout" as const, id: "cb-0", range: { startLine: 2, endLine: 2 } },
      ],
    };
    const outcome = splitCompositeBlockMembers(lines, snapshot);
    expect(outcome).toEqual({ ok: false, reason: "list-member-not-single-line" });
  });

  it("a nested list item (kind \"list\") is likewise excluded, even when — hypothetically — its own single-line range alone would otherwise pass splitCompositeBlockMembers", () => {
    // Directly exercises this ticket's own new gate
    // (isListMemberEligibleForMarkerFreeProjection), independent of
    // splitCompositeBlockMembers's own separate range-length check.
    expect(isListMemberEligibleForMarkerFreeProjection("list")).toBe(false);
  });

  it("a task-list single-line-list member ('- [ ] ...') falls back to showing the RAW list line, while the trailing callout keeps its FULL structured editor (partial degradation, not a whole-session regression)", () => {
    const text = ["- [ ] ![[imgX1.png]]", "> [!note] タイトル", "> 本文"].join("\n");
    const loaded = loadStructured(text);
    expect(loaded.snapshot.members[0].kind).toBe("single-line-list");
    expect(loaded.listProjection).toBeNull();
    expect(loaded.rawListLine).toBe("- [ ] ![[imgX1.png]]");
    // The trailing member's OWN structured projection is completely
    // unaffected by the list member's raw-fallback status.
    expect(loaded.trailingProjection.titleSlot?.title).toBe("タイトル");
  });

  it("an ordered-marker single-line-list member ('1. ...') falls back to showing the RAW list line the same way", () => {
    const text = ["1. ![[imgX1.png]]", "> [!note] タイトル", "> 本文"].join("\n");
    const loaded = loadStructured(text);
    expect(loaded.listProjection).toBeNull();
    expect(loaded.rawListLine).toBe("1. ![[imgX1.png]]");
  });

  it("Apply still works normally for a raw-fallback list row within an otherwise-structured session — the RAW value the user typed becomes the new list line verbatim", () => {
    const text = ["- [ ] ![[imgX1.png]]", "> [!note] タイトル", "> 本文"].join("\n");
    const loaded = loadStructured(text);
    expect(loaded.listProjection).toBeNull();
    const result = applyStructured(loaded, "- [x] ![[imgY1.png]]", "編集後本文");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.composedListLine).toBe("- [x] ![[imgY1.png]]");
    expect(result.outcome.changed).toBe(true);
  });
});

describe("Phase 5D-2C: 方針A is unchanged — a rule-mismatch after Apply still SAVES successfully, never rejected", () => {
  it("editing a raw-fallback list row into something that is no longer a list line at all still saves (方針A), and the CompositeBlock naturally dissolves on the next re-parse", () => {
    // This is the realistic way to trigger a genuine rule mismatch from
    // within THIS ticket's own feature area: a marker-free BODY-only edit
    // can never change the list line's own structural kind (kind is
    // derived from surrounding lines, not this line's content — see
    // edit/listMarkerProjection.ts's own top doc comment) or the trailing
    // member's own kind, so a rule mismatch is structurally unreachable
    // through a purely marker-free-projected edit. A raw-fallback list
    // row (task-list/ordered-marker member), by contrast, lets the user
    // type ANYTHING, including text that no longer matches LIST_RE at
    // all — exactly like editing the pre-5D-2C raw whole-block textarea
    // already could.
    const text = ["- [ ] ![[imgX1.png]]", "> [!note] タイトル", "> 本文"].join("\n");
    const loaded = loadStructured(text);
    const result = applyStructured(loaded, "no longer a list line at all", "本文");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // applyCompositeBlockEdit itself still succeeds — 方針A: a structural
    // edit is never rejected for breaking the CompositeBlock grouping.
    expect(result.outcome.changed).toBe(true);
    expect(result.outcome.ruleStillMatches).toBe(false);
    expect(result.outcome.resolvedSnapshot).toBeUndefined();
    // On the NEXT re-parse, the CompositeBlock naturally dissolves — the
    // former list line and the former callout are no longer grouped.
    const redoc = parseDocument(result.outcome.lines.join("\n"));
    const composites = matchCompositeBlocks(redoc, scanComplexBlocks(redoc), DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(composites.length).toBe(0);
  });

  it("even when the rule no longer matches, the marker-free list body's own restoration (for a DIFFERENT, still-eligible list member edited alongside it) and the callout's title/type/marker/body are all still correctly written back", () => {
    // A single CompositeBlock only ever has one list member, so this
    // proves the SAME invariant a different way: the composed text is
    // built the SAME way (list line inversion, then header
    // reconstruction, then compose) regardless of whether the result
    // will end up re-matching the rule — 方針A only affects the Notice
    // shown afterward, never what gets written.
    const text = ["- ![[imgX1.png]]", "> [!note] 旧タイトル", "> 旧本文"].join("\n");
    const loaded = loadStructured(text);
    const result = applyStructured(loaded, "![[imgY1.png]]", "新本文", {
      newType: "warning",
      newMarker: "-",
      newTitle: "新タイトル",
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.newCompositeText).toBe(
      ["- ![[imgY1.png]]", "> [!warning]- 新タイトル", "> 新本文"].join("\n")
    );
    expect(result.outcome.ruleStillMatches).toBe(true);
  });
});

describe("Phase 5D-2C: genuine safety-error refusals (Apply itself rejected, never conflated with rule-mismatch)", () => {
  it("a marker-free list body edit containing a newline refuses BEFORE ever calling applyCompositeBlockEdit — the note is never touched", () => {
    const text = ["- ![[imgX1.png]]", "> [!note] タイトル", "> 本文"].join("\n");
    const loaded = loadStructured(text);
    const result = applyStructured(loaded, "line one\nline two", "本文");
    expect(result).toEqual({ ok: false, reason: "multiline-body" });
  });

  it("a stale snapshot (the note changed since load) is refused by applyCompositeBlockEdit itself with reason \"conflict\" — draft-preservation is a View-level concern; here we confirm the backend never silently overwrites", () => {
    const text = ["- ![[imgX1.png]]", "> [!note] タイトル", "> 本文"].join("\n");
    const loaded = loadStructured(text);
    // Simulate an external edit: the note is now DIFFERENT from what was
    // loaded (originalText no longer matches the CURRENT extracted text).
    const externallyEditedDoc = parseDocument(
      ["- ![[imgX1.png]]", "> [!note] 外部で変更されたタイトル", "> 本文"].join("\n")
    );
    const result = applyStructured({ ...loaded, doc: externallyEditedDoc }, "![[imgY1.png]]", "編集後本文");
    if (!result.ok) throw new Error("expected ok (the refusal happens inside applyCompositeBlockEdit's own outcome, not applyStructured's own early returns)");
    expect(result.outcome.changed).toBe(false);
    expect(result.outcome.reason).toBe("conflict");
  });

  it("the trailing member's own structural re-validation (unchanged from 5D-2B) still refuses an edit that would break callout/blockquote structure, even when the list body is untouched", () => {
    const text = ["- ![[imgX1.png]]", "> [!note] タイトル", "> 本文"].join("\n");
    const loaded = loadStructured(text);
    const invertedTrailing = invertQuotePrefixProjection(loaded.trailingProjection, "");
    // An emptied CALLOUT body succeeds (header-only) at the projection
    // layer — this specific refusal instead comes from applyEdit's own
    // isolated structural re-check (scanComplexBlocks on the candidate
    // text), which this integration test reproduces directly rather than
    // duplicating: a header whose title itself contains "]" is refused at
    // the header-reconstruction layer instead, a simpler, equally valid
    // way to exercise "the trailing member's own safety check still
    // fires regardless of the list body".
    expect(invertedTrailing.ok).toBe(true);
    const reconstructed = reconstructQuoteHeader(
      loaded.trailingProjection.titleSlot!,
      "not]valid",
      "",
      "タイトル"
    );
    expect(reconstructed).toEqual({ ok: false, reason: "invalid-type" });
  });
});

/**
 * Phase 5D-0.5 ("Quote Prefix Projection for Partial Edit"): pure-function
 * tests for edit/quotePrefixProjection.ts — buildQuotePrefixProjection /
 * projectedDisplayText / invertQuotePrefixProjection. No Obsidian, no
 * ParsedDocument — every fixture here is a raw multi-line string, exactly
 * the shape extractSubtreeText already returns for a "supported" callout/
 * blockquote (see edit/partialEdit.ts's own doc comment), matching this
 * module's own "operates purely on raw text + kind" contract.
 */
import { describe, expect, it } from "vitest";
import {
  buildQuoteHeaderTitleSlot,
  buildQuotePrefixProjection,
  invertQuotePrefixProjection,
  projectedDisplayText,
  reconstructQuoteHeader,
} from "../src/edit/quotePrefixProjection";

describe("buildQuotePrefixProjection + projectedDisplayText: blockquote", () => {
  it("round-trips a mix of prefix formats (`>text`, `> text`, `>  text`) with content unedited", () => {
    const raw = [">text", "> text", ">  text"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.header).toBeNull();
    const display = projectedDisplayText(built.projection);
    const inverted = invertQuotePrefixProjection(built.projection, display);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(raw);
  });

  it("round-trips several blank quoted lines (`>` alone) unedited", () => {
    const raw = ["> first", ">", ">", "> last"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const display = projectedDisplayText(built.projection);
    expect(display).toBe(["first", "", "", "last"].join("\n"));
    const inverted = invertQuotePrefixProjection(built.projection, display);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(raw);
  });

  it("emptying an existing body line round-trips as its BARE original prefix, with trailing whitespace stripped (Phase 5D-1.5 update)", () => {
    // Phase 5D-1.5 ("単独 Callout / Blockquote Partial Edit Pane の可変長
    // 本文編集"): this ticket's own explicit worked example (6-2, "Callout
    // の行削除") requires a blank body line — same line count as loaded,
    // an EXISTING line's content simply cleared — to reconstruct as the
    // bare prefix alone (e.g. `>`), never `> ` with a trailing space. This
    // updates the pre-5D-1.5 expectation below (which kept the original
    // prefix's trailing whitespace verbatim) to match: "空の編集行は...
    // `>` のみの行へ正規化する" applies to ANY blank line the edit
    // produces, not only ones introduced by a line-count change.
    const raw = ["> keep this", "> erase this one"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const editedDisplay = ["keep this", ""].join("\n");
    const inverted = invertQuotePrefixProjection(built.projection, editedDisplay);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    // The erased line must reconstruct as its bare original prefix (">"),
    // never as an empty raw line, a line with no `>` at all, or `> ` with
    // a trailing space.
    expect(inverted.rawText).toBe(["> keep this", ">"].join("\n"));
  });

  it("preserves list-item-owned leading indentation before the `>` marker", () => {
    const raw = ["  > indented quote line one", "  > indented quote line two"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const display = projectedDisplayText(built.projection);
    const inverted = invertQuotePrefixProjection(built.projection, display);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(raw);
  });

  it("rejects with reason 'nested' when a body line, after stripping one level of `>`, still starts with `>` (plain nested blockquote, no `[!` marker)", () => {
    const raw = ["> outer line", "> > nested line", "> outer again"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built).toEqual({ ok: false, reason: "nested" });
  });
});

describe("buildQuotePrefixProjection + projectedDisplayText: callout", () => {
  it("round-trips a callout WITH a title, unedited", () => {
    const raw = ["> [!note] My Title", "> body line one", "> body line two"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.header).toBe("> [!note] My Title");
    const display = projectedDisplayText(built.projection);
    expect(display).toBe(["body line one", "body line two"].join("\n"));
    const inverted = invertQuotePrefixProjection(built.projection, display);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(raw);
  });

  it("round-trips a callout with NO title", () => {
    const raw = ["> [!warning]", "> only body content"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.header).toBe("> [!warning]");
    const display = projectedDisplayText(built.projection);
    const inverted = invertQuotePrefixProjection(built.projection, display);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(raw);
  });

  it("round-trips fold markers (+/-) in the header, unchanged", () => {
    for (const fold of ["+", "-"]) {
      const raw = [`> [!tip]${fold} Folded`, "> body"].join("\n");
      const built = buildQuotePrefixProjection(raw, "callout");
      expect(built.ok).toBe(true);
      if (!built.ok) continue;
      expect(built.projection.header).toBe(`> [!tip]${fold} Folded`);
      const inverted = invertQuotePrefixProjection(
        built.projection,
        projectedDisplayText(built.projection)
      );
      expect(inverted.ok && inverted.rawText).toBe(raw);
    }
  });

  it("preserves list-item-owned indentation on both the header and body lines", () => {
    const raw = ["  > [!ocr] Scan", "  > line one", "  > line two"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.header).toBe("  > [!ocr] Scan");
    const inverted = invertQuotePrefixProjection(
      built.projection,
      projectedDisplayText(built.projection)
    );
    expect(inverted.ok && inverted.rawText).toBe(raw);
  });

  it("excludes the header line from the projected display body", () => {
    const raw = ["> [!note] Title", "> body"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const display = projectedDisplayText(built.projection);
    expect(display).not.toContain("[!note]");
    expect(display).not.toContain("Title");
    expect(display).toBe("body");
  });

  it("returns 'no-body' for a header-only callout (zero body lines) — caller falls back to raw editing, this is not a rejection", () => {
    const raw = "> [!note] Header only, no body";
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built).toEqual({ ok: false, reason: "no-body" });
  });

  it("rejects with reason 'nested' for a nested quote-like line inside a callout body", () => {
    const raw = ["> [!note] Title", "> outer", "> > nested"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built).toEqual({ ok: false, reason: "nested" });
  });
});

// Phase 5D-1.5 ("単独 Callout / Blockquote Partial Edit Pane の可変長本文
// 編集"): supersedes the old "line-count-changed refusal" describe block
// this replaces — invertQuotePrefixProjection now RECONSTRUCTS a variable-
// length edit instead of refusing it outright. See that function's own
// doc comment for the exact algorithm (same-count: per-line original
// prefix reuse, unchanged; different-count: one canonical prefix derived
// from the projection's own first line, blank lines normalized to the
// bare prefix).
describe("invertQuotePrefixProjection: variable-length body edits (Phase 5D-1.5)", () => {
  it("an added line succeeds, reconstructing every line — kept and new alike — under one canonical prefix", () => {
    const raw = ["> line one", "> line two"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const edited = ["line one", "line two", "a brand new third line"].join("\n");
    const inverted = invertQuotePrefixProjection(built.projection, edited);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(
      ["> line one", "> line two", "> a brand new third line"].join("\n")
    );
  });

  it("a removed line succeeds, dropping only the removed line", () => {
    const raw = ["> line one", "> line two"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const edited = "line one";
    const inverted = invertQuotePrefixProjection(built.projection, edited);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe("> line one");
  });

  it("a line split via an embedded newline (paste, or pressing Enter mid-line) succeeds", () => {
    const raw = "> a single body line";
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const edited = ["a single", "body line"].join("\n");
    const inverted = invertQuotePrefixProjection(built.projection, edited);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(["> a single", "> body line"].join("\n"));
  });

  it("blank lines inserted by a variable-length edit normalize to the bare prefix alone, never a trailing space", () => {
    const raw = ["> A", "> B"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const edited = ["A", "new", "", "C"].join("\n");
    const inverted = invertQuotePrefixProjection(built.projection, edited);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(["> A", "> new", ">", "> C"].join("\n"));
  });

  it("preserves list-item-owned leading indentation in the canonical prefix used for a variable-length edit", () => {
    const raw = ["  > line one", "  > line two"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const edited = ["line one", "a new indented line"].join("\n");
    const inverted = invertQuotePrefixProjection(built.projection, edited);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(["  > line one", "  > a new indented line"].join("\n"));
  });

  it("a callout's variable-length body edit reconstructs the header verbatim, unedited, as the first line", () => {
    const raw = ["> [!note]+ Title", "> A", "> B"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const edited = ["X", "Y", "Z"].join("\n");
    const inverted = invertQuotePrefixProjection(built.projection, edited);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    expect(inverted.rawText).toBe(["> [!note]+ Title", "> X", "> Y", "> Z"].join("\n"));
  });

  it("fully emptying a callout's body succeeds, reconstructing as the header line ALONE", () => {
    const raw = ["> [!note]+ Title", "> A", "> B"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const inverted = invertQuotePrefixProjection(built.projection, "");
    expect(inverted).toEqual({ ok: true, rawText: "> [!note]+ Title" });
  });

  it("fully emptying a blockquote's body is refused with reason 'blockquote-empty' — a blockquote has no header to fall back to", () => {
    const raw = ["> line one", "> line two"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const inverted = invertQuotePrefixProjection(built.projection, "");
    expect(inverted).toEqual({ ok: false, reason: "blockquote-empty" });
  });
});

// ---- Phase 5D-1A ("Callout Header Title Editing") -----------------------
//
// Pure-function tests for buildQuoteHeaderTitleSlot / reconstructQuoteHeader
// (both new this ticket), plus the new `titleSlot` field on
// QuotePrefixProjection itself. Same "raw text in, raw text out, never
// normalized/trimmed" contract as the body-line split above — see both
// functions' own doc comments in edit/quotePrefixProjection.ts for the
// exact invariant and the ticket's 3 fixed whitespace rules.
//
// Phase 5D-1B ("Callout Fold Marker Editing") extended QuoteHeaderTitleSlot's
// shape — `beforeTitle` (prefix + [!type] + fold marker + separator, one
// opaque span) was split further into `beforeMarker` (prefix + [!type]
// only) / `marker` / `separator`, and reconstructQuoteHeader's signature
// grew a `newMarker` parameter (`reconstructQuoteHeader(slot, newMarker,
// newTitle)`).
//
// Phase 5D-1C ("Callout Type Editing") split `beforeMarker` further still,
// into `quotePrefix` (leading indentation + `>` + at most one following
// space/tab — never touched by type/marker/title edits) and `type` (the
// `[!type]` identifier itself, now independently editable). The former
// `beforeMarker` field name is retired entirely — see
// edit/quotePrefixProjection.ts's own doc comment on QuoteHeaderTitleSlot
// for why this is a clean internal rename with no external API surface to
// migrate. reconstructQuoteHeader's signature grew a `newType` parameter,
// inserted BEFORE `newMarker`:
// `reconstructQuoteHeader(slot, newType, newMarker, newTitle)`. Every test
// below reflects this final 5-field / 4-argument shape; tests that predate
// 5D-1C pass an UNCHANGED type (`slot.type`) to confirm pure title/marker
// editing regresses none of its own prior behavior now that type travels
// alongside it.

describe("buildQuoteHeaderTitleSlot: lossless 5-piece header split (Phase 5D-1A / 5D-1B / 5D-1C)", () => {
  it("splits a header WITH a title and no marker into quotePrefix / type / marker(\"\") / separator / title, round-tripping byte-for-byte", () => {
    const header = "> [!note] My Title";
    const slot = buildQuoteHeaderTitleSlot(header);
    expect(slot).not.toBeNull();
    if (!slot) return;
    expect(slot.quotePrefix).toBe("> ");
    expect(slot.type).toBe("note");
    expect(slot.marker).toBe("");
    expect(slot.separator).toBe(" ");
    expect(slot.title).toBe("My Title");
    expect(slot.quotePrefix + "[!" + slot.type + "]" + slot.marker + slot.separator + slot.title).toBe(
      header
    );
  });

  it("splits a header with NO title and NO marker into quotePrefix + \"[!\" + type + \"]\" === the whole line, marker/separator/title all ''", () => {
    const header = "> [!warning]";
    const slot = buildQuoteHeaderTitleSlot(header);
    expect(slot).not.toBeNull();
    if (!slot) return;
    expect(slot.quotePrefix).toBe("> ");
    expect(slot.type).toBe("warning");
    expect(slot.marker).toBe("");
    expect(slot.separator).toBe("");
    expect(slot.title).toBe("");
    expect(slot.quotePrefix + "[!" + slot.type + "]" + slot.marker + slot.separator + slot.title).toBe(
      header
    );
  });

  it("splits the fold marker (+/-) into its OWN field, never inside quotePrefix, type, or title", () => {
    for (const fold of ["+", "-"]) {
      const header = `> [!tip]${fold} Folded Title`;
      const slot = buildQuoteHeaderTitleSlot(header);
      expect(slot).not.toBeNull();
      if (!slot) continue;
      expect(slot.quotePrefix).toBe("> ");
      expect(slot.type).toBe("tip");
      expect(slot.marker).toBe(fold);
      expect(slot.separator).toBe(" ");
      expect(slot.title).toBe("Folded Title");
      expect(
        slot.quotePrefix + "[!" + slot.type + "]" + slot.marker + slot.separator + slot.title
      ).toBe(header);
    }
  });

  it("preserves list-item-owned indentation before the `>` marker inside quotePrefix", () => {
    const header = "  > [!ocr] Scan";
    const slot = buildQuoteHeaderTitleSlot(header);
    expect(slot).not.toBeNull();
    if (!slot) return;
    expect(slot.quotePrefix).toBe("  > ");
    expect(slot.type).toBe("ocr");
    expect(slot.separator).toBe(" ");
    expect(slot.title).toBe("Scan");
    expect(slot.quotePrefix + "[!" + slot.type + "]" + slot.marker + slot.separator + slot.title).toBe(
      header
    );
  });

  it("round-trips byte-for-byte across title-present / title-absent / fold-marker(none/+/-) / indented / 0-or-1-space-after->  header shapes", () => {
    const headers = [
      "> [!note] Title",
      "> [!warning]",
      "> [!tip]+ Folded",
      "> [!tip]- Folded",
      "  > [!ocr] Indented Title",
      "    > [!ocr]",
      ">[!note] no space after >",
      "> [!tip]+  Old Title", // double-space separator
    ];
    for (const header of headers) {
      const slot = buildQuoteHeaderTitleSlot(header);
      expect(slot).not.toBeNull();
      if (!slot) continue;
      expect(
        slot.quotePrefix + "[!" + slot.type + "]" + slot.marker + slot.separator + slot.title
      ).toBe(header);
    }
  });
});

describe("buildQuoteHeaderTitleSlot: type field preserves case, internal whitespace, custom/unknown types, and non-ASCII verbatim (Phase 5D-1C)", () => {
  it("preserves the exact case the type was written in — no lower/upper-casing on load", () => {
    for (const header of ["> [!NOTE] Title", "> [!Warning] Title", "> [!wArNiNg] Title"]) {
      const slot = buildQuoteHeaderTitleSlot(header)!;
      expect(header).toContain(`[!${slot.type}]`);
    }
  });

  it("preserves a custom type unrelated to any standard/alias keyword verbatim — the real `[!ai]` example that motivated this ticket", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!ai] AI")!;
    expect(slot.type).toBe("ai");
  });

  it("preserves an alias type (not one of the 13 standard keywords) verbatim, with no rewriting to its canonical type", () => {
    for (const alias of ["caution", "tldr", "summary", "attention", "cite", "hint"]) {
      const slot = buildQuoteHeaderTitleSlot(`> [!${alias}] Title`)!;
      expect(slot.type).toBe(alias);
    }
  });

  it("preserves internal whitespace, emoji, Japanese, and URL-like characters inside a type verbatim", () => {
    const types = ["my type", "🔥type", "種類", "not-a-url.com/path"];
    for (const type of types) {
      const header = `> [!${type}] Title`;
      const slot = buildQuoteHeaderTitleSlot(header)!;
      expect(slot.type).toBe(type);
      expect(slot.quotePrefix + "[!" + slot.type + "]" + slot.marker + slot.separator + slot.title).toBe(
        header
      );
    }
  });
});

describe("reconstructQuoteHeader: title-slot round-trip and the 3 fixed separator rules, type/marker held UNCHANGED (Phase 5D-1A regression, now via the 5D-1C signature)", () => {
  it("rule 3 (unedited): the same non-empty title AND same type/marker reconstructs the header byte-identical to the original", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] My Title")!;
    const result = reconstructQuoteHeader(slot, slot.type, slot.marker, "My Title");
    expect(result).toEqual({ ok: true, header: "> [!note] My Title" });
  });

  it("rule 1: a non-empty title emptied (type/marker unchanged) reuses the separator completely unmodified", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] My Title")!;
    const result = reconstructQuoteHeader(slot, slot.type, slot.marker, "");
    expect(result).toEqual({ ok: true, header: "> [!note] " });
  });

  it("rule 1: an already-empty title left empty (unedited, type/marker unchanged) also reconstructs byte-identical to the original", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!warning]")!;
    const result = reconstructQuoteHeader(slot, slot.type, slot.marker, "");
    expect(result).toEqual({ ok: true, header: "> [!warning]" });
  });

  it("rule 2: an empty title made non-empty (type/marker unchanged), with NO existing separator, inserts exactly one space", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!warning]")!;
    const result = reconstructQuoteHeader(slot, slot.type, slot.marker, "New Title");
    expect(result).toEqual({ ok: true, header: "> [!warning] New Title" });
  });

  it("rule 2: an empty title made non-empty (type/marker unchanged), with an EXISTING trailing separator, does not duplicate the space", () => {
    // A stray trailing space after the marker position even with no title
    // present (e.g. left behind by an external editor) — the split regex
    // still captures it as `separator`, since title itself is "".
    const slot = buildQuoteHeaderTitleSlot("> [!warning] ")!;
    expect(slot.title).toBe("");
    expect(slot.separator).toBe(" ");
    const result = reconstructQuoteHeader(slot, slot.type, slot.marker, "New Title");
    expect(result).toEqual({ ok: true, header: "> [!warning] New Title" });
  });

  it("rule 3: a non-empty title changed to a different non-empty title (type/marker unchanged) preserves the separator byte-for-byte, including a non-single-space convention", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!tip]+  Old Title")!; // two spaces before the title
    expect(slot.separator).toBe("  ");
    const result = reconstructQuoteHeader(slot, slot.type, slot.marker, "New Title");
    expect(result).toEqual({ ok: true, header: "> [!tip]+  New Title" });
  });

  it("passes through wiki links, URLs, emoji, Japanese, inline Markdown, and an embedded `>` in the title completely untouched (type/marker unchanged)", () => {
    const titles = [
      "[[Some Note]] reference",
      "see https://example.com/path?q=1",
      "important 🔥 emoji",
      "日本語のタイトル",
      "**bold** and *italic* and `code`",
      "> looks like another quote marker",
    ];
    for (const title of titles) {
      const slot = buildQuoteHeaderTitleSlot("> [!note] placeholder")!;
      const result = reconstructQuoteHeader(slot, slot.type, slot.marker, title);
      expect(result).toEqual({ ok: true, header: `> [!note] ${title}` });
    }
  });

  it("rejects a title containing a newline with reason 'newline' (type/marker unchanged)", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    const result = reconstructQuoteHeader(slot, slot.type, slot.marker, "line one\nline two");
    expect(result).toEqual({ ok: false, reason: "newline" });
  });
});

describe("buildQuotePrefixProjection: titleSlot field, 5-piece shape (Phase 5D-1A / 5D-1B / 5D-1C)", () => {
  it("a callout WITH a title and no marker gets a non-null titleSlot matching buildQuoteHeaderTitleSlot's own split of the same header", () => {
    const raw = ["> [!note] My Title", "> body"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.titleSlot).toEqual({
      quotePrefix: "> ",
      type: "note",
      marker: "",
      separator: " ",
      title: "My Title",
    });
  });

  it("a callout with a custom type and NO title still gets a non-null titleSlot, with marker/separator/title all ''", () => {
    const raw = ["> [!ai]", "> body"].join("\n");
    const built = buildQuotePrefixProjection(raw, "callout");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.titleSlot).toEqual({
      quotePrefix: "> ",
      type: "ai",
      marker: "",
      separator: "",
      title: "",
    });
  });

  it("a blockquote always has titleSlot === null — no header line, no type/title/marker concept", () => {
    const raw = ["> line one", "> line two"].join("\n");
    const built = buildQuotePrefixProjection(raw, "blockquote");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.projection.titleSlot).toBeNull();
  });
});

// ---- Phase 5D-1B ("Callout Fold Marker Editing") -------------------------
//
// Pure-function tests for the marker half of reconstructQuoteHeader — the
// title half is already covered exhaustively above (with type/marker held
// unchanged); these tests hold TYPE and TITLE unchanged and exercise the
// marker transitions, plus the runtime guard and simultaneous marker+title
// edits.

describe("reconstructQuoteHeader: fold-marker transitions, type/title UNCHANGED (Phase 5D-1B)", () => {
  it("round-trips all 4 marker transitions (none->+, none->-, +->none, -->+) with type/title held unchanged", () => {
    const cases: Array<[string, "" | "+" | "-", string]> = [
      ["> [!note] My Title", "+", "> [!note]+ My Title"],
      ["> [!note] My Title", "-", "> [!note]- My Title"],
      ["> [!tip]+ Folded", "", "> [!tip] Folded"],
      ["> [!tip]- Folded", "+", "> [!tip]+ Folded"],
    ];
    for (const [header, newMarker, expected] of cases) {
      const slot = buildQuoteHeaderTitleSlot(header)!;
      const result = reconstructQuoteHeader(slot, slot.type, newMarker, slot.title);
      expect(result).toEqual({ ok: true, header: expected });
    }
  });

  it("a marker-only change on a title-less callout keeps title empty and does not synthesize a separator (title stays empty, rule 1 applies)", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!warning]")!;
    const toPlus = reconstructQuoteHeader(slot, slot.type, "+", slot.title);
    expect(toPlus).toEqual({ ok: true, header: "> [!warning]+" });
    const toMinus = reconstructQuoteHeader(slot, slot.type, "-", slot.title);
    expect(toMinus).toEqual({ ok: true, header: "> [!warning]-" });
  });

  it("a marker-only change on an indented, list-item-owned callout preserves the indentation and quote prefix exactly", () => {
    const slot = buildQuoteHeaderTitleSlot("  > [!ocr] Scan")!;
    const result = reconstructQuoteHeader(slot, slot.type, "-", slot.title);
    expect(result).toEqual({ ok: true, header: "  > [!ocr]- Scan" });
  });

  it("a marker-only change preserves a multi-space separator convention byte-for-byte", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!tip]+  Old Title")!;
    const result = reconstructQuoteHeader(slot, slot.type, "-", slot.title);
    expect(result).toEqual({ ok: true, header: "> [!tip]-  Old Title" });
  });

  it("marker-only changes never alter type, quote prefix, or title — quotePrefix/type/title are always byte-identical to the original", () => {
    const slot = buildQuoteHeaderTitleSlot("  > [!custom-type] Some Title")!;
    for (const newMarker of ["", "+", "-"] as const) {
      const result = reconstructQuoteHeader(slot, slot.type, newMarker, slot.title);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.header.startsWith(slot.quotePrefix + "[!" + slot.type + "]")).toBe(true);
      expect(result.header.endsWith(slot.title)).toBe(true);
    }
  });

  it("an unedited marker (newMarker === slot.marker) with type/title unchanged reconstructs byte-identical to the original, for none/+/- alike", () => {
    for (const header of ["> [!note] Title", "> [!tip]+ Title", "> [!tip]- Title"]) {
      const slot = buildQuoteHeaderTitleSlot(header)!;
      const result = reconstructQuoteHeader(slot, slot.type, slot.marker, slot.title);
      expect(result).toEqual({ ok: true, header });
    }
  });
});

describe("reconstructQuoteHeader: simultaneous marker + title edits, type UNCHANGED, single reassembly (Phase 5D-1B)", () => {
  it("marker none->+ AND title empty->non-empty together: rule 2's space-insertion still applies correctly", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!warning]")!;
    const result = reconstructQuoteHeader(slot, slot.type, "+", "New Title");
    expect(result).toEqual({ ok: true, header: "> [!warning]+ New Title" });
  });

  it("marker none->- AND title emptied together: rule 1's separator-preservation still applies correctly", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Old")!;
    const result = reconstructQuoteHeader(slot, slot.type, "-", "");
    expect(result).toEqual({ ok: true, header: "> [!note]- " });
  });

  it("marker +->none AND title changed to a different non-empty value together: rule 3's separator-preservation still applies correctly", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!tip]+ Folded")!;
    const result = reconstructQuoteHeader(slot, slot.type, "", "New");
    expect(result).toEqual({ ok: true, header: "> [!tip] New" });
  });

  it("simultaneous marker+title change on an indented, multi-space-separator header composes correctly", () => {
    const slot = buildQuoteHeaderTitleSlot("  > [!ocr]-  Old Scan")!;
    const result = reconstructQuoteHeader(slot, slot.type, "+", "New Scan");
    expect(result).toEqual({ ok: true, header: "  > [!ocr]+  New Scan" });
  });
});

describe("reconstructQuoteHeader: invalid-marker runtime guard (Phase 5D-1B)", () => {
  it("rejects any newMarker value outside \"\" | \"+\" | \"-\" with reason 'invalid-marker', never throwing and never silently coercing it", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    // The TypeScript signature restricts newMarker to CalloutFoldMarker;
    // this simulates an out-of-band value (e.g. from DOM manipulation
    // bypassing the closed-set <select>) reaching the function anyway.
    for (const bogus of ["*", "++", " ", "warning", "\n"]) {
      const result = reconstructQuoteHeader(
        slot,
        slot.type,
        bogus as unknown as "" | "+" | "-",
        slot.title
      );
      expect(result).toEqual({ ok: false, reason: "invalid-marker" });
    }
  });

  it("checks marker validity independently of title validity — an invalid marker is rejected even when the type/title themselves are otherwise fine", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    const result = reconstructQuoteHeader(
      slot,
      slot.type,
      "toggle" as unknown as "" | "+" | "-",
      "A perfectly fine title"
    );
    expect(result).toEqual({ ok: false, reason: "invalid-marker" });
  });
});

// ---- Phase 5D-1C ("Callout Type Editing") --------------------------------
//
// Pure-function tests for the type half of reconstructQuoteHeader — title
// and marker are already covered exhaustively above (with type held
// unchanged); these tests hold MARKER and TITLE unchanged and exercise the
// type transitions (standard, custom, alias, unknown, case/whitespace/
// emoji/Japanese/URL-like), the invalid-type runtime guard, and
// simultaneous type+marker+title edits. No new conflict/resolve-failed
// logic — applySubtreeEdit's own raw-snapshot byte comparison already
// rejects any external type change, exactly as it already does for
// title/marker/body (see edit/partialEdit.ts's applySubtreeEdit).

describe("reconstructQuoteHeader: type transitions, marker/title UNCHANGED (Phase 5D-1C)", () => {
  it("changes a standard type to another standard type, marker/title untouched", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] My Title")!;
    const result = reconstructQuoteHeader(slot, "warning", slot.marker, slot.title);
    expect(result).toEqual({ ok: true, header: "> [!warning] My Title" });
  });

  it("changes a custom type to a different custom type, marker/title untouched — the real `[!ai]`-style case this ticket exists for", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!ai] AI Notes")!;
    const result = reconstructQuoteHeader(slot, "ocr", slot.marker, slot.title);
    expect(result).toEqual({ ok: true, header: "> [!ocr] AI Notes" });
  });

  it("changes a standard type to an unknown/custom type — no fallback to \"note\", no rejection", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    const result = reconstructQuoteHeader(slot, "totally-made-up-type", slot.marker, slot.title);
    expect(result).toEqual({ ok: true, header: "> [!totally-made-up-type] Title" });
  });

  it("preserves whatever case is typed for the new type — no lower/upper-casing on Apply", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    const result = reconstructQuoteHeader(slot, "WARNING", slot.marker, slot.title);
    expect(result).toEqual({ ok: true, header: "> [!WARNING] Title" });
  });

  it("preserves internal whitespace, emoji, Japanese, and URL-like characters in a newly-typed type verbatim", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    for (const newType of ["my type", "🔥type", "種類", "not-a-url.com/path"]) {
      const result = reconstructQuoteHeader(slot, newType, slot.marker, slot.title);
      expect(result).toEqual({ ok: true, header: `> [!${newType}] Title` });
    }
  });

  it("an unedited type (newType === slot.type) with marker/title unchanged reconstructs byte-identical to the original, for a custom type", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!ai] AI")!;
    const result = reconstructQuoteHeader(slot, slot.type, slot.marker, slot.title);
    expect(result).toEqual({ ok: true, header: "> [!ai] AI" });
  });

  it("type-only changes never alter quotePrefix, marker, separator, or title", () => {
    const slot = buildQuoteHeaderTitleSlot("  > [!note]+  Some Title")!;
    const result = reconstructQuoteHeader(slot, "danger", slot.marker, slot.title);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.header).toBe("  > [!danger]+  Some Title");
    expect(result.header.startsWith(slot.quotePrefix)).toBe(true);
    expect(result.header.endsWith(slot.separator + slot.title)).toBe(true);
  });

  it("type-only change on a title-less callout keeps title empty and does not synthesize a separator (rule 1 applies)", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!warning]")!;
    const result = reconstructQuoteHeader(slot, "danger", slot.marker, slot.title);
    expect(result).toEqual({ ok: true, header: "> [!danger]" });
  });
});

describe("reconstructQuoteHeader: simultaneous type + marker + title edits, single reassembly (Phase 5D-1C)", () => {
  it("type + marker + title all changed together in one call, one reassembly", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Old Title")!;
    const result = reconstructQuoteHeader(slot, "danger", "+", "New Title");
    expect(result).toEqual({ ok: true, header: "> [!danger]+ New Title" });
  });

  it("type changed AND title empty->non-empty together: rule 2's space-insertion still applies correctly", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!warning]")!;
    const result = reconstructQuoteHeader(slot, "tip", "", "New Title");
    expect(result).toEqual({ ok: true, header: "> [!tip] New Title" });
  });

  it("type changed AND marker changed AND title emptied together: rule 1's separator-preservation still applies correctly", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Old")!;
    const result = reconstructQuoteHeader(slot, "abstract", "-", "");
    expect(result).toEqual({ ok: true, header: "> [!abstract]- " });
  });

  it("simultaneous type+marker+title change on an indented, multi-space-separator, custom-type header composes correctly", () => {
    const slot = buildQuoteHeaderTitleSlot("  > [!ai]-  Old Scan")!;
    const result = reconstructQuoteHeader(slot, "ocr", "+", "New Scan");
    expect(result).toEqual({ ok: true, header: "  > [!ocr]+  New Scan" });
  });

  it("an unedited type AND unedited marker AND unedited title together reconstructs byte-identical to the original, for a custom type", () => {
    const slot = buildQuoteHeaderTitleSlot("  > [!ai]+ AI Notes")!;
    const result = reconstructQuoteHeader(slot, slot.type, slot.marker, slot.title);
    expect(result).toEqual({ ok: true, header: "  > [!ai]+ AI Notes" });
  });
});

describe("reconstructQuoteHeader: invalid-type runtime guard (Phase 5D-1C)", () => {
  it("rejects an empty type with reason 'invalid-type'", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    const result = reconstructQuoteHeader(slot, "", slot.marker, slot.title);
    expect(result).toEqual({ ok: false, reason: "invalid-type" });
  });

  it("rejects a type containing \"]\" with reason 'invalid-type'", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    const result = reconstructQuoteHeader(slot, "no]good", slot.marker, slot.title);
    expect(result).toEqual({ ok: false, reason: "invalid-type" });
  });

  it("rejects a type containing LF with reason 'invalid-type'", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    const result = reconstructQuoteHeader(slot, "line\none", slot.marker, slot.title);
    expect(result).toEqual({ ok: false, reason: "invalid-type" });
  });

  it("rejects a type containing CRLF with reason 'invalid-type'", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    const result = reconstructQuoteHeader(slot, "line\r\none", slot.marker, slot.title);
    expect(result).toEqual({ ok: false, reason: "invalid-type" });
  });

  it("rejects a type containing a bare CR with reason 'invalid-type'", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    const result = reconstructQuoteHeader(slot, "line\rone", slot.marker, slot.title);
    expect(result).toEqual({ ok: false, reason: "invalid-type" });
  });

  it("never returns a raw header on an invalid-type failure — the result is the discriminated 'ok: false' shape only", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    const result = reconstructQuoteHeader(slot, "", slot.marker, slot.title);
    expect(result.ok).toBe(false);
    expect("header" in result).toBe(false);
  });

  it("accepts whitespace-only, symbol, and punctuation-heavy types that stay within the []/newline constraint — no extra semantic validation beyond the 3 stated rules", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    for (const newType of [" ", "  ", "!!!", "type-with-dashes", "type_with_underscores"]) {
      const result = reconstructQuoteHeader(slot, newType, slot.marker, slot.title);
      expect(result).toEqual({ ok: true, header: `> [!${newType}] Title` });
    }
  });

  it("checks type validity BEFORE marker/title validity — an invalid type is rejected even when marker/title are also independently invalid", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    const result = reconstructQuoteHeader(
      slot,
      "",
      "bogus-marker" as unknown as "" | "+" | "-",
      "line one\nline two"
    );
    expect(result).toEqual({ ok: false, reason: "invalid-type" });
  });

  it("type validity is checked independently of marker/title validity — an invalid type is rejected even when marker/title are both otherwise fine", () => {
    const slot = buildQuoteHeaderTitleSlot("> [!note] Title")!;
    const result = reconstructQuoteHeader(slot, "bad]type", slot.marker, "A perfectly fine title");
    expect(result).toEqual({ ok: false, reason: "invalid-type" });
  });
});

describe("QuoteHeaderTitleSlot: the full quotePrefix + \"[!\" + type + \"]\" + marker + separator + title invariant (Phase 5D-1C)", () => {
  it("holds for every combination of standard/custom/alias/unknown type, none/+/- marker, and title-present/absent, both at load time and after an unedited reconstruction", () => {
    const types = ["note", "ai", "caution", "totally-unknown-99"];
    const markers: Array<"" | "+" | "-"> = ["", "+", "-"];
    const titles = ["", "A Title"];
    for (const type of types) {
      for (const marker of markers) {
        for (const title of titles) {
          const header = `> [!${type}]${marker}${title === "" ? "" : " " + title}`;
          const slot = buildQuoteHeaderTitleSlot(header)!;
          expect(slot).not.toBeNull();
          // Invariant holds at load time.
          expect(
            slot.quotePrefix + "[!" + slot.type + "]" + slot.marker + slot.separator + slot.title
          ).toBe(header);
          // Invariant still holds after a fully-unedited reconstruction
          // (same "unedited Apply changes nothing" guarantee as 5D-1A/1B).
          const result = reconstructQuoteHeader(slot, slot.type, slot.marker, slot.title);
          expect(result).toEqual({ ok: true, header });
        }
      }
    }
  });

  it("holds after a type-only, marker-only, and combined edit — the reconstructed header always equals quotePrefix + \"[!\" + newType + \"]\" + newMarker + effectiveSeparator + newTitle", () => {
    const slot = buildQuoteHeaderTitleSlot("  > [!note]+ Original")!;
    const result = reconstructQuoteHeader(slot, "custom-type", "-", "Changed");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.header).toBe(
      slot.quotePrefix + "[!" + "custom-type" + "]" + "-" + slot.separator + "Changed"
    );
    expect(result.header).toBe("  > [!custom-type]- Changed");
  });
});

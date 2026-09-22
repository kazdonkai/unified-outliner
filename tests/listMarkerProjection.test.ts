/**
 * Phase 5D-2C ("CompositeBlock single-line-list member marker-free
 * projection"): unit tests for edit/listMarkerProjection.ts's pure
 * build/invert pair, in isolation from CompositeBlock/PartialEditView —
 * see that module's own top doc comment for why it is deliberately
 * independent of both.
 */
import { describe, expect, it } from "vitest";
import {
  buildListMarkerProjection,
  invertListMarkerProjection,
  projectedListBodyText,
} from "../src/edit/listMarkerProjection";

describe("buildListMarkerProjection: success cases", () => {
  it("splits a '-' marker single-line list item into indent/marker/markerSpacing/body", () => {
    const outcome = buildListMarkerProjection("- ![[imgX1.png]]");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection).toEqual({
      rawLine: "- ![[imgX1.png]]",
      indent: "",
      marker: "-",
      markerSpacing: " ",
      body: "![[imgX1.png]]",
    });
  });

  it("splits a '*' marker single-line list item the same way", () => {
    const outcome = buildListMarkerProjection("* ![[imgX1.png]]");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.marker).toBe("*");
    expect(outcome.projection.body).toBe("![[imgX1.png]]");
  });

  it("splits a '+' marker single-line list item the same way", () => {
    const outcome = buildListMarkerProjection("+ 史料項目");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.marker).toBe("+");
    expect(outcome.projection.body).toBe("史料項目");
  });

  it("preserves outer (nested list item) indentation in the indent field", () => {
    const outcome = buildListMarkerProjection("  - ![[nested.png]]");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.indent).toBe("  ");
    expect(outcome.projection.body).toBe("![[nested.png]]");
  });

  it("indent + marker + markerSpacing + body reconstructs rawLine byte-for-byte (the core invariant)", () => {
    for (const rawLine of ["- ![[a.png]]", "  * item with  extra   spacing", "+text-with-no-space-at-all"]) {
      const outcome = buildListMarkerProjection(rawLine);
      // "+text-with-no-space-at-all" has no space after the marker at all,
      // but still matches LIST_MARKER_LINE_RE (group 3/4 both capture the
      // remainder split at the marker boundary) — see this module's own
      // LIST_MARKER_LINE_RE doc comment.
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error("expected ok");
      const { indent, marker, markerSpacing, body } = outcome.projection;
      expect(indent + marker + markerSpacing + body).toBe(rawLine);
    }
  });

  it("a bare marker with no trailing content produces an empty markerSpacing and empty body", () => {
    const outcome = buildListMarkerProjection("-");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.markerSpacing).toBe("");
    expect(outcome.projection.body).toBe("");
  });

  it("projectedListBodyText returns exactly projection.body", () => {
    const outcome = buildListMarkerProjection("- ![[imgX1.png]]");
    if (!outcome.ok) throw new Error("expected ok");
    expect(projectedListBodyText(outcome.projection)).toBe("![[imgX1.png]]");
  });
});

describe("buildListMarkerProjection: rejection reasons", () => {
  it("rejects an ordered marker ('1.') with reason \"ordered-marker\"", () => {
    expect(buildListMarkerProjection("1. ![[imgX1.png]]")).toEqual({
      ok: false,
      reason: "ordered-marker",
    });
  });

  it("rejects an ordered marker ('1)') with reason \"ordered-marker\"", () => {
    expect(buildListMarkerProjection("1) ![[imgX1.png]]")).toEqual({
      ok: false,
      reason: "ordered-marker",
    });
  });

  it("rejects a task-list checkbox body ('- [ ] ...') with reason \"task-list-marker\"", () => {
    expect(buildListMarkerProjection("- [ ] ![[imgX1.png]]")).toEqual({
      ok: false,
      reason: "task-list-marker",
    });
  });

  it("rejects a checked task-list checkbox body ('- [x] ...') with reason \"task-list-marker\"", () => {
    expect(buildListMarkerProjection("- [x] done")).toEqual({
      ok: false,
      reason: "task-list-marker",
    });
  });

  it("rejects an arbitrary single-character task-list status ('- [/] ...') with reason \"task-list-marker\"", () => {
    expect(buildListMarkerProjection("- [/] in progress")).toEqual({
      ok: false,
      reason: "task-list-marker",
    });
  });

  it("does NOT reject a body that merely CONTAINS bracket text later, not immediately after the marker", () => {
    const outcome = buildListMarkerProjection("- some [ ] text later");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.body).toBe("some [ ] text later");
  });

  it("rejects a line that does not match the list-line shape at all with reason \"not-list-line\" (defensive)", () => {
    expect(buildListMarkerProjection("plain paragraph text, no marker")).toEqual({
      ok: false,
      reason: "not-list-line",
    });
  });
});

describe("invertListMarkerProjection: round-trip and edit handling", () => {
  it("an unedited body reconstructs rawLine byte-for-byte", () => {
    const built = buildListMarkerProjection("  - ![[imgX1.png]]");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertListMarkerProjection(built.projection, built.projection.body);
    expect(inverted).toEqual({ ok: true, rawLine: "  - ![[imgX1.png]]" });
  });

  it("an edited body reconstructs with the ORIGINAL marker/indentation preserved", () => {
    const built = buildListMarkerProjection("  - ![[imgX1.png]]");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertListMarkerProjection(built.projection, "![[imgY1.png]]");
    expect(inverted).toEqual({ ok: true, rawLine: "  - ![[imgY1.png]]" });
  });

  it("a body edited to contain a literal '- ' prefix is never collapsed/treated as a real marker (no double-marker special-casing)", () => {
    const built = buildListMarkerProjection("- original");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertListMarkerProjection(built.projection, "- injected text");
    // The user's own "- " is preserved as plain literal body content —
    // the result has the ORIGINAL marker once, followed by the user's
    // own "- " as ordinary text, never collapsed into one marker and
    // never producing a nested list.
    expect(inverted).toEqual({ ok: true, rawLine: "- - injected text" });
  });

  it("rejects a body edit that introduces a newline with reason \"multiline-body\"", () => {
    const built = buildListMarkerProjection("- item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertListMarkerProjection(built.projection, "line one\nline two");
    expect(inverted).toEqual({ ok: false, reason: "multiline-body" });
  });

  it("synthesizes exactly one space when an originally-empty markerSpacing (bare marker) is given non-empty body text, so the result stays a valid list line", () => {
    const built = buildListMarkerProjection("-");
    if (!built.ok) throw new Error("expected ok");
    expect(built.projection.markerSpacing).toBe("");
    const inverted = invertListMarkerProjection(built.projection, "new text");
    expect(inverted).toEqual({ ok: true, rawLine: "- new text" });
  });

  it("an originally-empty markerSpacing edited to a STILL-empty body reconstructs the original bare marker unchanged", () => {
    const built = buildListMarkerProjection("-");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertListMarkerProjection(built.projection, "");
    expect(inverted).toEqual({ ok: true, rawLine: "-" });
  });

  it("a non-empty ORIGINAL markerSpacing is reused verbatim even when the new body is longer/shorter (no reformatting)", () => {
    const built = buildListMarkerProjection("-   original");
    if (!built.ok) throw new Error("expected ok");
    expect(built.projection.markerSpacing).toBe("   ");
    const inverted = invertListMarkerProjection(built.projection, "x");
    expect(inverted).toEqual({ ok: true, rawLine: "-   x" });
  });

  it("clearing the body entirely reconstructs the bare marker + original spacing, never an invalid line", () => {
    const built = buildListMarkerProjection("- ![[imgX1.png]]");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertListMarkerProjection(built.projection, "");
    expect(inverted).toEqual({ ok: true, rawLine: "- " });
  });
});

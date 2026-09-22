/**
 * Phase 5L-3 ("Ordered List Marker-Free Partial Edit"): unit tests for
 * edit/orderedListProjection.ts's pure build/invert pair, in isolation
 * from the standalone Partial Edit Pane wiring — mirrors
 * tests/taskListProjection.test.ts's own structure exactly, since this
 * module is the ordered-list counterpart of both that module and
 * edit/listMarkerProjection.ts.
 */
import { describe, expect, it } from "vitest";
import { buildListMarkerProjection } from "../src/edit/listMarkerProjection";
import { buildTaskListProjection } from "../src/edit/taskListProjection";
import {
  buildOrderedListProjection,
  invertOrderedListProjection,
  isValidOrderedListNumberText,
  projectedOrderedBodyText,
  projectedOrderedNumberText,
} from "../src/edit/orderedListProjection";

describe("buildOrderedListProjection: success cases", () => {
  it("splits a '.' delimiter single-digit item into its five pieces", () => {
    const outcome = buildOrderedListProjection("1. 原本と写本を照合する");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection).toEqual({
      rawLine: "1. 原本と写本を照合する",
      indent: "",
      number: "1",
      delimiter: ".",
      markerSpacing: " ",
      body: "原本と写本を照合する",
    });
  });

  it("splits a ')' delimiter item the same way", () => {
    const outcome = buildOrderedListProjection("1) 校合済みの転写");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.delimiter).toBe(")");
    expect(outcome.projection.number).toBe("1");
    expect(outcome.projection.body).toBe("校合済みの転写");
  });

  it("splits a multi-digit number with '.' delimiter", () => {
    const outcome = buildOrderedListProjection("12. 別系統の検討");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.number).toBe("12");
    expect(outcome.projection.delimiter).toBe(".");
    expect(outcome.projection.body).toBe("別系統の検討");
  });

  it("splits a multi-digit number with ')' delimiter", () => {
    const outcome = buildOrderedListProjection("12) 確認済みの論点");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.number).toBe("12");
    expect(outcome.projection.delimiter).toBe(")");
  });

  it("preserves outer (nested list item) indentation in the indent field", () => {
    const outcome = buildOrderedListProjection("  2. 入れ子の leaf item");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.indent).toBe("  ");
    expect(outcome.projection.number).toBe("2");
    expect(outcome.projection.body).toBe("入れ子の leaf item");
  });

  it("preserves a leading-zero number verbatim (e.g. '007') rather than renormalizing it", () => {
    const outcome = buildOrderedListProjection("007. leading zero number");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.number).toBe("007");
    expect(outcome.projection.body).toBe("leading zero number");
  });

  it("indent + number + delimiter + markerSpacing + body reconstructs rawLine byte-for-byte (the core invariant)", () => {
    for (const rawLine of [
      "1. item",
      "12. item",
      "1) item",
      "12) item",
      "  1. indented",
      "1.",
      "999999. many digits",
    ]) {
      const outcome = buildOrderedListProjection(rawLine);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(`expected ok for ${rawLine}`);
      const { indent, number, delimiter, markerSpacing, body } = outcome.projection;
      expect(indent + number + delimiter + markerSpacing + body).toBe(rawLine);
    }
  });

  it("a bare marker with no trailing content produces an empty markerSpacing and empty body", () => {
    const outcome = buildOrderedListProjection("1.");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.markerSpacing).toBe("");
    expect(outcome.projection.body).toBe("");
  });

  it("a bare marker followed ONLY by trailing whitespace produces that whitespace as markerSpacing and an empty body", () => {
    const outcome = buildOrderedListProjection("1.   ");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.markerSpacing).toBe("   ");
    expect(outcome.projection.body).toBe("");
  });

  it("projectedOrderedBodyText returns exactly projection.body", () => {
    const outcome = buildOrderedListProjection("1. item text");
    if (!outcome.ok) throw new Error("expected ok");
    expect(projectedOrderedBodyText(outcome.projection)).toBe("item text");
  });

  it("projectedOrderedNumberText returns exactly projection.number, verbatim", () => {
    const outcome = buildOrderedListProjection("007. item");
    if (!outcome.ok) throw new Error("expected ok");
    expect(projectedOrderedNumberText(outcome.projection)).toBe("007");
  });

  it("body containing links, embeds, strong, inline code, '>', and marker-looking text round-trips as plain body content", () => {
    const rawLine =
      "1. see [[note]] and ![[img.png]] **bold** \`code\` > quote-like 2. and 3) text";
    const outcome = buildOrderedListProjection(rawLine);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.body).toBe(
      "see [[note]] and ![[img.png]] **bold** \`code\` > quote-like 2. and 3) text"
    );
  });
});

describe("buildOrderedListProjection: rejection reasons", () => {
  it("rejects a '-' marker with reason \"unordered-marker\"", () => {
    expect(buildOrderedListProjection("- item")).toEqual({
      ok: false,
      reason: "unordered-marker",
    });
  });

  it("rejects a '*' marker with reason \"unordered-marker\"", () => {
    expect(buildOrderedListProjection("* item")).toEqual({
      ok: false,
      reason: "unordered-marker",
    });
  });

  it("rejects a '+' marker with reason \"unordered-marker\"", () => {
    expect(buildOrderedListProjection("+ item")).toEqual({
      ok: false,
      reason: "unordered-marker",
    });
  });

  it("rejects an ordered task-list item ('1. [ ] ...') with reason \"task-list-marker\" — ordered task-list items are out of this ticket's scope, same boundary Phase 5L-2 already draws for unordered items", () => {
    expect(buildOrderedListProjection("1. [ ] item")).toEqual({
      ok: false,
      reason: "task-list-marker",
    });
  });

  it("rejects an ordered checked task-list item ('1) [x] ...') with reason \"task-list-marker\"", () => {
    expect(buildOrderedListProjection("1) [x] item")).toEqual({
      ok: false,
      reason: "task-list-marker",
    });
  });

  it("rejects a line that does not match the list-line shape at all with reason \"not-list-line\" (defensive)", () => {
    expect(buildOrderedListProjection("plain paragraph text, no marker")).toEqual({
      ok: false,
      reason: "not-list-line",
    });
  });

  it("does not treat body text that merely CONTAINS a number+delimiter later as a nested marker (no special-casing)", () => {
    const outcome = buildOrderedListProjection("1. see item 2. later in the body");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.body).toBe("see item 2. later in the body");
  });
});

describe("buildOrderedListProjection vs. buildListMarkerProjection / buildTaskListProjection: mutual exclusivity (the boundary all three modules must never disagree on)", () => {
  const lines = [
    "1. item",
    "12. item",
    "1) item",
    "12) item",
    "  2. nested leaf",
    "1.",
    "1.   ",
    "007. leading zero",
    "1. [ ] ordered task",
    "1) [x] ordered task done",
    "- item",
    "* item",
    "+ item",
    "- [ ] unordered task",
  ];

  it("for every fixture line, at most one of buildListMarkerProjection/buildTaskListProjection/buildOrderedListProjection ever succeeds", () => {
    for (const line of lines) {
      const listOutcome = buildListMarkerProjection(line);
      const taskOutcome = buildTaskListProjection(line);
      const orderedOutcome = buildOrderedListProjection(line);
      const successCount = [listOutcome.ok, taskOutcome.ok, orderedOutcome.ok].filter(Boolean)
        .length;
      expect(successCount).toBeLessThanOrEqual(1);
    }
  });

  it("buildListMarkerProjection's own \"ordered-marker\" refusal and buildOrderedListProjection's own success agree exactly, for every ordered, non-task fixture line", () => {
    for (const line of lines) {
      const listOutcome = buildListMarkerProjection(line);
      if (listOutcome.ok) {
        continue;
      }
      if (listOutcome.reason !== "ordered-marker") {
        continue;
      }
      const orderedOutcome = buildOrderedListProjection(line);
      const taskOutcome = buildTaskListProjection(line);
      // An "ordered-marker" refusal from buildListMarkerProjection means
      // the line's marker is ordered; buildOrderedListProjection then
      // succeeds UNLESS the body is itself a task checkbox (in which case
      // buildOrderedListProjection also refuses, with "task-list-marker",
      // and buildTaskListProjection never even attempts ordered lines at
      // all — see edit/taskListProjection.ts's own "ordered-marker"
      // refusal, unreachable here since buildTaskListProjection is not
      // exercised against ordered markers in this ticket's own dispatch).
      if (orderedOutcome.ok) {
        expect(taskOutcome.ok).toBe(false);
      } else {
        expect(orderedOutcome.reason === "task-list-marker" || orderedOutcome.reason === "not-list-line").toBe(
          true
        );
      }
    }
  });
});

describe("isValidOrderedListNumberText", () => {
  it("accepts plain positive integers, including multi-digit and leading-zero forms", () => {
    for (const n of ["1", "12", "007", "999999"]) {
      expect(isValidOrderedListNumberText(n)).toBe(true);
    }
  });

  it("rejects an empty string", () => {
    expect(isValidOrderedListNumberText("")).toBe(false);
  });

  it("rejects exactly zero, in any digit-count form", () => {
    expect(isValidOrderedListNumberText("0")).toBe(false);
    expect(isValidOrderedListNumberText("00")).toBe(false);
    expect(isValidOrderedListNumberText("000")).toBe(false);
  });

  it("rejects a negative number", () => {
    expect(isValidOrderedListNumberText("-1")).toBe(false);
  });

  it("rejects a decimal number", () => {
    expect(isValidOrderedListNumberText("1.5")).toBe(false);
  });

  it("rejects exponential notation", () => {
    expect(isValidOrderedListNumberText("1e2")).toBe(false);
    expect(isValidOrderedListNumberText("1E2")).toBe(false);
  });

  it("rejects the literal strings 'NaN' and 'Infinity'", () => {
    expect(isValidOrderedListNumberText("NaN")).toBe(false);
    expect(isValidOrderedListNumberText("Infinity")).toBe(false);
    expect(isValidOrderedListNumberText("-Infinity")).toBe(false);
  });

  it("rejects leading, trailing, or purely-whitespace values", () => {
    expect(isValidOrderedListNumberText(" 1")).toBe(false);
    expect(isValidOrderedListNumberText("1 ")).toBe(false);
    expect(isValidOrderedListNumberText(" ")).toBe(false);
    expect(isValidOrderedListNumberText("\t1")).toBe(false);
  });

  it("rejects a leading '+' sign", () => {
    expect(isValidOrderedListNumberText("+1")).toBe(false);
  });

  it("rejects non-digit punctuation such as an underscore digit-group separator", () => {
    expect(isValidOrderedListNumberText("1_000")).toBe(false);
  });
});

describe("invertOrderedListProjection: round-trip and edit handling", () => {
  it("an unedited call reconstructs rawLine byte-for-byte, including an original leading-zero number", () => {
    const built = buildOrderedListProjection("007. confirmed");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(
      built.projection,
      built.projection.number,
      built.projection.body
    );
    expect(inverted).toEqual({ ok: true, rawLine: "007. confirmed" });
  });

  it("editing the body only (number unchanged) preserves the ORIGINAL number text verbatim, leading zeros included", () => {
    const built = buildOrderedListProjection("007. confirmed");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, built.projection.number, "revised body");
    expect(inverted).toEqual({ ok: true, rawLine: "007. revised body" });
  });

  it("editing the number only (body unchanged) applies the new number and preserves the delimiter", () => {
    const built = buildOrderedListProjection("3. third item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, "99", built.projection.body);
    expect(inverted).toEqual({ ok: true, rawLine: "99. third item" });
  });

  it("preserves the ')' delimiter through a number edit — the delimiter itself is never an editable field", () => {
    const built = buildOrderedListProjection("1) item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, "5", "item");
    expect(inverted).toEqual({ ok: true, rawLine: "5) item" });
  });

  it("number and body can both be edited in the same Apply", () => {
    const built = buildOrderedListProjection("1. item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, "42", "revised item");
    expect(inverted).toEqual({ ok: true, rawLine: "42. revised item" });
  });

  it("a body edited to contain a literal '2. ' prefix is never collapsed/treated as a real second marker (no double-marker special-casing)", () => {
    const built = buildOrderedListProjection("1. original");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, built.projection.number, "2. injected text");
    expect(inverted).toEqual({ ok: true, rawLine: "1. 2. injected text" });
  });

  it("rejects a body edit that introduces a newline with reason \"multiline-body\", regardless of whether the number was also edited", () => {
    const built = buildOrderedListProjection("1. item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, "2", "line one\nline two");
    expect(inverted).toEqual({ ok: false, reason: "multiline-body" });
  });

  it("rejects an edited number of '0' with reason \"invalid-number\", preserving no partial write", () => {
    const built = buildOrderedListProjection("1. item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, "0", "item");
    expect(inverted).toEqual({ ok: false, reason: "invalid-number" });
  });

  it("rejects an edited number of '' (empty) with reason \"invalid-number\"", () => {
    const built = buildOrderedListProjection("1. item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, "", "item");
    expect(inverted).toEqual({ ok: false, reason: "invalid-number" });
  });

  it("rejects an edited number of '-1' with reason \"invalid-number\"", () => {
    const built = buildOrderedListProjection("1. item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, "-1", "item");
    expect(inverted).toEqual({ ok: false, reason: "invalid-number" });
  });

  it("rejects an edited number of '1.5' with reason \"invalid-number\"", () => {
    const built = buildOrderedListProjection("1. item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, "1.5", "item");
    expect(inverted).toEqual({ ok: false, reason: "invalid-number" });
  });

  it("rejects an edited number of '1e2' with reason \"invalid-number\"", () => {
    const built = buildOrderedListProjection("1. item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, "1e2", "item");
    expect(inverted).toEqual({ ok: false, reason: "invalid-number" });
  });

  it("rejects an edited number of 'NaN' with reason \"invalid-number\"", () => {
    const built = buildOrderedListProjection("1. item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, "NaN", "item");
    expect(inverted).toEqual({ ok: false, reason: "invalid-number" });
  });

  it("rejects an edited number of 'Infinity' with reason \"invalid-number\"", () => {
    const built = buildOrderedListProjection("1. item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, "Infinity", "item");
    expect(inverted).toEqual({ ok: false, reason: "invalid-number" });
  });

  it("rejects a whitespace-padded edited number ('  1  ') with reason \"invalid-number\"", () => {
    const built = buildOrderedListProjection("1. item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, "  1  ", "item");
    expect(inverted).toEqual({ ok: false, reason: "invalid-number" });
  });

  it("accepts a valid multi-digit replacement number and does not require it to be sequential with any sibling — this module has no notion of siblings at all", () => {
    const built = buildOrderedListProjection("1. item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, "500", "item");
    expect(inverted).toEqual({ ok: true, rawLine: "500. item" });
  });

  it("synthesizes exactly one space when an originally-empty markerSpacing (bare marker) is given non-empty body text, so the result stays recognizable as an ordered list line", () => {
    const built = buildOrderedListProjection("1.");
    if (!built.ok) throw new Error("expected ok");
    expect(built.projection.markerSpacing).toBe("");
    const inverted = invertOrderedListProjection(built.projection, built.projection.number, "new text");
    expect(inverted).toEqual({ ok: true, rawLine: "1. new text" });
    // The reconstructed line must itself still parse as an ordered list
    // line — the synthesized space is what keeps it recognizable on a
    // future reload.
    expect(buildOrderedListProjection(inverted.ok ? inverted.rawLine : "").ok).toBe(true);
  });

  it("an originally-empty markerSpacing edited to a STILL-empty body reconstructs the original bare marker unchanged", () => {
    const built = buildOrderedListProjection("1.");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, built.projection.number, "");
    expect(inverted).toEqual({ ok: true, rawLine: "1." });
  });

  it("a non-empty ORIGINAL markerSpacing is reused verbatim even when the new body is longer/shorter (no reformatting)", () => {
    const built = buildOrderedListProjection("1.   original");
    if (!built.ok) throw new Error("expected ok");
    expect(built.projection.markerSpacing).toBe("   ");
    const inverted = invertOrderedListProjection(built.projection, built.projection.number, "x");
    expect(inverted).toEqual({ ok: true, rawLine: "1.   x" });
  });

  it("clearing the body entirely reconstructs the bare marker + original spacing, never an invalid line", () => {
    const built = buildOrderedListProjection("1. item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, built.projection.number, "");
    expect(inverted).toEqual({ ok: true, rawLine: "1. " });
  });

  it("preserves indentation and delimiter through a number edit + body edit for a nested leaf item", () => {
    const built = buildOrderedListProjection("  2) nested leaf");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, "20", "revised nested leaf");
    expect(inverted).toEqual({ ok: true, rawLine: "  20) revised nested leaf" });
  });

  it("multiline-body is checked before invalid-number, so a simultaneously-invalid number and multiline body still refuse with \"multiline-body\"", () => {
    const built = buildOrderedListProjection("1. item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertOrderedListProjection(built.projection, "0", "line one\nline two");
    expect(inverted).toEqual({ ok: false, reason: "multiline-body" });
  });
});

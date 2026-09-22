/**
 * Phase 5L-2 ("Task List Marker-Free Partial Edit"): unit tests for
 * edit/taskListProjection.ts's pure build/invert pair, in isolation from
 * the standalone Partial Edit Pane wiring — mirrors
 * tests/listMarkerProjection.test.ts's own structure exactly, since this
 * module is the task-list counterpart of that one.
 */
import { describe, expect, it } from "vitest";
import {
  buildListMarkerProjection,
} from "../src/edit/listMarkerProjection";
import {
  buildTaskListProjection,
  invertTaskListProjection,
  projectedTaskBodyText,
  projectedTaskChecked,
} from "../src/edit/taskListProjection";

describe("buildTaskListProjection: success cases", () => {
  it("splits a '-' marker unchecked task item into its six pieces", () => {
    const outcome = buildTaskListProjection("- [ ] 原本と写本を照合する");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection).toEqual({
      rawLine: "- [ ] 原本と写本を照合する",
      indent: "",
      marker: "-",
      markerSpacing: " ",
      checkboxStatusChar: " ",
      checked: false,
      checkboxSpacing: " ",
      body: "原本と写本を照合する",
    });
  });

  it("splits a '-' marker checked ('x') task item, with checked: true", () => {
    const outcome = buildTaskListProjection("- [x] 校合済みの転写");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.checkboxStatusChar).toBe("x");
    expect(outcome.projection.checked).toBe(true);
    expect(outcome.projection.body).toBe("校合済みの転写");
  });

  it("splits a '*' marker task item the same way", () => {
    const outcome = buildTaskListProjection("* [ ] 別系統の検討");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.marker).toBe("*");
    expect(outcome.projection.body).toBe("別系統の検討");
  });

  it("splits a '+' marker task item with an UPPERCASE checked status ('X'), preserving its case in checkboxStatusChar while checked derives to true", () => {
    const outcome = buildTaskListProjection("+ [X] 確認済みの論点");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.checkboxStatusChar).toBe("X");
    expect(outcome.projection.checked).toBe(true);
  });

  it("preserves outer (nested list item) indentation in the indent field", () => {
    const outcome = buildTaskListProjection("  - [ ] 入れ子の leaf task");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.indent).toBe("  ");
    expect(outcome.projection.body).toBe("入れ子の leaf task");
  });

  it("indent + marker + markerSpacing + '[' + checkboxStatusChar + ']' + checkboxSpacing + body reconstructs rawLine byte-for-byte (the core invariant)", () => {
    for (const rawLine of [
      "- [ ] item",
      "  * [x] nested checked item",
      "+   [X]   extra spacing",
      "-[ ] no marker spacing",
    ]) {
      const outcome = buildTaskListProjection(rawLine);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(`expected ok for ${rawLine}`);
      const { indent, marker, markerSpacing, checkboxStatusChar, checkboxSpacing, body } =
        outcome.projection;
      expect(
        indent + marker + markerSpacing + "[" + checkboxStatusChar + "]" + checkboxSpacing + body
      ).toBe(rawLine);
    }
  });

  it("a bare checkbox with no trailing content produces an empty checkboxSpacing and empty body", () => {
    const outcome = buildTaskListProjection("- [ ]");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.checkboxSpacing).toBe("");
    expect(outcome.projection.body).toBe("");
  });

  it("a bare checkbox followed ONLY by trailing whitespace produces that whitespace as checkboxSpacing and an empty body", () => {
    const outcome = buildTaskListProjection("- [ ]   ");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.checkboxSpacing).toBe("   ");
    expect(outcome.projection.body).toBe("");
  });

  it("projectedTaskBodyText returns exactly projection.body", () => {
    const outcome = buildTaskListProjection("- [ ] item text");
    if (!outcome.ok) throw new Error("expected ok");
    expect(projectedTaskBodyText(outcome.projection)).toBe("item text");
  });

  it("projectedTaskChecked returns exactly projection.checked", () => {
    const outcome = buildTaskListProjection("- [x] done");
    if (!outcome.ok) throw new Error("expected ok");
    expect(projectedTaskChecked(outcome.projection)).toBe(true);
  });

  it("task body containing links, embeds, strong, inline code, '>', and literal '[ ]'/'[x]' text round-trips as plain body content", () => {
    const rawLine =
      "- [ ] see [[note]] and ![[img.png]] **bold** `code` > quote-like [ ] and [x] text";
    const outcome = buildTaskListProjection(rawLine);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.projection.body).toBe(
      "see [[note]] and ![[img.png]] **bold** `code` > quote-like [ ] and [x] text"
    );
  });
});

describe("buildTaskListProjection: rejection reasons", () => {
  it("rejects an ordered marker ('1.') with reason \"ordered-marker\"", () => {
    expect(buildTaskListProjection("1. [ ] item")).toEqual({
      ok: false,
      reason: "ordered-marker",
    });
  });

  it("rejects an ordered marker ('1)') with reason \"ordered-marker\"", () => {
    expect(buildTaskListProjection("1) [ ] item")).toEqual({
      ok: false,
      reason: "ordered-marker",
    });
  });

  it("rejects a non-task unordered list item with reason \"not-task-checkbox\"", () => {
    expect(buildTaskListProjection("- plain item, no checkbox")).toEqual({
      ok: false,
      reason: "not-task-checkbox",
    });
  });

  it("rejects a checkbox immediately followed by non-whitespace body text ('- [x]text') with reason \"not-task-checkbox\" — mirrors listMarkerProjection.ts's own task-line boundary exactly (see cross-check test below)", () => {
    expect(buildTaskListProjection("- [x]text")).toEqual({
      ok: false,
      reason: "not-task-checkbox",
    });
  });

  it("rejects an unsupported single-character checkbox status ('- [/] ...') with reason \"unsupported-status\" — this ticket's own minimal scope only supports ' '/'x'/'X'", () => {
    expect(buildTaskListProjection("- [/] in progress")).toEqual({
      ok: false,
      reason: "unsupported-status",
    });
  });

  it("rejects another unsupported status ('- [-] ...') with reason \"unsupported-status\"", () => {
    expect(buildTaskListProjection("- [-] cancelled")).toEqual({
      ok: false,
      reason: "unsupported-status",
    });
  });

  it("rejects a line that does not match the list-line shape at all with reason \"not-list-line\" (defensive)", () => {
    expect(buildTaskListProjection("plain paragraph text, no marker")).toEqual({
      ok: false,
      reason: "not-list-line",
    });
  });

  it("does not treat a body that merely CONTAINS bracket text later, not immediately after the marker, as a checkbox", () => {
    expect(buildTaskListProjection("- some [ ] text later")).toEqual({
      ok: false,
      reason: "not-task-checkbox",
    });
  });
});

describe("buildTaskListProjection vs. buildListMarkerProjection: mutual exclusivity (the boundary the two modules must never disagree on)", () => {
  const lines = [
    "- [ ] item",
    "- [x] done",
    "* [ ] item",
    "+ [X] confirmed",
    "  - [ ] nested leaf",
    "- [ ]",
    "- [ ]   ",
    "-[ ] no marker spacing",
    "- [x] ",
    "- some [ ] text later",
    "- plain item",
    "1. [ ] ordered",
  ];

  it("for every fixture line, exactly one of buildListMarkerProjection/buildTaskListProjection ever succeeds (checkbox-shaped lines succeed via buildTaskListProjection; everything else succeeds via buildListMarkerProjection, or neither for an ordered marker)", () => {
    for (const line of lines) {
      const listOutcome = buildListMarkerProjection(line);
      const taskOutcome = buildTaskListProjection(line);
      expect(listOutcome.ok && taskOutcome.ok).toBe(false);
    }
  });

  it("buildListMarkerProjection's own \"task-list-marker\" refusal and buildTaskListProjection's own success agree exactly, for every fixture line whose marker is unordered", () => {
    for (const line of lines) {
      const listOutcome = buildListMarkerProjection(line);
      if (listOutcome.ok || (!listOutcome.ok && listOutcome.reason === "ordered-marker")) {
        continue;
      }
      const taskOutcome = buildTaskListProjection(line);
      expect(!listOutcome.ok && listOutcome.reason === "task-list-marker").toBe(taskOutcome.ok);
    }
  });

  it("'- [x]text' (no space after ']') is a plain ListMarkerProjection body, never a TaskListProjection — a checkbox must be immediately followed by whitespace or end-of-line to count as a checkbox at all, matching listMarkerProjection.ts's own TASK_LIST_BODY_RE boundary", () => {
    const listOutcome = buildListMarkerProjection("- [x]text");
    expect(listOutcome).toEqual({ ok: true, projection: expect.objectContaining({ body: "[x]text" }) });
    expect(buildTaskListProjection("- [x]text")).toEqual({ ok: false, reason: "not-task-checkbox" });
  });
});

describe("invertTaskListProjection: round-trip and edit handling", () => {
  it("an unedited call reconstructs rawLine byte-for-byte, including an original uppercase 'X' status", () => {
    const built = buildTaskListProjection("+ [X] confirmed");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertTaskListProjection(
      built.projection,
      built.projection.checked,
      built.projection.body
    );
    expect(inverted).toEqual({ ok: true, rawLine: "+ [X] confirmed" });
  });

  it("editing the body only (checkbox state unchanged) preserves the ORIGINAL checkbox character verbatim, case included", () => {
    const built = buildTaskListProjection("+ [X] confirmed");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertTaskListProjection(built.projection, true, "revised body");
    expect(inverted).toEqual({ ok: true, rawLine: "+ [X] revised body" });
  });

  it("toggling checked -> unchecked writes a canonical single space, regardless of the original character's case", () => {
    const built = buildTaskListProjection("+ [X] confirmed");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertTaskListProjection(built.projection, false, built.projection.body);
    expect(inverted).toEqual({ ok: true, rawLine: "+ [ ] confirmed" });
  });

  it("toggling unchecked -> checked writes a canonical lowercase 'x'", () => {
    const built = buildTaskListProjection("- [ ] item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertTaskListProjection(built.projection, true, built.projection.body);
    expect(inverted).toEqual({ ok: true, rawLine: "- [x] item" });
  });

  it("checkbox and body can both be edited in the same Apply", () => {
    const built = buildTaskListProjection("- [ ] item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertTaskListProjection(built.projection, true, "revised item");
    expect(inverted).toEqual({ ok: true, rawLine: "- [x] revised item" });
  });

  it("a body edited to contain a literal '- [x] ' prefix is never collapsed/treated as a real marker or checkbox (no double-marker, no double-checkbox special-casing)", () => {
    const built = buildTaskListProjection("- [ ] original");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertTaskListProjection(built.projection, false, "- [x] injected text");
    expect(inverted).toEqual({ ok: true, rawLine: "- [ ] - [x] injected text" });
  });

  it("rejects a body edit that introduces a newline with reason \"multiline-body\", regardless of whether the checkbox was also toggled", () => {
    const built = buildTaskListProjection("- [ ] item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertTaskListProjection(built.projection, true, "line one\nline two");
    expect(inverted).toEqual({ ok: false, reason: "multiline-body" });
  });

  it("synthesizes exactly one space when an originally-empty checkboxSpacing (bare checkbox) is given non-empty body text, so the result stays recognizable as a task checkbox", () => {
    const built = buildTaskListProjection("- [ ]");
    if (!built.ok) throw new Error("expected ok");
    expect(built.projection.checkboxSpacing).toBe("");
    const inverted = invertTaskListProjection(built.projection, built.projection.checked, "new text");
    expect(inverted).toEqual({ ok: true, rawLine: "- [ ] new text" });
    // The reconstructed line must itself still parse as a task line — the
    // synthesized space is what keeps it recognizable on a future reload.
    expect(buildTaskListProjection(inverted.ok ? inverted.rawLine : "").ok).toBe(true);
  });

  it("an originally-empty checkboxSpacing edited to a STILL-empty body reconstructs the original bare checkbox unchanged", () => {
    const built = buildTaskListProjection("- [ ]");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertTaskListProjection(built.projection, built.projection.checked, "");
    expect(inverted).toEqual({ ok: true, rawLine: "- [ ]" });
  });

  it("a non-empty ORIGINAL checkboxSpacing is reused verbatim even when the new body is longer/shorter (no reformatting)", () => {
    const built = buildTaskListProjection("- [ ]   original");
    if (!built.ok) throw new Error("expected ok");
    expect(built.projection.checkboxSpacing).toBe("   ");
    const inverted = invertTaskListProjection(built.projection, built.projection.checked, "x");
    expect(inverted).toEqual({ ok: true, rawLine: "- [ ]   x" });
  });

  it("clearing the body entirely reconstructs the bare checkbox + original spacing, never an invalid line", () => {
    const built = buildTaskListProjection("- [ ] item");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertTaskListProjection(built.projection, built.projection.checked, "");
    expect(inverted).toEqual({ ok: true, rawLine: "- [ ] " });
  });

  it("preserves indentation and marker type through a checkbox toggle + body edit for a nested leaf item", () => {
    const built = buildTaskListProjection("  * [ ] nested leaf");
    if (!built.ok) throw new Error("expected ok");
    const inverted = invertTaskListProjection(built.projection, true, "revised nested leaf");
    expect(inverted).toEqual({ ok: true, rawLine: "  * [x] revised nested leaf" });
  });
});

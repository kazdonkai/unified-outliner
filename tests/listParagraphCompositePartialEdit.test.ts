/**
 * v1.0.4 (Tree + Partial Edit phase): Partial Edit projection / Apply of a
 * "List item + Paragraph" CompositeBlock, with the paragraph's existing
 * block id protected. Pure level: edit/listParagraphCompositeProjection.ts
 * composed with the unchanged edit/compositeBlockPartialEdit.ts pipeline.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { BUILTIN_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { buildCompositeBlockSnapshot, CompositeBlockSnapshot } from "../src/edit/deleteCompositeBlock";
import { applyCompositeBlockEdit, extractCompositeBlockText } from "../src/edit/compositeBlockPartialEdit";
import {
  blockIdKeptInParagraphWithin,
  buildListParagraphProjection,
  composeListParagraphText,
  isListParagraphSnapshot,
  ListParagraphProjection,
  verifyBlockIdStaysInParagraph,
} from "../src/edit/listParagraphCompositeProjection";
import { buildCompositeListMemberProjection, invertListMarkerProjection } from "../src/edit/listMarkerProjection";

const rules = BUILTIN_COMPOSITE_BLOCK_RULES;

function snapshotOf(text: string): { lines: string[]; snapshot: CompositeBlockSnapshot } {
  const doc = parseDocument(text);
  const c = matchCompositeBlocks(doc, scanComplexBlocks(doc), rules).find((x) => x.ruleId === "list-paragraph");
  if (!c) throw new Error("no list-paragraph composite");
  return { lines: doc.lines, snapshot: buildCompositeBlockSnapshot(c) };
}

function project(text: string): { lines: string[]; snapshot: CompositeBlockSnapshot; p: ListParagraphProjection } {
  const { lines, snapshot } = snapshotOf(text);
  const built = buildListParagraphProjection(lines, snapshot);
  if (!built.ok) throw new Error(`projection refused: ${built.reason}`);
  return { lines, snapshot, p: built.projection };
}

/** Simulates the pane's Apply: compose, guard, then the unchanged applyCompositeBlockEdit. */
type ApplyResult =
  | { refused: string }
  | { outcome: ReturnType<typeof applyCompositeBlockEdit>; text: string };

function applyEdit(text: string, listLine: string | null, body: string | null): ApplyResult {
  const { lines, snapshot, p } = project(text);
  const doc = parseDocument(text);
  const extracted = extractCompositeBlockText(doc, snapshot, rules);
  if (!extracted.ok) throw new Error("extract failed");
  const composed = composeListParagraphText(p, listLine ?? p.listLine, body ?? p.body);
  if (!composed.ok) return { refused: composed.reason };
  const start = snapshot.range.startLine;
  const candidate = [...lines.slice(0, start), ...composed.text.split("\n"), ...lines.slice(snapshot.range.endLine + 1)];
  if (p.blockId !== null && !verifyBlockIdStaysInParagraph(candidate, start + composed.idLineOffset!, p.blockId)) {
    return { refused: "block-id-would-move" };
  }
  const outcome = applyCompositeBlockEdit(doc, snapshot, extracted.text, composed.text, rules);
  return { outcome, text: outcome.lines.join("\n") };
}

describe("projection: display order and content", () => {
  it("list line (raw, marker included), paragraph body (indent and inline id removed), id read separately", () => {
    const { p } = project(["# H", "- 史料A", "  村持入会地として記載。 ^lp-a"].join("\n"));
    expect(p.listLine).toBe("- 史料A");
    expect(p.body).toBe("村持入会地として記載。");
    expect(p.blockId).toBe("lp-a");
    expect(p.idShape).toBe("inline");
  });

  it("a lone id last line is taken out of the body as the standalone shape", () => {
    const { p } = project(["- 史料B", "  本文1行目", "  本文2行目", "  ^lp-b"].join("\n"));
    expect(p.body).toBe("本文1行目\n本文2行目");
    expect(p.blockId).toBe("lp-b");
    expect(p.idShape).toBe("standalone");
  });

  it("no id: blockId null, body is the whole paragraph", () => {
    const { p } = project(["1. item", "   body text"].join("\n"));
    expect(p.blockId).toBeNull();
    expect(p.idShape).toBeNull();
    expect(p.body).toBe("body text");
  });

  it("only applies to List item + Paragraph snapshots", () => {
    const doc = parseDocument(["- img", "> [!ocr]", "> t"].join("\n"));
    const c = matchCompositeBlocks(doc, scanComplexBlocks(doc), rules)[0];
    const snap = buildCompositeBlockSnapshot(c);
    expect(isListParagraphSnapshot(snap)).toBe(false);
    expect(buildListParagraphProjection(doc.lines, snap)).toEqual({ ok: false, reason: "not-list-paragraph" });
  });
});

describe("round trip and Apply", () => {
  const cases = [
    ["- item", "  line a", "  line b ^lp-1"],
    ["- item", "  line a  ^lp-2  "],
    ["- item", "  line a", "  ^lp-3"],
    ["- [ ] task", "      under the task"],
    ["  - nested", "    deeper body", "      extra indent kept ^n-1"],
  ];

  it("compose(unedited) reproduces the composite range byte-for-byte", () => {
    for (const lines of cases) {
      const { p, snapshot, lines: all } = project(lines.join("\n"));
      const composed = composeListParagraphText(p, p.listLine, p.body);
      if (!composed.ok) throw new Error("compose failed");
      expect(composed.text).toBe(all.slice(snapshot.range.startLine, snapshot.range.endLine + 1).join("\n"));
    }
  });

  it("an edited body keeps the inline id at the end of the paragraph, never on the list line", () => {
    const r = applyEdit(["# H", "- item", "  old ^lp-a", "", "next"].join("\n"), null, "new first\nnew second");
    if (!("outcome" in r)) throw new Error(String(r.refused));
    expect(r.text).toBe(["# H", "- item", "  new first", "  new second ^lp-a", "", "next"].join("\n"));
    expect(r.outcome.ruleStillMatches).toBe(true);
  });

  it("an edited body keeps the standalone id line as the paragraph's last line", () => {
    const r = applyEdit(["- item", "  old", "  ^lp-b"].join("\n"), "- edited item", "changed\nmore");
    if (!("outcome" in r)) throw new Error(String(r.refused));
    expect(r.text).toBe(["- edited item", "  changed", "  more", "  ^lp-b"].join("\n"));
    expect(r.outcome.ruleStillMatches).toBe(true);
  });

  it("trailing blank lines typed after the body never push the id out of the paragraph", () => {
    const r = applyEdit(["- item", "  old ^lp-c"].join("\n"), null, "new\n\n\n");
    if (!("outcome" in r)) throw new Error(String(r.refused));
    expect(r.text).toBe(["- item", "  new ^lp-c"].join("\n"));
  });

  it("a paragraph without an id gets none after Apply (no id is ever issued)", () => {
    const r = applyEdit(["- item", "  plain"].join("\n"), null, "edited");
    if (!("outcome" in r)) throw new Error(String(r.refused));
    expect(r.text).toBe(["- item", "  edited"].join("\n"));
    expect(r.text).not.toMatch(/\^/);
  });

  it("an empty body is refused while the paragraph has an id", () => {
    expect(applyEdit(["- item", "  x ^lp-d"].join("\n"), null, "  \n")).toEqual({ refused: "body-empty-with-block-id" });
  });

  it("turning the last body line into a list item would move the id — refused before writing", () => {
    expect(applyEdit(["- item", "  x ^lp-e"].join("\n"), null, "x\n- now a list item")).toEqual({
      refused: "block-id-would-move",
    });
  });

  it("a structure-breaking edit is saved as typed and only the composite dissolves (id still inside a paragraph)", () => {
    const r = applyEdit(["- item", "  a ^lp-f"].join("\n"), null, "a\n\nb");
    if (!("outcome" in r)) throw new Error(String(r.refused));
    expect(r.text).toBe(["- item", "  a", "", "  b ^lp-f"].join("\n"));
    expect(r.outcome.ruleStillMatches).toBe(false);
    const doc = parseDocument(r.text);
    expect(matchCompositeBlocks(doc, scanComplexBlocks(doc), rules)).toHaveLength(0);
    expect(verifyBlockIdStaysInParagraph(doc.lines, 3, "lp-f")).toBe(true);
  });

  it("removing the list marker is saved; the composite dissolves and the id stays in the paragraph", () => {
    const r = applyEdit(["- item", "  a ^lp-g"].join("\n"), "plain line", null);
    if (!("outcome" in r)) throw new Error(String(r.refused));
    expect(r.text).toBe(["plain line", "  a ^lp-g"].join("\n"));
    expect(r.outcome.ruleStillMatches).toBe(false);
  });

  it("a list line containing a newline is refused", () => {
    expect(applyEdit(["- item", "  a"].join("\n"), "- a\n- b", null)).toEqual({ refused: "list-line-newline" });
  });

  it("without Apply nothing changes: extracting and projecting never alters the note", () => {
    const text = ["- item", "  a ^lp-h"].join("\n");
    const doc = parseDocument(text);
    const before = doc.lines.slice();
    const { snapshot } = snapshotOf(text);
    extractCompositeBlockText(doc, snapshot, rules);
    buildListParagraphProjection(doc.lines, snapshot);
    expect(doc.lines).toEqual(before);
  });
});

describe("raw-fallback guard", () => {
  it("blockIdKeptInParagraphWithin requires the id to remain some paragraph's own id inside the range", () => {
    expect(blockIdKeptInParagraphWithin(["- item", "  a ^x"], 0, 1, "x")).toBe(true);
    expect(blockIdKeptInParagraphWithin(["- item ^x", "  a"], 0, 1, "x")).toBe(false);
    expect(blockIdKeptInParagraphWithin(["- item", "  a"], 0, 1, "x")).toBe(false);
  });
});

describe("list row is shown marker-free (same projection as a List + Callout list row)", () => {
  it("strips only the marker for display and restores it on Apply", () => {
    for (const [line, shown] of [
      ["- 史料A：入会慣行調査", "史料A：入会慣行調査"],
      ["  - nested item", "nested item"],
    ] as const) {
      const built = buildCompositeListMemberProjection(line);
      if (!built.ok) throw new Error("projection refused");
      expect(built.projection.body).toBe(shown);
      const inv = invertListMarkerProjection(built.projection, built.projection.body);
      expect(inv.ok && inv.rawLine).toBe(line);
      const edited = invertListMarkerProjection(built.projection, "edited");
      expect(edited.ok && edited.rawLine).toBe(line.replace(shown, "edited"));
    }
  });

  it("an edited marker-free list row composes back with its marker and keeps the id in the paragraph", () => {
    const { p } = project(["- 史料A", "  本文 ^lp-a"].join("\n"));
    const built = buildCompositeListMemberProjection(p.listLine);
    if (!built.ok) throw new Error("projection refused");
    const inv = invertListMarkerProjection(built.projection, "史料A（改）");
    if (!inv.ok) throw new Error("invert refused");
    const composed = composeListParagraphText(p, inv.rawLine, p.body);
    expect(composed.ok && composed.text).toBe(["- 史料A（改）", "  本文 ^lp-a"].join("\n"));
  });
});

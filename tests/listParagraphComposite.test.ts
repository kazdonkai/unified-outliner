/**
 * v1.0.4: recognition-only "list-paragraph" CompositeBlock rule
 * (single-line-list + the list item's child paragraph) and reading the
 * paragraph's EXISTING block id as structural information.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { readBlockIdWithinRange } from "../src/parser/blockIdInRange";
import { detectBlockIdLayout } from "../src/edit/partialEdit";
import {
  BUILTIN_COMPOSITE_BLOCK_RULES,
  compositeBlockDisplayLabel,
  CompositeBlockRule,
  DEFAULT_COMPOSITE_BLOCK_RULES,
  getCompositeBlockRuleById,
  getCompositeParagraphBlockId,
  STRUCTURAL_COMPOSITE_BLOCK_RULES,
} from "../src/model/compositeBlock";
import { createTranslator } from "../src/i18n";
import {
  DEFAULT_COMPOSITE_BLOCK_SETTINGS,
  getEnabledCompositeBlockRules,
  getEnabledTreeCompositeBlockRules,
  mergeSettings,
} from "../src/settingsDefaults";

function match(lines: string[], rules: CompositeBlockRule[] = BUILTIN_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(lines.join("\n"));
  const scan = scanComplexBlocks(doc);
  return matchCompositeBlocks(doc, scan, rules);
}

function listParagraphs(lines: string[]) {
  return match(lines).filter((c) => c.ruleId === "list-paragraph");
}

describe("list-paragraph: recognized shape", () => {
  it("groups a single-line list item and its child paragraph (no blank line) into one composite", () => {
    const c = listParagraphs(["- item", "  paragraph text"]);
    expect(c).toHaveLength(1);
    expect(c[0].range).toEqual({ startLine: 0, endLine: 1 });
    expect(c[0].members.map((m) => m.kind)).toEqual(["single-line-list", "paragraph"]);
    expect(c[0].members[0].range).toEqual({ startLine: 0, endLine: 0 });
    expect(c[0].members[1].range).toEqual({ startLine: 1, endLine: 1 });
  });

  it("member ranges are adjacent and never overlap; the composite spans the whole list item", () => {
    const doc = parseDocument(["# H", "- item", "  line a", "  line b"].join("\n"));
    const scan = scanComplexBlocks(doc);
    const [c] = matchCompositeBlocks(doc, scan, BUILTIN_COMPOSITE_BLOCK_RULES);
    const [list, para] = c.members;
    expect(list.range.endLine).toBeLessThan(para.range.startLine);
    expect(para.range.startLine).toBe(list.range.endLine + 1);
    const node = doc.nodes.get(list.id);
    expect(node && node.range).toEqual(c.range);
    expect(c.sectionId).toBe("sec-0");
  });

  it("requires the paragraph's parentId to be the list item (ordered marker: content column 3)", () => {
    expect(listParagraphs(["1. item", "   child paragraph"])).toHaveLength(1);
    // indented 2 columns: owned by the item as invisible continuation text, not a child paragraph
    expect(listParagraphs(["1. item", "  under-indented"])).toHaveLength(0);
  });

  it("a nested list item with its own child paragraph qualifies; its parent item (has a child list) does not", () => {
    const c = listParagraphs(["- outer", "  - inner", "    inner paragraph ^n1"]);
    expect(c).toHaveLength(1);
    expect(c[0].range).toEqual({ startLine: 1, endLine: 2 });
    expect(getCompositeParagraphBlockId(c[0])).toBe("n1");
  });

  it("works for task list items", () => {
    expect(listParagraphs(["- [ ] task", "      note under the task"])).toHaveLength(1);
  });
});

describe("list-paragraph: rejected shapes (safe no-op)", () => {
  it("does not group an under-indented paragraph that is a section-level sibling", () => {
    expect(listParagraphs(["# H", "- item", "paragraph at column 0"])).toHaveLength(0);
  });

  it("does not group a 1-column paragraph (the list item's own continuation, not a child paragraph)", () => {
    expect(listParagraphs(["- item", " one space"])).toHaveLength(0);
  });

  it("does not group across a blank line", () => {
    expect(listParagraphs(["- item", "", "  paragraph"])).toHaveLength(0);
  });

  it("does not group across a section heading", () => {
    expect(listParagraphs(["# A", "- item", "# B", "  paragraph"])).toHaveLength(0);
  });

  it("does not group when the list item's own text spans more than one line", () => {
    expect(listParagraphs(["- item", " lazy continuation", "  paragraph"])).toHaveLength(0);
  });

  it("only the first paragraph is ever considered: a blank-line-separated second paragraph rejects the item", () => {
    expect(listParagraphs(["- item", "  p1", "", "  p2"])).toHaveLength(0);
  });

  it("does not group when the list item also has a child list", () => {
    expect(listParagraphs(["- item", "  paragraph", "  - child"])).toHaveLength(0);
  });

  it("does not adopt a candidate whose paragraph range overlaps another block (downgraded paragraph)", () => {
    // the indented quote line is a blockquote child; its paragraph-scanner candidate overlaps it
    expect(listParagraphs(["- item", "  > quoted"])).toHaveLength(0);
  });

  it("does not adopt mixed tab/space marker indentation", () => {
    expect(listParagraphs(["- outer", " \t- inner", "      paragraph"]).filter((c) => c.range.startLine === 1)).toHaveLength(0);
  });
});

describe("list-paragraph: existing block id of the paragraph member", () => {
  it("reads an inline ` ^id` suffix on the paragraph's last line", () => {
    const [c] = listParagraphs(["- item", "  first line", "  last line ^para-01"]);
    expect(c.members[1].blockId).toBe("para-01");
    expect(getCompositeParagraphBlockId(c)).toBe("para-01");
  });

  it("reads a lone `^id` line that is the paragraph's own last line", () => {
    const [c] = listParagraphs(["- item", "  body", "  ^clause-001"]);
    expect(c.members[1].blockId).toBe("clause-001");
  });

  it("is null when the paragraph has no block id, and nothing is issued or written", () => {
    const lines = ["- item", "  body without id"];
    const doc = parseDocument(lines.join("\n"));
    const before = doc.lines.slice();
    const [c] = matchCompositeBlocks(doc, scanComplexBlocks(doc), BUILTIN_COMPOSITE_BLOCK_RULES);
    expect(c.members[1].blockId).toBeNull();
    expect(getCompositeParagraphBlockId(c)).toBeNull();
    expect(doc.lines).toEqual(before);
  });

  it("is absent (undefined) on the list member — the id belongs to the paragraph only", () => {
    const [c] = listParagraphs(["- item ^on-list", "  body ^on-para"]);
    expect(c.members[0].blockId).toBeUndefined();
    expect(c.members[1].blockId).toBe("on-para");
  });

  it("never takes a block id from outside the paragraph's own range", () => {
    const [c] = listParagraphs(["- item", "  body", "", "^after-block"]);
    expect(c.members[1].blockId).toBeNull();
  });

  it("does not mistake a caret inside a code span or mid-line for a block id", () => {
    expect(listParagraphs(["- item", "  uses `^code`"])[0].members[1].blockId).toBeNull();
    expect(listParagraphs(["- item", "  x^2 is squared"])[0].members[1].blockId).toBeNull();
    expect(listParagraphs(["- item", "  a ^mid then text"])[0].members[1].blockId).toBeNull();
  });

  it("getCompositeParagraphBlockId is null for composites without a paragraph member", () => {
    const [c] = match(["- img", "> [!ocr]", "> text"]);
    expect(c.ruleId).toBe("image-ocr");
    expect(getCompositeParagraphBlockId(c)).toBeNull();
    expect(c.members.every((m) => m.blockId === undefined)).toBe(true);
  });
});

describe("list-paragraph: coexistence with the existing rules", () => {
  it("image-ocr / image-quote are recognized exactly as before alongside list-paragraph; their composite-N ids are unchanged and list-paragraph uses its own id namespace", () => {
    const c = match(["- img", "> [!ocr]", "> text", "", "- src", "> quote", "", "- item", "  para ^p"]);
    expect(c.map((x) => x.ruleId)).toEqual(["image-ocr", "image-quote", "list-paragraph"]);
    expect(c.map((x) => x.id)).toEqual(["composite-0", "composite-1", "composite-list-paragraph-0"]);
  });

  it("the operable rule set is unchanged and never yields list-paragraph (Outline Tree / move / Partial Edit unaffected)", () => {
    expect(DEFAULT_COMPOSITE_BLOCK_RULES.map((r) => r.id)).toEqual(["image-ocr", "image-quote"]);
    expect(getEnabledCompositeBlockRules(DEFAULT_COMPOSITE_BLOCK_SETTINGS).map((r) => r.id)).toEqual([
      "image-ocr",
      "image-quote",
    ]);
    expect(match(["- item", "  para"], DEFAULT_COMPOSITE_BLOCK_RULES)).toHaveLength(0);
  });

  it("output for the operable rules alone is identical with or without the structural rules present elsewhere", () => {
    const lines = ["- a", "> [!x]", "> y", "- b", "  para", "- c", "> q"];
    const operable = match(lines, DEFAULT_COMPOSITE_BLOCK_RULES);
    const all = match(lines).filter((c) => c.ruleId !== "list-paragraph");
    expect(all).toEqual(operable);
  });

  it("an earlier rule's member is never reused by list-paragraph (first match wins)", () => {
    const usesList: CompositeBlockRule = { id: "test-list-first", kindSequence: ["list", "callout"], prefix: "" };
    const c = match(["- item", "  para", "> [!x]", "> y"], [usesList, ...STRUCTURAL_COMPOSITE_BLOCK_RULES]);
    expect(c.map((x) => x.ruleId)).toEqual(["test-list-first"]);
  });

  it("a continuation rule with an unsupported kindSequence matches nothing", () => {
    const odd: CompositeBlockRule = {
      id: "odd",
      kindSequence: ["single-line-list", "callout"],
      prefix: "",
      geometry: "list-child-continuation",
      treeReadOnly: true,
    };
    expect(match(["- item", "  para"], [odd])).toHaveLength(0);
  });
});

describe("list-paragraph: rule definition and settings", () => {
  it("is a tree-read-only, list-child-continuation rule evaluated after the existing rules", () => {
    const rule = getCompositeBlockRuleById(BUILTIN_COMPOSITE_BLOCK_RULES, "list-paragraph");
    expect(rule?.kindSequence).toEqual(["single-line-list", "paragraph"]);
    expect(rule?.geometry).toBe("list-child-continuation");
    expect(rule?.treeReadOnly).toBe(true);
    expect(rule?.prefix).toBe("≡");
    expect(BUILTIN_COMPOSITE_BLOCK_RULES.map((r) => r.id)).toEqual(["image-ocr", "image-quote", "list-paragraph"]);
  });

  it("all three rule names are English in both UI languages (Tree label and Settings name)", () => {
    const expected: Record<string, string> = {
      "image-ocr": "Image + OCR",
      "image-quote": "Image + Quote",
      "list-paragraph": "List item + Paragraph",
    };
    for (const locale of ["en", "ja"] as const) {
      const t = createTranslator(locale);
      for (const rule of BUILTIN_COMPOSITE_BLOCK_RULES) {
        expect(compositeBlockDisplayLabel(rule, t)).toBe(expected[rule.id]);
      }
      expect(t("settings.compositeBlockImageOcr.name")).toBe("Image + OCR");
      expect(t("settings.compositeBlockImageQuote.name")).toBe("Image + Quote");
      expect(t("settings.compositeBlockListParagraph.name")).toBe("List item + Paragraph");
    }
  });

  it("is enabled by default and can be switched off", () => {
    expect(getEnabledTreeCompositeBlockRules(DEFAULT_COMPOSITE_BLOCK_SETTINGS).map((r) => r.id)).toEqual([
      "image-ocr",
      "image-quote",
      "list-paragraph",
    ]);
    const off = getEnabledTreeCompositeBlockRules({ ...DEFAULT_COMPOSITE_BLOCK_SETTINGS, listParagraph: false });
    expect(off.map((r) => r.id)).toEqual(["image-ocr", "image-quote"]);
  });

  it("a data.json written before v1.0.4 (no listParagraph key) defaults it to true without touching the other flags", () => {
    const merged = mergeSettings({ compositeBlocks: { imageOcr: false, imageQuote: true } });
    expect(merged.compositeBlocks).toEqual({ imageOcr: false, imageQuote: true, listParagraph: true });
  });
});

describe("readBlockIdWithinRange", () => {
  const cases: string[][] = [
    ["text ^a1"],
    ["text", "^a2"],
    ["^only"],
    ["text `^code`"],
    ["x^2"],
    ["a ^mid more"],
    ["  indented ^a3  "],
    ["line", "  ^a4"],
    ["plain"],
  ];

  it("agrees with detectBlockIdLayout's in-range (inline) shapes and never looks past the range", () => {
    for (const lines of cases) {
      const range = { startLine: 0, endLine: lines.length - 1 };
      const withTrailing = [...lines, "", "^outside"];
      const layout = detectBlockIdLayout(withTrailing, 0, range.endLine, { inline: true });
      const inRange = layout.idLine >= range.startLine && layout.idLine <= range.endLine ? layout.blockId : null;
      expect(readBlockIdWithinRange(withTrailing, range)).toBe(inRange);
    }
  });

  it("returns null for an invalid range", () => {
    expect(readBlockIdWithinRange(["a ^x"], { startLine: 0, endLine: 3 })).toBeNull();
    expect(readBlockIdWithinRange(["a ^x"], { startLine: 1, endLine: 0 })).toBeNull();
  });
});

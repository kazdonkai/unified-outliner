/**
 * Phase 5D-0 / 5D-0.3: recognition-only tests for parser/compositeBlocks.ts
 * and the settingsDefaults.ts <-> model/compositeBlock.ts rule-enabling
 * glue. Rule ids/schema updated in 5D-0.3: "list-callout"/"list-blockquote"
 * -> "image-ocr"/"image-quote"; "list" + requireSingleLineList:true ->
 * "single-line-list" as its own distinct CompositeMemberKind.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import {
  compositeBlockDisplayLabel,
  CompositeBlockRule,
  DEFAULT_COMPOSITE_BLOCK_RULES,
  getCompositeBlockRuleById,
} from "../src/model/compositeBlock";
import { createTranslator } from "../src/i18n";
import {
  DEFAULT_COMPOSITE_BLOCK_SETTINGS,
  getEnabledCompositeBlockRules,
} from "../src/settingsDefaults";

function match(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  return matchCompositeBlocks(doc, complexScan, rules);
}

describe("matchCompositeBlocks: image-ocr (OCR use case)", () => {
  it("groups a one-line list item immediately followed by a callout, no blank line between", () => {
    const text = ["- ![[scan-001.png]]", "> [!ocr]", "> line1"].join("\n");
    const composites = match(text);
    expect(composites).toHaveLength(1);
    expect(composites[0].ruleId).toBe("image-ocr");
    expect(composites[0].range).toEqual({ startLine: 0, endLine: 2 });
    expect(composites[0].members.map((m) => m.kind)).toEqual(["single-line-list", "callout"]);
  });

  it("groups a one-line list item immediately followed by a blockquote", () => {
    const text = ["- source image", "> plain quote body"].join("\n");
    const composites = match(text);
    expect(composites).toHaveLength(1);
    expect(composites[0].ruleId).toBe("image-quote");
    expect(composites[0].members.map((m) => m.kind)).toEqual(["single-line-list", "blockquote"]);
  });

  it("does NOT group when a blank line separates the list item and the callout", () => {
    const text = ["- ![[scan-001.png]]", "", "> [!ocr]", "> line1"].join("\n");
    const composites = match(text);
    expect(composites).toHaveLength(0);
  });

  it("does NOT group when the list item has a continuation line (not 'single-line')", () => {
    const text = ["- ![[scan-001.png]]", "  continuation text", "> [!ocr]", "> line1"].join("\n");
    const composites = match(text);
    expect(composites).toHaveLength(0);
  });

  it("the OUTER (multi-line, has-a-child) list item does not qualify as the 'one-line list' member, but its INNER child — itself continuation-free and child-free — independently does", () => {
    // "one-line list" (spec §3.2) means "no continuation lines, no nested
    // child list", checked per-CANDIDATE, not "must be a root item". Every
    // ListBlockNode is its own independent candidate (see
    // parser/compositeBlocks.ts's collectCandidates), so "inner" here
    // qualifies on its own even though its parent "outer" does not.
    const text = ["- outer", "  - inner", "> [!ocr]", "> line1"].join("\n");
    const composites = match(text);
    expect(composites).toHaveLength(1);
    expect(composites[0].members[0].kind).toBe("single-line-list");
    expect(composites[0].range).toEqual({ startLine: 1, endLine: 3 });
  });

  it("does NOT group a list item with a callout in a DIFFERENT section, even if adjacent line-wise across a heading", () => {
    // A heading line between them means they can never be truly adjacent
    // anyway (the heading line itself breaks zero-gap adjacency), but this
    // also exercises the "same enclosing section" condition independently.
    const text = ["# A", "- one-liner", "# B", "> [!note]", "> body"].join("\n");
    const composites = match(text);
    expect(composites).toHaveLength(0);
  });

  it("does NOT group an 'unsupported'/'ambiguous' callout (e.g. nested callout) even if otherwise adjacent", () => {
    const text = ["- ![[scan.png]]", "> [!note]", "> > [!tip]", "> more"].join("\n");
    const composites = match(text);
    expect(composites).toHaveLength(0);
  });

  it("a matched member never joins a second CompositeBlock (no double-consumption)", () => {
    const text = [
      "- one",
      "> [!note]",
      "> a",
      "",
      "- two",
      "> [!note]",
      "> b",
    ].join("\n");
    const composites = match(text);
    expect(composites).toHaveLength(2);
    const allMemberIds = composites.flatMap((c) => c.members.map((m) => m.id));
    expect(new Set(allMemberIds).size).toBe(allMemberIds.length);
  });

  it("recognizes multiple independent composites across a document in document order", () => {
    const text = [
      "# H",
      "- a",
      "> [!note]",
      "> body a",
      "",
      "- b",
      "> plain quote",
      "",
      "- lone item (no follow-up)",
    ].join("\n");
    const composites = match(text);
    expect(composites).toHaveLength(2);
    expect(composites[0].ruleId).toBe("image-ocr");
    expect(composites[1].ruleId).toBe("image-quote");
  });

  it("a rule targeting plain 'list' (not 'single-line-list') DOES match a multi-line list item (continuation text, no nested list) directly, unlike the default (single-line-only) rules", () => {
    const text = ["- outer", "  continuation text", "> [!note]", "> body"].join("\n");

    // Default rules require "single-line-list" — this text's only list
    // candidate ("outer", spanning lines 0-1) is classified plain "list"
    // (multi-line), so nothing matches.
    expect(match(text)).toHaveLength(0);

    // A rule that asks for plain "list" instead accepts "outer" as-is,
    // since it is still immediately (zero-gap) followed by the callout.
    const anyListRule: CompositeBlockRule[] = [
      { id: "any-list-callout", kindSequence: ["list", "callout"], prefix: "" },
    ];
    const composites = match(text, anyListRule);
    expect(composites).toHaveLength(1);
    expect(composites[0].range).toEqual({ startLine: 0, endLine: 3 });
    expect(composites[0].members[0].kind).toBe("list");
  });

  it("does not mutate the input ParsedDocument or ComplexBlockScanResult", () => {
    const text = ["- one", "> [!note]", "> a"].join("\n");
    const doc = parseDocument(text);
    const complexScan = scanComplexBlocks(doc);
    const nodesBefore = doc.nodes.size;
    const blocksBefore = complexScan.blocks.length;
    matchCompositeBlocks(doc, complexScan, DEFAULT_COMPOSITE_BLOCK_RULES);
    expect(doc.nodes.size).toBe(nodesBefore);
    expect(complexScan.blocks.length).toBe(blocksBefore);
  });
});

describe("matchCompositeBlocks: rule priority", () => {
  it("when two rules could both start matching at the same candidate, only the higher-priority (earlier array) rule is used", () => {
    // "image-ocr" and "image-quote" can never both match the SAME second
    // member (callout and blockquote are mutually exclusive kinds), so
    // priority is exercised here with a synthetic pair of rules that both
    // start with "single-line-list" and would both match the same list item
    // if tried — confirming array order (not e.g. specificity) decides.
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const preferFirst: CompositeBlockRule[] = [
      { id: "generic-list-only", kindSequence: ["single-line-list", "callout"], prefix: "" },
      { id: "also-list-callout", kindSequence: ["single-line-list", "callout"], prefix: "" },
    ];
    const composites = match(text, preferFirst);
    expect(composites).toHaveLength(1);
    expect(composites[0].ruleId).toBe("generic-list-only");
  });
});

describe("getEnabledCompositeBlockRules", () => {
  it("returns both default rules when both flags are enabled", () => {
    const rules = getEnabledCompositeBlockRules(DEFAULT_COMPOSITE_BLOCK_SETTINGS);
    expect(rules.map((r) => r.id)).toEqual(["image-ocr", "image-quote"]);
  });

  it("excludes a rule whose settings flag is false", () => {
    const rules = getEnabledCompositeBlockRules({ imageOcr: false, imageQuote: true });
    expect(rules.map((r) => r.id)).toEqual(["image-quote"]);
  });

  it("a disabled rule never matches even when its shape is present in the document", () => {
    const text = ["- one", "> [!note]", "> body"].join("\n");
    const rules = getEnabledCompositeBlockRules({ imageOcr: false, imageQuote: true });
    const composites = match(text, rules);
    expect(composites).toHaveLength(0);
  });
});

describe("compositeBlockDisplayLabel / getCompositeBlockRuleById", () => {
  it("resolves a built-in rule's display label via i18n, in both English and Japanese", () => {
    const rule = getCompositeBlockRuleById(DEFAULT_COMPOSITE_BLOCK_RULES, "image-ocr")!;
    expect(compositeBlockDisplayLabel(rule, createTranslator("en"))).toBe("Image + OCR");
    expect(compositeBlockDisplayLabel(rule, createTranslator("ja"))).toBe("画像+OCR");
  });

  it("a customLabel always wins over the built-in i18n lookup, in every locale", () => {
    const rule: CompositeBlockRule = {
      id: "image-ocr",
      kindSequence: ["single-line-list", "callout"],
      prefix: "◉",
      customLabel: "My Custom Group",
    };
    expect(compositeBlockDisplayLabel(rule, createTranslator("en"))).toBe("My Custom Group");
    expect(compositeBlockDisplayLabel(rule, createTranslator("ja"))).toBe("My Custom Group");
  });

  it("an unknown rule id with no customLabel falls back to the raw id", () => {
    const rule: CompositeBlockRule = {
      id: "some-future-rule",
      kindSequence: ["single-line-list", "table"],
      prefix: "",
    };
    expect(compositeBlockDisplayLabel(rule)).toBe("some-future-rule");
  });
});

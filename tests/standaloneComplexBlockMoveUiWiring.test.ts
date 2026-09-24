/**
 * Phase 5C-3 (2026-08-14): tests for the OutlineTreeView.ts UI wiring this
 * ticket added to showStandaloneComplexBlockMenu — move up/down items,
 * independently gated by evaluateStandaloneComplexBlockMovability, added
 * alongside the pre-existing (Phase 5C-2) unconditional "Open in Partial
 * Edit" item.
 *
 * ---- Scope / what this file deliberately does NOT test -----------------
 *
 * Same testing-boundary rationale as tests/compositeBlockMoveUiWiring.test.ts
 * and tests/standaloneComplexBlockUiWiring.test.ts (see those files' own
 * top doc comments): "obsidian" is a types-only package in this project, so
 * no ItemView/Menu is ever instantiated here. This file instead reproduces
 * showStandaloneComplexBlockMenu's exact decision sequence:
 *
 *   resolve target ComplexBlockInfo by id (from a fresh complexScan) ->
 *   evaluateStandaloneComplexBlockMovability("up") / ("down") -> (iff
 *   eligible) show that direction's item.
 *
 * Real menu-item appearance, Notice() calls, and the actual DOM
 * contextmenu dispatch are NOT exercised here and require manual real-
 * device verification instead — same precedent as every other
 * *UiWiring.test.ts file in this suite.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { evaluateStandaloneComplexBlockMovability, matchCompositeBlocks } from "../src/parser/compositeBlocks";
import { CompositeBlockRule, DEFAULT_COMPOSITE_BLOCK_RULES } from "../src/model/compositeBlock";
import { ComplexBlockInfo, ComplexBlockScanResult } from "../src/model/complexBlock";
import { buildStandaloneComplexBlockSnapshot } from "../src/edit/moveStandaloneComplexBlock";
import { createTranslator } from "../src/i18n";

function pipeline(text: string, rules: CompositeBlockRule[] = DEFAULT_COMPOSITE_BLOCK_RULES) {
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const composites = matchCompositeBlocks(doc, complexScan, rules);
  return { doc, complexScan, composites };
}

function calloutOrBlockquoteOf(
  complexScan: ComplexBlockScanResult,
  needle: string,
  doc: ReturnType<typeof parseDocument>
): ComplexBlockInfo {
  const found = complexScan.blocks.find(
    (b) => (b.kind === "callout" || b.kind === "blockquote") && doc.lines[b.range.startLine].includes(needle)
  );
  if (!found) throw new Error(`no callout/blockquote matching "${needle}"`);
  return found;
}

/** Reproduces showStandaloneComplexBlockMenu's exact decision: does the move-up/move-down item appear for this block? */
function wouldShowStandaloneMoveMenuItem(
  doc: ReturnType<typeof parseDocument>,
  complexScan: ComplexBlockScanResult,
  target: ComplexBlockInfo,
  direction: "up" | "down",
  composites: ReturnType<typeof matchCompositeBlocks>
): boolean {
  return evaluateStandaloneComplexBlockMovability(doc, complexScan, target, direction, composites).eligible;
}

describe("showStandaloneComplexBlockMenu's move-item gate: eligible standalone blocks", () => {
  it("two standalone callouts adjacent via a blank line: move-down (first) and move-up (second) both gate true", () => {
    const text = ["# H", "> [!note] one", "> body a", "", "> [!tip] two", "> body b"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    const two = calloutOrBlockquoteOf(complexScan, "two", doc);
    expect(wouldShowStandaloneMoveMenuItem(doc, complexScan, one, "down", composites)).toBe(true);
    expect(wouldShowStandaloneMoveMenuItem(doc, complexScan, two, "up", composites)).toBe(true);
  });
});

describe("showStandaloneComplexBlockMenu's move-item gate: absent when ineligible", () => {
  it("first/last block in the document: both directions gate false at the respective edge", () => {
    const text = ["# H", "> [!note] one", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    expect(wouldShowStandaloneMoveMenuItem(doc, complexScan, one, "up", composites)).toBe(false);
    expect(wouldShowStandaloneMoveMenuItem(doc, complexScan, one, "down", composites)).toBe(false);
  });

  it("nested-in-list: gates false", () => {
    const text = ["# H", "- item", "  > [!note] nested", "  > body", "", "> [!tip] two"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const nested = calloutOrBlockquoteOf(complexScan, "nested", doc);
    expect(wouldShowStandaloneMoveMenuItem(doc, complexScan, nested, "down", composites)).toBe(false);
  });

  it("composite member: gates false", () => {
    const text = ["- ![[scan.png]]", "> [!ocr]", "> body", "", "> [!tip] standalone"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    expect(composites).toHaveLength(1);
    const memberInfo = complexScan.blocks.find((b) => b.id === composites[0].members[1].id)!;
    expect(wouldShowStandaloneMoveMenuItem(doc, complexScan, memberInfo, "down", composites)).toBe(false);
  });

  it("ADDENDUM (2026-09-24): adjacent content is a plain (top-level) list item: gates true — Move now matches D&D's own broader adjacency", () => {
    const text = ["# H", "> [!note] one", "> body", "", "- a list item"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    expect(wouldShowStandaloneMoveMenuItem(doc, complexScan, one, "down", composites)).toBe(true);
  });

  it("section boundary crossing: gates false", () => {
    const text = ["# A", "> [!note] one", "> body", "# B"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    expect(wouldShowStandaloneMoveMenuItem(doc, complexScan, one, "down", composites)).toBe(false);
  });
});

describe("showStandaloneComplexBlockMenu: 'Open in Partial Edit' is unconditional; the menu is never fully suppressed", () => {
  it("a block with no eligible move in either direction still yields a buildable snapshot (Partial Edit item is always shown regardless of move eligibility)", () => {
    const text = ["# H", "> [!note] one", "> body"].join("\n");
    const { doc, complexScan, composites } = pipeline(text);
    const one = calloutOrBlockquoteOf(complexScan, "one", doc);
    // Both directions ineligible (only block in its section)...
    expect(wouldShowStandaloneMoveMenuItem(doc, complexScan, one, "up", composites)).toBe(false);
    expect(wouldShowStandaloneMoveMenuItem(doc, complexScan, one, "down", composites)).toBe(false);
    // ...yet the block itself is still perfectly snapshot-able/openable —
    // showStandaloneComplexBlockMenu's own "Open in Partial Edit" item has
    // no eligibility gate of its own and is added before either move check
    // runs, so this asymmetry with showCompositeCommandMenu's "suppress
    // the whole menu when nothing is available" behavior is intentional
    // (Phase 5C-3 approval: "Partial Edit しか出ない状態は正常").
    expect(buildStandaloneComplexBlockSnapshot(one)).not.toBeNull();
  });
});

describe("i18n: standalone move menu item keys, en + ja", () => {
  it("tree.menu.standaloneMoveUp / standaloneMoveDown exist and differ per locale from each other", () => {
    const en = createTranslator("en");
    const ja = createTranslator("ja");
    expect(en("tree.menu.standaloneMoveUp").length).toBeGreaterThan(0);
    expect(en("tree.menu.standaloneMoveDown").length).toBeGreaterThan(0);
    expect(ja("tree.menu.standaloneMoveUp").length).toBeGreaterThan(0);
    expect(ja("tree.menu.standaloneMoveDown").length).toBeGreaterThan(0);
    expect(en("tree.menu.standaloneMoveUp")).not.toBe(en("tree.menu.standaloneMoveDown"));
  });

  it("does not reuse tree.menu.compositeMoveUp/Down's own text values (composite-specific 'extended block' wording)", () => {
    const en = createTranslator("en");
    expect(en("tree.menu.standaloneMoveUp")).not.toBe(en("tree.menu.compositeMoveUp"));
    expect(en("tree.menu.standaloneMoveDown")).not.toBe(en("tree.menu.compositeMoveDown"));
  });
});

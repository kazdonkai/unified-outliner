/**
 * Phase 5L-12 ("Partial Edit Session Consolidation and External Document
 * Reconciliation"): real-pipeline, Obsidian-free behavioral tests for
 * edit/standaloneProjectionResolver.ts's own resolveStandaloneListProjections
 * — the single, shared implementation of the five-tier standalone-list-item
 * projection priority chain (list-marker-free > task-list-marker-free >
 * ordered-list-marker-free > multi-line-leaf > parent-list-item) every one
 * of view/PartialEditView.ts's own load/reload/post-Apply-rebuild call
 * sites now delegates to.
 *
 * Mirrors tests/parentChildAddDelete.test.ts's own house style: every
 * fixture goes through the REAL parser (parser/parseDocument.ts), never a
 * hand-built ListBlockNode literal. This file exists specifically so the
 * five-tier priority/mutual-exclusivity contract, and — most importantly —
 * the two genuine parent<->leaf transition scenarios this phase's own
 * investigation found (deleting/outdenting a parent's LAST remaining
 * child, and Mode-B-adding a leaf's FIRST child), can be exercised with a
 * real parseDocument-backed ParsedDocument rather than only through the
 * static-source-text "*UiWiring.test.ts" convention (which cannot
 * construct PartialEditView itself — see that convention's own doc
 * comments for why).
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { isListNode, ListBlockNode } from "../src/model/block";
import { resolveStandaloneListProjections } from "../src/edit/standaloneProjectionResolver";
import { extractSubtreeText } from "../src/edit/partialEdit";

function nodeAndRawText(raw: string, nodeId = "li-0") {
  const doc = parseDocument(raw);
  const node = doc.nodes.get(nodeId) as ListBlockNode;
  expect(node).toBeDefined();
  expect(isListNode(node)).toBe(true);
  const extracted = extractSubtreeText(doc, nodeId);
  expect(extracted.ok).toBe(true);
  const rawText = extracted.ok ? extracted.text : "";
  return { doc, node, rawText };
}

describe("resolveStandaloneListProjections — five-tier priority chain, each tier alone", () => {
  it("tier 1: a plain unordered single-line leaf resolves to `list` alone", () => {
    const { doc, node, rawText } = nodeAndRawText("- 買い物に行く");
    const result = resolveStandaloneListProjections(doc, node, rawText);
    expect(result.list).not.toBeNull();
    expect(result.task).toBeNull();
    expect(result.ordered).toBeNull();
    expect(result.multiLine).toBeNull();
    expect(result.parent).toBeNull();
  });

  it("tier 2: a task-list single-line leaf resolves to `task` alone (buildListMarkerProjection's own \"task-list-marker\" refusal dispatch)", () => {
    const { doc, node, rawText } = nodeAndRawText("- [ ] 買い物に行く");
    const result = resolveStandaloneListProjections(doc, node, rawText);
    expect(result.list).toBeNull();
    expect(result.task).not.toBeNull();
    expect(result.ordered).toBeNull();
    expect(result.multiLine).toBeNull();
    expect(result.parent).toBeNull();
  });

  it("tier 3: an ordered single-line leaf resolves to `ordered` alone (buildListMarkerProjection's own \"ordered-marker\" refusal dispatch)", () => {
    const { doc, node, rawText } = nodeAndRawText("1. 買い物に行く");
    const result = resolveStandaloneListProjections(doc, node, rawText);
    expect(result.list).toBeNull();
    expect(result.task).toBeNull();
    expect(result.ordered).not.toBeNull();
    expect(result.multiLine).toBeNull();
    expect(result.parent).toBeNull();
  });

  it("tier 4: a multi-line unordered leaf (one continuation line, no complex block) resolves to `multiLine` alone — only attempted once all three single-line tiers refuse", () => {
    const raw = ["- 一行目", "  二行目"].join("\n");
    const { doc, node, rawText } = nodeAndRawText(raw);
    const result = resolveStandaloneListProjections(doc, node, rawText);
    expect(result.list).toBeNull();
    expect(result.task).toBeNull();
    expect(result.ordered).toBeNull();
    expect(result.multiLine).not.toBeNull();
    expect(result.parent).toBeNull();
  });

  it("tier 5: a node with one or more children resolves to `parent` alone — only attempted once all four leaf tiers refuse (they all require childIds.length === 0 by construction)", () => {
    const raw = ["- 親", "  - 子"].join("\n");
    const { doc, node, rawText } = nodeAndRawText(raw);
    expect(node.childIds.length).toBe(1);
    const result = resolveStandaloneListProjections(doc, node, rawText);
    expect(result.list).toBeNull();
    expect(result.task).toBeNull();
    expect(result.ordered).toBeNull();
    expect(result.multiLine).toBeNull();
    expect(result.parent).not.toBeNull();
  });

  it("node === undefined returns every field null — never throws, never guesses", () => {
    const doc = parseDocument("- 買い物に行く");
    const result = resolveStandaloneListProjections(doc, undefined, "- 買い物に行く");
    expect(result).toEqual({ list: null, task: null, ordered: null, multiLine: null, parent: null });
  });

  it("a non-list node (a heading section — the model's own other BlockNode kind) returns every field null — this resolver only ever applies to list items; a plain paragraph/blockquote never gets a node at all in this document model, so node === undefined (covered above) is that case in practice", () => {
    const doc = parseDocument("# 見出し");
    const node = doc.nodes.get("sec-0");
    expect(node).toBeDefined();
    expect(node && isListNode(node)).toBe(false);
    const result = resolveStandaloneListProjections(doc, node, "# 見出し");
    expect(result).toEqual({ list: null, task: null, ordered: null, multiLine: null, parent: null });
  });
});

describe("resolveStandaloneListProjections — mutual exclusivity (real-device bug class this phase's own investigation and Phase 5L-9b both found)", () => {
  it("at most one of the five fields is ever non-null, across every fixture in the tier-priority describe block above", () => {
    const fixtures = [
      "- 買い物に行く",
      "- [ ] 買い物に行く",
      "1. 買い物に行く",
      ["- 一行目", "  二行目"].join("\n"),
      ["- 親", "  - 子"].join("\n"),
    ];
    for (const raw of fixtures) {
      const { doc, node, rawText } = nodeAndRawText(raw);
      const result = resolveStandaloneListProjections(doc, node, rawText);
      const nonNullCount = [result.list, result.task, result.ordered, result.multiLine, result.parent].filter(
        (v) => v !== null
      ).length;
      expect(nonNullCount).toBeLessThanOrEqual(1);
    }
  });
});

describe("resolveStandaloneListProjections — the exact parent->leaf transition regression this phase's own investigation found (applyParentChildAddDeleteCombinedEdit's delete-last-child path, which previously left the pane stranded in a stale \"neither parent nor leaf\" state; applyParentChildIndentOutdentEdit's own indent/outdent paths can never zero out this node's own childIds by construction -- see that method's own doc comment -- but share the SAME resolver, so the identical property holds for them too)", () => {
  it("unordered: a parent whose ONLY child is removed (simulated here as the post-deletion document — exactly what applyParentChildAddDeleteToDocument's own already-tested \"deleting the last remaining child leaves childIds empty\" outcome re-parses to) resolves back to a plain `list` leaf projection, never staying stuck on `parent`", () => {
    // Before this phase, the View-layer's own narrow `stillEligible`
    // rebuild at this exact call site never re-considered the four leaf
    // tiers once a node had been a real parent — this is the pure-logic
    // half of the regression: resolveStandaloneListProjections itself
    // (unlike the OLD narrow rebuild) has no notion of "was previously a
    // parent" at all, so it can never get this wrong by construction.
    const postDeletionRaw = "- 親タスク（編集済み）";
    const { doc, node, rawText } = nodeAndRawText(postDeletionRaw);
    expect(node.childIds.length).toBe(0);
    const result = resolveStandaloneListProjections(doc, node, rawText);
    expect(result.parent).toBeNull();
    expect(result.list).not.toBeNull();
  });

  it("task: a task-list parent whose only child is removed resolves back to a `task` leaf projection", () => {
    const postDeletionRaw = "- [ ] 親タスク";
    const { doc, node, rawText } = nodeAndRawText(postDeletionRaw);
    expect(node.childIds.length).toBe(0);
    const result = resolveStandaloneListProjections(doc, node, rawText);
    expect(result.parent).toBeNull();
    expect(result.task).not.toBeNull();
  });

  it("ordered: an ordered parent whose only child is removed resolves back to an `ordered` leaf projection", () => {
    const postDeletionRaw = "1. 親タスク";
    const { doc, node, rawText } = nodeAndRawText(postDeletionRaw);
    expect(node.childIds.length).toBe(0);
    const result = resolveStandaloneListProjections(doc, node, rawText);
    expect(result.parent).toBeNull();
    expect(result.ordered).not.toBeNull();
  });

  it("multi-line: a multi-line-own-text parent whose only child is removed resolves back to a `multiLine` leaf projection", () => {
    const postDeletionRaw = ["- 親タスク", "  続き"].join("\n");
    const { doc, node, rawText } = nodeAndRawText(postDeletionRaw);
    expect(node.childIds.length).toBe(0);
    const result = resolveStandaloneListProjections(doc, node, rawText);
    expect(result.parent).toBeNull();
    expect(result.multiLine).not.toBeNull();
  });

  it("the reverse transition: a genuine childless leaf that GAINS its first child (simulated as the post-Mode-B-Apply document) resolves to `parent`, never staying stuck on a leaf tier", () => {
    const postAdditionRaw = ["- 親タスク", "  - 新しい子"].join("\n");
    const { doc, node, rawText } = nodeAndRawText(postAdditionRaw);
    expect(node.childIds.length).toBe(1);
    const result = resolveStandaloneListProjections(doc, node, rawText);
    expect(result.list).toBeNull();
    expect(result.parent).not.toBeNull();
  });
});

/**
 * v1.0.4 (Tree + Partial Edit phase): Outline Tree projection of the
 * "List item + Paragraph" CompositeBlock rule — pure buildOutlineTree /
 * foldIdentity / resolveCurrentPositionNodeId level.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "../src/parser/parseDocument";
import { scanComplexBlocks } from "../src/parser/complexBlocks";
import { matchCompositeBlocks } from "../src/parser/compositeBlocks";
import {
  BUILTIN_COMPOSITE_BLOCK_RULES,
  CompositeBlockRule,
  DEFAULT_COMPOSITE_BLOCK_RULES,
} from "../src/model/compositeBlock";
import {
  buildOutlineTree,
  collectReadOnlyOutlineNodeIds,
  flattenOutlineTree,
  isOutlineComplexMemberNode,
  isOutlineCompositeNode,
  OutlineTreeNode,
  PARAGRAPH_MEMBER_PREFIX,
} from "../src/tree/buildOutlineTree";
import { buildNodeIdentityMap } from "../src/tree/foldIdentity";
import { buildNodeByIdMap } from "../src/tree/outlineNavigation";
import { resolveCurrentPositionNodeId } from "../src/tree/resolveCurrentPositionNodeId";
import { createTranslator } from "../src/i18n";

function build(text: string, opts: { rules?: CompositeBlockRule[]; paragraphs?: boolean; ja?: boolean } = {}) {
  const rules = opts.rules ?? BUILTIN_COMPOSITE_BLOCK_RULES;
  const doc = parseDocument(text);
  const complexScan = scanComplexBlocks(doc);
  const infos = matchCompositeBlocks(doc, complexScan, rules);
  const tree = buildOutlineTree(doc, {
    includeLists: true,
    composites: { infos, complexBlocksById: new Map(complexScan.blocks.map((b) => [b.id, b])), rules },
    ...(opts.paragraphs ? { paragraphs: { blocks: complexScan.blocks } } : {}),
    ...(opts.ja ? { t: createTranslator("ja") } : {}),
  });
  return { doc, complexScan, infos, tree, flat: flattenOutlineTree(tree) };
}

const composites = (flat: OutlineTreeNode[]) => flat.filter(isOutlineCompositeNode);

describe("Outline Tree: List item + Paragraph composite row", () => {
  const text = ["# H", "- 史料A", "  村持入会地として記載。 ^lp-a"].join("\n");

  it("is projected as a composite parent row: ruleId, English label, ≡ prefix, start line, no structural ops", () => {
    for (const ja of [false, true]) {
      const { flat } = build(text, { ja });
      const [c] = composites(flat);
      expect(c.ruleId).toBe("list-paragraph");
      expect(c.label).toBe("List item + Paragraph");
      expect(c.prefix).toBe("≡");
      expect(c.line).toBe(1);
      expect(c.allowsStructuralOps).toBe(false);
    }
  });

  it("its children are the list member (the original list row) and a read-only paragraph complex-member row", () => {
    const { flat, infos } = build(text);
    const [c] = composites(flat);
    expect(c.children.map((n) => n.kind)).toEqual(["list", "complex-member"]);
    const [list, para] = c.children;
    expect(list.id).toBe(infos[0].members[0].id);
    expect(list.children).toEqual([]);
    if (!isOutlineComplexMemberNode(para)) throw new Error("expected complex-member");
    expect(para.complexKind).toBe("paragraph");
    expect(para.isStandalone).toBe(false);
    expect(para.prefix).toBe(PARAGRAPH_MEMBER_PREFIX);
    expect(para.label).toBe("村持入会地として記載。");
    expect(para.line).toBe(2);
  });

  it("the parent row and every member row are read-only", () => {
    const { tree, flat } = build(text);
    const ro = collectReadOnlyOutlineNodeIds(tree);
    const [c] = composites(flat);
    expect(ro.has(c.id)).toBe(true);
    for (const child of c.children) expect(ro.has(child.id)).toBe(true);
  });

  it("the paragraph is never ALSO shown as an ordinary paragraph row when paragraphs are projected", () => {
    const { flat } = build(text, { paragraphs: true });
    expect(flat.filter((n) => n.kind === "paragraph")).toHaveLength(0);
    expect(composites(flat)).toHaveLength(1);
  });

  it("image-ocr / image-quote projection is unchanged and still allows structural ops", () => {
    const t = ["- img", "> [!ocr]", "> text", "", "- src", "> quote"].join("\n");
    const a = build(t, { rules: DEFAULT_COMPOSITE_BLOCK_RULES });
    const b = build(t);
    expect(b.tree).toEqual(a.tree);
    expect(composites(b.flat).map((c) => [c.ruleId, c.label, c.prefix, c.allowsStructuralOps])).toEqual([
      ["image-ocr", "List + Callout", "◉", true],
      ["image-quote", "List + Quote", "❖", true],
    ]);
  });
});

describe("Outline Tree: paragraph member label", () => {
  it("skips a lone block-id last line", () => {
    const { flat } = build(["- item", "  first line", "  ^lp-b"].join("\n"));
    const para = composites(flat)[0].children[1];
    expect(isOutlineComplexMemberNode(para) && para.label).toBe("first line");
  });

  it("never shows the paragraph's own inline block id", () => {
    const { flat } = build(["- item", "  only line ^lp-x"].join("\n"));
    const para = composites(flat)[0].children[1];
    expect(isOutlineComplexMemberNode(para) && para.label).toBe("only line");
  });

  it("falls back to the English 'Paragraph' when no text remains (both UI languages)", () => {
    for (const ja of [false, true]) {
      const { flat } = build(["- item", "  ^only-an-id"].join("\n"), { ja });
      const [c] = composites(flat);
      expect(c).toBeDefined();
      const para = c.children[1];
      expect(isOutlineComplexMemberNode(para) && para.label).toBe("Paragraph");
    }
  });
});

describe("Outline Tree: the composite disappears naturally when its conditions break", () => {
  it("a blank line, under-indentation or a child list turns it back into ordinary list / paragraph rows", () => {
    for (const lines of [
      ["- item", "", "  para ^p"],
      ["- item", "para ^p"],
      ["- item", "  para ^p", "  - child"],
    ]) {
      const { flat } = build(lines.join("\n"), { paragraphs: true });
      expect(composites(flat)).toHaveLength(0);
      expect(flat.some((n) => n.kind === "list")).toBe(true);
      expect(flat.some((n) => n.kind === "paragraph")).toBe(true);
    }
  });

  it("is not projected (safe fallback) when its rule is not in the projection's rule list", () => {
    const doc = parseDocument(["- item", "  para"].join("\n"));
    const scan = scanComplexBlocks(doc);
    const infos = matchCompositeBlocks(doc, scan, BUILTIN_COMPOSITE_BLOCK_RULES);
    const tree = buildOutlineTree(doc, {
      includeLists: true,
      composites: { infos, complexBlocksById: new Map(scan.blocks.map((b) => [b.id, b])), rules: DEFAULT_COMPOSITE_BLOCK_RULES },
      paragraphs: { blocks: scan.blocks },
    });
    const flat = flattenOutlineTree(tree);
    expect(composites(flat)).toHaveLength(0);
    expect(flat.map((n) => n.kind)).toEqual(["list", "paragraph"]);
  });
});

describe("fold identity and cursor highlight", () => {
  it("each List item + Paragraph composite gets its own stable, non-colliding identity", () => {
    const { tree, flat } = build(["# H", "- a", "  p1", "- b", "  p2"].join("\n"));
    const map = buildNodeIdentityMap(tree);
    const ids = composites(flat).map((c) => map.get(c.id));
    expect(ids).toEqual(["section:H/composite:List item + Paragraph", "section:H/composite:List item + Paragraph#1"]);
    expect(new Set(map.values()).size).toBe(map.size);
  });

  it("a cursor on the paragraph highlights the paragraph member row; on the list line, the list member row", () => {
    const { doc, complexScan, tree, flat } = build(["# H", "- item", "  para line 1", "  para line 2"].join("\n"), {
      paragraphs: true,
    });
    const nodeById = buildNodeByIdMap(tree);
    const [c] = composites(flat);
    const [list, para] = c.children;
    expect(resolveCurrentPositionNodeId(doc, 3, complexScan, nodeById, { includeLists: true })).toBe(para.id);
    expect(resolveCurrentPositionNodeId(doc, 1, complexScan, nodeById, { includeLists: true })).toBe(list.id);
  });
});

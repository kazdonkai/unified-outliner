import type { ParsedDocument } from "../model/block";
import type { OutlineTreeNode } from "./buildOutlineTree";

/**
 * Whether a node's DOCUMENT RANGE has anything to fold — the question the
 * body fold itself asks, kept separate from the tree's own "does this row
 * have children" question.
 *
 * Until this predicate existed, the answer was simply `children.length > 0`
 * — the tree widget's structural question, "is there a subtree to hide?".
 * That is the wrong question for this plugin, because folding a tree node
 * does not only hide tree rows: `OutlineTreeView.syncFoldToBodyEditor`
 * mirrors it into the body editor's own CM6 fold state, using the
 * *document* node's line range. So a heading whose body is prose, a table
 * or a fenced code block — very common, and with no sub-heading under it —
 * has real, foldable content in the document while having no children in
 * the tree, and was left with no way to fold it from the pane even though
 * Obsidian's own fold gutter folds it happily.
 *
 * The question this asks instead is "is there anything to fold?", answered
 * from the same place the fold itself reads: the node's range in the parsed
 * document. `children.length > 0` is kept as the first branch because a
 * node with children is foldable regardless of what the document says (and
 * because list/paragraph projections may not resolve to a document node at
 * all — see below), so the previous behavior is strictly a subset of this
 * one and nothing that folded before stops folding.
 *
 * Deliberately kind-agnostic, matching `renderNode`'s own "one shared row
 * structure for sections and lists" design and `syncFoldToBodyEditor`,
 * which never checks kind either. A multi-line list item therefore also
 * becomes foldable; a single-line one does not. Paragraph and composite
 * projections carry synthetic view ids that are not keys in
 * `doc.nodes`, so the lookup misses and they stay unfoldable — which is
 * correct, since they are leaves with nothing beneath them.
 *
 * "Something to fold" means at least one non-blank line below the node's
 * own first line — slightly stricter than `syncFoldToBodyEditor`'s cheaper
 * `endLine > startLine` guard, and deliberately so. A heading followed only
 * by a blank line (very common at the end of a file) satisfies that guard
 * but has nothing worth hiding, and would otherwise get a chevron that
 * appears to do nothing when clicked. Being the stricter of the two keeps
 * the pair safe in the direction that matters: every row offering a toggle
 * has a real fold to perform, and no row is offered one the fold would
 * decline.
 */
export function hasFoldableContent(
  doc: ParsedDocument | null | undefined,
  nodeId: string
): boolean {
  if (!doc) return false;
  const blockNode = doc.nodes.get(nodeId);
  if (!blockNode) return false;
  const { startLine, endLine } = blockNode.range;
  for (let line = startLine + 1; line <= endLine && line < doc.lines.length; line++) {
    if (doc.lines[line].trim() !== "") return true;
  }
  return false;
}

/**
 * Whether a ROW should offer a fold toggle: it has a subtree to hide, or
 * its document range has something to fold.
 *
 * Kept as a separate, thin composition rather than folded into
 * hasFoldableContent above, because the two answer different questions and
 * only one of them is about the document. A node with children is foldable
 * regardless of what the document says — and must be, since list,
 * paragraph and composite projections carry synthetic view ids that are
 * not keys in `doc.nodes` at all, so the document half cannot answer for
 * them. Tree hierarchy itself stays keyed to `children`; this widens only
 * the fold affordance.
 */
export function canCollapseOutlineNode(
  node: OutlineTreeNode,
  doc: ParsedDocument | null | undefined
): boolean {
  if (node.children.length > 0) return true;
  return hasFoldableContent(doc, node.id);
}

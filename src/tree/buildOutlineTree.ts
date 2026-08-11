/**
 * Build a display-ready outline tree from a ParsedDocument. Pure function,
 * no Obsidian dependency — this is the data model behind the Outline Tree
 * View (docs/別ペイン実装計画と当面の実装指示.md §3.1).
 *
 * Phase 2A through 3B only ever built a *section*-only tree: list items were
 * intentionally left out ("Markdown 文書の見出し構造をツリーとして可視化する";
 * list subtree integration was explicitly out of scope until Phase 3C).
 *
 * Phase 3C (docs, forward-looking §Outline List Display) adds an opt-in
 * `includeLists` mode that folds root list items into the same tree as
 * sibling children of their owning section (or as top-level nodes, for
 * pre-heading root lists), with nested list items becoming children of their
 * parent list node — sections and lists share one tree, distinguished by
 * `kind`. The default (`includeLists` unset / false) is unchanged from
 * every prior phase, so existing callers that only ever wanted the heading
 * structure keep working exactly as before.
 *
 * A section's own `childIds` mixes list items and child sections, and does
 * NOT preserve their relative document order once mixed (see
 * parser/parseDocument.ts: all child *sections* are appended during pass 1,
 * then all root *list items* are appended afterward during pass 2) — so
 * this module always re-sorts by line number when includeLists is on,
 * rather than trusting childIds order directly.
 */
import {
  BlockNode,
  isListNode,
  isSectionNode,
  ListBlockNode,
  ParsedDocument,
  SectionBlockNode,
} from "../model/block";

export interface OutlineTreeSectionNode {
  kind: "section";
  /** Matches the underlying SectionBlockNode's id. */
  id: string;
  headingText: string;
  headingLevel: number;
  /** 0-based line of the heading itself (jump target). */
  line: number;
  children: OutlineTreeNode[];
}

export interface OutlineTreeListNode {
  kind: "list";
  /** Matches the underlying ListBlockNode's id. */
  id: string;
  /** Item text with leading indent and the list marker stripped. */
  text: string;
  /** List nesting depth (root list item = 0), for indent-based rendering. */
  indentDepth: number;
  /** 0-based line of the item's own first line (jump target). */
  line: number;
  children: OutlineTreeNode[];
}

export type OutlineTreeNode = OutlineTreeSectionNode | OutlineTreeListNode;

export interface BuildOutlineTreeOptions {
  /**
   * Include list items as tree nodes alongside sections. Default false,
   * matching every prior phase's section-only tree.
   */
  includeLists?: boolean;
}

export function isOutlineSectionNode(
  node: OutlineTreeNode
): node is OutlineTreeSectionNode {
  return node.kind === "section";
}

export function isOutlineListNode(
  node: OutlineTreeNode
): node is OutlineTreeListNode {
  return node.kind === "list";
}

const LIST_ITEM_TEXT_RE = /^[ \t]*(?:[-*+]|\d+[.)])(?:[ \t]+(.*))?$/;

/**
 * Item text with the leading indent and list marker stripped for display.
 * Exported so view/PartialEditView.ts (Phase 4C) can derive the same
 * short, one-line label for a list subtree's Partial Edit Pane header
 * without duplicating the marker-stripping regex.
 */
export function listItemDisplayText(doc: ParsedDocument, item: ListBlockNode): string {
  const raw = doc.lines[item.range.startLine] ?? "";
  const m = raw.match(LIST_ITEM_TEXT_RE);
  return (m?.[1] ?? raw).trim();
}

/**
 * Phase 5B: shared display label for a section or list node — the exact
 * same text view/PartialEditView.ts's pane title has used since Phase 4C
 * ("(Untitled heading)" / "(Empty list item)" fallbacks for an empty
 * heading/item — English fallback text per UI review, see git history for
 * the original Japanese strings), now extracted here so
 * tree/ancestorPath.ts's breadcrumb labels and PartialEditView's title can
 * both call one function instead of keeping two copies of the same
 * fallback rule in sync by hand. Lives alongside listItemDisplayText
 * (which it delegates to for the list case) rather than in
 * edit/partialEdit.ts or PartialEditView.ts, since both of this function's
 * callers are themselves tree-shaped: the Outline Tree's own node labels
 * and the breadcrumb's ancestor labels are the same concept.
 */
export function nodeDisplayLabel(doc: ParsedDocument, node: BlockNode): string {
  if (isSectionNode(node)) {
    return node.headingText.length > 0 ? node.headingText : "(Untitled heading)";
  }
  if (isListNode(node)) {
    const text = listItemDisplayText(doc, node);
    return text.length > 0 ? text : "(Empty list item)";
  }
  return "";
}

function buildListNode(doc: ParsedDocument, item: ListBlockNode): OutlineTreeListNode {
  const children: OutlineTreeNode[] = [];
  for (const id of item.childIds) {
    const child = doc.nodes.get(id);
    // Nested list items only — a list item never owns a section.
    if (child && isListNode(child)) children.push(buildListNode(doc, child));
  }
  return {
    kind: "list",
    id: item.id,
    text: listItemDisplayText(doc, item),
    indentDepth: item.depth,
    line: item.range.startLine,
    children,
  };
}

function buildSectionNode(
  doc: ParsedDocument,
  section: SectionBlockNode,
  includeLists: boolean
): OutlineTreeSectionNode {
  return {
    kind: "section",
    id: section.id,
    headingText: section.headingText,
    headingLevel: section.headingLevel,
    line: section.range.startLine,
    children: buildChildren(doc, section.childIds, includeLists),
  };
}

/**
 * Resolve `ids` (a section's childIds, or doc.topLevelIds) into tree nodes,
 * re-sorted by line number since childIds itself does not preserve document
 * order once sections and list items are mixed (see class doc comment).
 * Every list item reachable this way is already a root item (depth 0) by
 * construction — parseDocument.ts only ever pushes root items into a
 * section's childIds / topLevelIds; nested items live under their parent
 * item's own childIds instead (see buildListNode).
 */
function buildChildren(
  doc: ParsedDocument,
  ids: string[],
  includeLists: boolean
): OutlineTreeNode[] {
  const withLine: Array<{ node: OutlineTreeNode; line: number }> = [];
  for (const id of ids) {
    const child = doc.nodes.get(id);
    if (!child) continue;
    if (isSectionNode(child)) {
      withLine.push({
        node: buildSectionNode(doc, child, includeLists),
        line: child.range.startLine,
      });
    } else if (includeLists && isListNode(child)) {
      withLine.push({
        node: buildListNode(doc, child),
        line: child.range.startLine,
      });
    }
  }
  withLine.sort((a, b) => a.line - b.line);
  return withLine.map((x) => x.node);
}

/**
 * Top-level tree nodes, in document order. `doc.topLevelIds` mixes
 * pre-heading root list items with top-level sections; with `includeLists`
 * off (default) this filters to sections only, exactly like every prior
 * phase.
 */
export function buildOutlineTree(
  doc: ParsedDocument,
  options?: BuildOutlineTreeOptions
): OutlineTreeNode[] {
  return buildChildren(doc, doc.topLevelIds, options?.includeLists ?? false);
}

/** Flatten a tree back into a list, depth-first, document order. */
export function flattenOutlineTree(tree: OutlineTreeNode[]): OutlineTreeNode[] {
  const out: OutlineTreeNode[] = [];
  const walk = (nodes: OutlineTreeNode[]) => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

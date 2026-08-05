/**
 * Core data model for Unified Outliner.
 * All types here are UI-free and safe to use from pure functions / unit tests.
 */

export type BlockNodeType = "list" | "section";

/** Inclusive line range (0-based). */
export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface BaseBlockNode {
  id: string;
  type: BlockNodeType;
  range: LineRange;
  /** Parent node id. For a root list item this is the owning section id (or null). */
  parentId: string | null;
  /** Previous sibling of the same kind (section↔section, list↔list). */
  prevSiblingId: string | null;
  nextSiblingId: string | null;
  childIds: string[];
  /** Section: heading nesting depth. List: list nesting depth (root = 0). */
  depth: number;
}

export interface ListBlockNode extends BaseBlockNode {
  type: "list";
  /** Raw marker, e.g. "-", "*", "+", "3.", "2)". */
  listMarker: string;
  /** Visual indent columns of the marker (tab = 4). */
  indentColumns: number;
  /** True when the item's leading whitespace mixes tabs and spaces. */
  unsafeIndent: boolean;
  /** True for ordered ("1." / "1)") markers. */
  ordered: boolean;
}

/**
 * A SectionBlockNode is NOT "the heading line" — it is the whole *section
 * subtree*: heading + body + nested subsections + root lists. The heading is
 * merely the label that represents the subtree; moving a section always moves
 * the entire range.
 */
export interface SectionBlockNode extends BaseBlockNode {
  type: "section";
  headingLevel: number;
  headingText: string;
}

export type BlockNode = ListBlockNode | SectionBlockNode;

export interface ParsedDocument {
  lines: string[];
  nodes: Map<string, BlockNode>;
  /** Ids of nodes without a parent node (top-level sections, pre-heading root lists). */
  topLevelIds: string[];
  /** For each line: id of the deepest owning node, or null. */
  lineToOwningNodeId: (string | null)[];
  /** True for lines inside fenced code blocks (fence lines included). */
  codeBlockLines: boolean[];
  /** True for YAML frontmatter lines. */
  frontmatterLines: boolean[];
}

export function isListNode(node: BlockNode): node is ListBlockNode {
  return node.type === "list";
}

export function isSectionNode(node: BlockNode): node is SectionBlockNode {
  return node.type === "section";
}

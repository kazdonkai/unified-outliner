/**
 * Resolve the node id that a cursor line should highlight in the Outline
 * Tree View. Pure function, no Obsidian dependency.
 *
 * Reuses resolver/resolveCurrentBlock.ts (same resolution every other
 * command uses).
 *
 * Phase 2A–3B: the tree only ever contained sections (see
 * buildOutlineTree.ts's default), so a cursor inside a list item resolved
 * to that item's *owning section* — the deepest node actually in the tree.
 * `resolveHighlightedSectionId` keeps exactly that behavior and is
 * unchanged, since it's still what every section-only tree needs.
 *
 * Phase 3C adds `resolveHighlightedNodeId`, used when the tree also
 * includes list nodes (buildOutlineTree's includeLists: true — see
 * settings.showListItemsInOutline): a cursor inside a list item highlights
 * that list item itself, since it's now actually present in the tree.
 * Falls back to walking up to the owning section when includeLists is off,
 * so it is a strict superset of the older function's behavior (in fact
 * `resolveHighlightedSectionId` is now implemented in terms of it).
 *
 * Both return null for frontmatter / code-fence / no resolvable block —
 * same safe-by-default behavior as the body-editor commands (docs §2.1:
 * never guess).
 */
import { BlockNode, ParsedDocument } from "../model/block";
import { resolveCurrentBlock } from "../resolver/resolveCurrentBlock";

export interface ResolveHighlightedNodeOptions {
  /** When true, a list item resolves to itself rather than its owning section. */
  includeLists?: boolean;
}

export function resolveHighlightedNodeId(
  doc: ParsedDocument,
  cursorLine: number,
  options?: ResolveHighlightedNodeOptions
): string | null {
  const resolved = resolveCurrentBlock(doc, cursorLine);
  let node: BlockNode | null = resolved.node;

  if (!options?.includeLists) {
    while (node && node.type !== "section") {
      node = node.parentId ? doc.nodes.get(node.parentId) ?? null : null;
    }
  }

  return node ? node.id : null;
}

export function resolveHighlightedSectionId(
  doc: ParsedDocument,
  cursorLine: number
): string | null {
  return resolveHighlightedNodeId(doc, cursorLine, { includeLists: false });
}

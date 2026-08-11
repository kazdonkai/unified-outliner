/**
 * Subtree Navigator (子孫ナビゲータ): the downward counterpart to
 * tree/ancestorPath.ts's breadcrumb. Where findAncestorPath walks a node
 * UP to the document root, this module walks a node's own childIds DOWN
 * one level, so the Partial Edit Pane can offer "descend into this child"
 * navigation alongside the existing "climb to this ancestor" breadcrumb.
 *
 * Deliberately a separate module and a separate function, not an addition
 * to ancestorPath.ts: ancestor and descendant traversal are different
 * shapes of problem (one linear walk up via parentId; one single-level
 * fan-out via childIds), and keeping them in distinct files matches how
 * the rest of this plugin already separates concerns (move/ vs level/ vs
 * tree/ — see those directories' own doc comments).
 *
 * Only the direct-children query is implemented for the initial UI (a
 * step-by-step "descend one level at a time" navigator, re-computed fresh
 * every time PartialEditView loads a new node — see that file's
 * loadNodeInternal). A full preorder descendant walk was intentionally
 * NOT added here: nothing in the current UI needs it, and adding an
 * unused API only invites drift. If a future hierarchical/searchable
 * Subtree Navigator needs the whole descendant list, add a
 * findDescendantEntries(doc, nodeId) alongside this function then — the
 * DescendantNavigationEntry shape below (id/kind/label/depth/hasChildren)
 * is already general enough to serve both a flat direct-children list
 * (depth always 1) and a future preorder walk (depth growing with nesting)
 * without changing its fields.
 */
import { BlockNode, ParsedDocument } from "../model/block";
import { defaultTranslator, Translator } from "../i18n";
import { nodeDisplayLabel } from "./buildOutlineTree";

export interface DescendantNavigationEntry {
  id: string;
  kind: "section" | "list";
  label: string;
  /** Nesting depth relative to the queried node (a direct child is always 1). */
  depth: number;
  /** True when this entry itself owns at least one child (section or list). */
  hasChildren: boolean;
}

/**
 * The direct children of `nodeId`, in document order (line order) — a
 * section's own `childIds` mixes child sections (appended during
 * parser/parseDocument.ts's pass 1) with root list items (appended during
 * pass 2) and does NOT preserve their relative document order, exactly the
 * same caveat tree/buildOutlineTree.ts's buildChildren already documents,
 * so this function re-sorts by each child's own range.startLine rather
 * than trusting childIds order directly. A list item's childIds are always
 * other list items already in document order (a list item never owns a
 * section — see parser/parseDocument.ts), so the sort is a no-op there,
 * but running it unconditionally keeps this function's guarantee ("always
 * document order") uniform across both node kinds instead of being
 * conditionally true.
 *
 * Safe by construction rather than by exception handling, matching this
 * plugin's existing policy (see findAncestorPath's own doc comment for the
 * same rationale): an unresolvable `nodeId` returns an empty array, a
 * dangling `childId` that no longer resolves to a node is skipped rather
 * than throwing, and a `childId` repeated more than once in `childIds`
 * (which parser/parseDocument.ts should never produce, but this function
 * does not trust that) is only ever included once.
 */
export function findDirectChildren(
  doc: ParsedDocument,
  nodeId: string,
  t: Translator = defaultTranslator
): DescendantNavigationEntry[] {
  const node = doc.nodes.get(nodeId);
  if (!node) return [];

  const seen = new Set<string>();
  const withLine: Array<{ entry: DescendantNavigationEntry; line: number }> = [];

  for (const childId of node.childIds) {
    if (seen.has(childId)) continue;
    seen.add(childId);
    const child: BlockNode | undefined = doc.nodes.get(childId);
    if (!child) continue;
    withLine.push({
      entry: {
        id: child.id,
        kind: child.type,
        label: nodeDisplayLabel(doc, child, t),
        depth: 1,
        hasChildren: child.childIds.length > 0,
      },
      line: child.range.startLine,
    });
  }

  withLine.sort((a, b) => a.line - b.line);
  return withLine.map((x) => x.entry);
}

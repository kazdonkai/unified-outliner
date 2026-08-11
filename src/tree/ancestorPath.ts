/**
 * Phase 5B: ancestor path for the Partial Edit Pane's breadcrumb
 * (docs/phase5-implementation-plan.md, Phase 5B item 1 —
 * "section/list node から root までの祖先経路を返す Obsidian 非依存の純粋関数").
 *
 * Pure, Obsidian-free walk of BlockNode.parentId from a node up to the
 * document root. Section and list ancestors are both walked through the
 * exact same `parentId` chain — a root list item's parentId already points
 * at its owning section id, and a nested list item's parentId points at
 * its parent list item, and a section's parentId points at its own parent
 * section or null (see parser/parseDocument.ts) — so this function needs
 * no per-kind branching at all.
 */
import { BlockNode, ParsedDocument } from "../model/block";
import { defaultTranslator, Translator } from "../i18n";
import { nodeDisplayLabel } from "./buildOutlineTree";

export interface AncestorPathEntry {
  id: string;
  kind: "section" | "list";
  label: string;
}

/**
 * Ancestors of `nodeId`, ordered root-first (the ancestor nearest the
 * document root at index 0, the node's immediate parent last). `nodeId`
 * itself is never included — callers that also want a trailing "current
 * node" breadcrumb segment derive it separately via nodeDisplayLabel,
 * exactly like PartialEditView already does for its own title.
 *
 * Safe by construction rather than by exception handling, matching this
 * plugin's existing "no-op / partial result over throwing" policy
 * (../move/, ../edit/partialEdit.ts): an unresolvable `nodeId` returns an
 * empty array, and a broken or cyclic `parentId` chain — which
 * parser/parseDocument.ts should never produce, but this function does not
 * trust that assumption — simply stops walking and returns whatever
 * ancestors were already collected. It never throws.
 */
export function findAncestorPath(
  doc: ParsedDocument,
  nodeId: string,
  t: Translator = defaultTranslator
): AncestorPathEntry[] {
  const start = doc.nodes.get(nodeId);
  if (!start) return [];

  const ancestors: AncestorPathEntry[] = [];
  const visited = new Set<string>([start.id]);

  let current: BlockNode | undefined = start;
  while (current?.parentId) {
    const parent = doc.nodes.get(current.parentId);
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);
    ancestors.push({
      id: parent.id,
      kind: parent.type,
      label: nodeDisplayLabel(doc, parent, t),
    });
    current = parent;
  }

  return ancestors.reverse();
}

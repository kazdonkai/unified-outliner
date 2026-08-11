/**
 * Sibling前後移動 (docs/phase5b_sibling-navigation-spec.md): the sideways
 * counterpart to tree/ancestorPath.ts (climb up) and tree/descendantPath.ts
 * (descend into a child). Where those two modules walk `parentId` and
 * `childIds` respectively, this module resolves a node's previous/next
 * sibling directly from the `prevSiblingId` / `nextSiblingId` fields
 * `parser/parseDocument.ts` already populates on every `BlockNode` — see
 * that parser's own sibling-linking passes (section pass and list pass,
 * each walking back through the same parent's existing children/topLevelIds
 * to find the nearest same-kind sibling).
 *
 * Deliberately does NOT rebuild or re-sort a parent's child array the way
 * tree/descendantPath.ts's findDirectChildren does: sibling order is
 * already the single source of truth in `prevSiblingId` / `nextSiblingId`
 * themselves (spec §2, §6 — "並び順の source of truth は block tree / node
 * index 側に一元化し、UI ごとに前後関係を再計算しない"), so this module only
 * ever follows those two pointers one hop at a time. No new sibling-order
 * computation is introduced here.
 *
 * View shape kept intentionally minimal (spec §7's `NavigationNode` /
 * `ProjectionTarget` concept, narrowed down here to just what
 * PartialEditView's sibling nav buttons actually need — nodeId to pass to
 * requestLoadNode, and displayLabel for the tooltip): no `kind` field, no
 * `ProjectionRequest`/`ProjectionNavigationSource` machinery. See the spec
 * document's own §7 "実装上の注記" for why the fuller, kind-agnostic shape
 * described there is left as a future option rather than built now.
 */
import { BlockNode, ParsedDocument } from "../model/block";
import { defaultTranslator, Translator } from "../i18n";
import { nodeDisplayLabel } from "./buildOutlineTree";

export interface SiblingNavigationTarget {
  nodeId: string;
  displayLabel: string;
}

export interface SiblingNavigationState {
  previous: SiblingNavigationTarget | null;
  next: SiblingNavigationTarget | null;
}

/**
 * Resolves a raw sibling id (already read from `prevSiblingId` /
 * `nextSiblingId`) into a navigation target. Safe by construction, matching
 * findAncestorPath / findDirectChildren's own policy: a missing id (null,
 * the common "no sibling in that direction" case) or a dangling id that no
 * longer resolves to a node (which parser/parseDocument.ts should never
 * produce, but this function does not trust that) both simply return null.
 * Never throws.
 */
function resolveSibling(
  doc: ParsedDocument,
  siblingId: string | null,
  t: Translator
): SiblingNavigationTarget | null {
  if (!siblingId) return null;
  const sibling: BlockNode | undefined = doc.nodes.get(siblingId);
  if (!sibling) return null;
  return { nodeId: sibling.id, displayLabel: nodeDisplayLabel(doc, sibling, t) };
}

/** The previous sibling of `nodeId` (same `parentId`, same kind), or null if there is none or `nodeId` itself does not resolve. */
export function getPreviousSibling(
  doc: ParsedDocument,
  nodeId: string,
  t: Translator = defaultTranslator
): SiblingNavigationTarget | null {
  const node = doc.nodes.get(nodeId);
  if (!node) return null;
  return resolveSibling(doc, node.prevSiblingId, t);
}

/** The next sibling of `nodeId` (same `parentId`, same kind), or null if there is none or `nodeId` itself does not resolve. */
export function getNextSibling(
  doc: ParsedDocument,
  nodeId: string,
  t: Translator = defaultTranslator
): SiblingNavigationTarget | null {
  const node = doc.nodes.get(nodeId);
  if (!node) return null;
  return resolveSibling(doc, node.nextSiblingId, t);
}

/**
 * Both directions in one call — what PartialEditView's loadNodeInternal
 * actually wants, computed once per load exactly like `ancestors` and
 * `directChildren` already are (see that method's own doc comment).
 */
export function getSiblingNavigationState(
  doc: ParsedDocument,
  nodeId: string,
  t: Translator = defaultTranslator
): SiblingNavigationState {
  return {
    previous: getPreviousSibling(doc, nodeId, t),
    next: getNextSibling(doc, nodeId, t),
  };
}

/**
 * Pure keyboard-navigation helpers for the Outline Tree View sidebar.
 *
 * This is a DIFFERENT concept from tree/resolveHighlightedSectionId.ts:
 * that module resolves which node the BODY EDITOR's cursor currently sits
 * inside (the "current" row, styled via .unified-outliner-current). This
 * module instead supports moving a KEYBOARD SELECTION around the sidebar
 * itself — Up/Down/Left/Right/Enter operating on the tree as displayed,
 * independent of where the body editor's cursor happens to be. The two
 * states can disagree (e.g. the user arrows around the sidebar without
 * pressing Enter) and OutlineTreeView.ts renders them with distinct CSS
 * classes (.unified-outliner-current vs .unified-outliner-selected) for
 * exactly that reason.
 *
 * Every function here is a plain function over OutlineTreeNode[] / Set /
 * Map — no Obsidian dependency, no DOM — matching every other pure module
 * under src/tree, src/move, src/level, src/resolver.
 */
import { OutlineTreeNode } from "./buildOutlineTree";

/**
 * Depth-first, document-order list of the nodes that are actually ON
 * SCREEN right now: children of a node in `collapsedIds` are skipped,
 * mirroring exactly what OutlineTreeView.renderNode does (it only creates
 * a .tree-item-children container when a node has children AND is not
 * collapsed). Up/Down navigation must walk this list, not the full tree,
 * so arrowing past a collapsed node skips its hidden children instead of
 * silently selecting something invisible.
 */
export function flattenVisibleOutlineTree(
  tree: OutlineTreeNode[],
  collapsedIds: ReadonlySet<string>
): OutlineTreeNode[] {
  const out: OutlineTreeNode[] = [];
  const walk = (nodes: OutlineTreeNode[]) => {
    for (const node of nodes) {
      out.push(node);
      if (!collapsedIds.has(node.id)) walk(node.children);
    }
  };
  walk(tree);
  return out;
}

/** Every node in the tree, keyed by id, regardless of fold state. */
export function buildNodeByIdMap(
  tree: OutlineTreeNode[]
): Map<string, OutlineTreeNode> {
  const map = new Map<string, OutlineTreeNode>();
  const walk = (nodes: OutlineTreeNode[]) => {
    for (const node of nodes) {
      map.set(node.id, node);
      walk(node.children);
    }
  };
  walk(tree);
  return map;
}

/** Every node's parent id (null for top-level nodes), regardless of fold state. */
export function buildParentIdMap(
  tree: OutlineTreeNode[]
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  const walk = (nodes: OutlineTreeNode[], parentId: string | null) => {
    for (const node of nodes) {
      map.set(node.id, parentId);
      walk(node.children, node.id);
    }
  };
  walk(tree, null);
  return map;
}

/**
 * The id Down-arrow should select next. `null` currentId (nothing selected
 * yet) or a currentId no longer present in `visible` (e.g. it just got
 * collapsed away) both resolve to the first visible node, same as a fresh
 * "start navigating from the top" — never throws, never returns an id
 * outside `visible`. Already at the last visible node clamps in place
 * (no wraparound), matching standard tree/listbox widget behavior.
 */
export function nextVisibleId(
  visible: OutlineTreeNode[],
  currentId: string | null
): string | null {
  if (visible.length === 0) return null;
  const idx = currentId === null ? -1 : visible.findIndex((n) => n.id === currentId);
  if (idx === -1) return visible[0].id;
  return visible[Math.min(idx + 1, visible.length - 1)].id;
}

/** Up-arrow counterpart of nextVisibleId — see its doc comment. */
export function prevVisibleId(
  visible: OutlineTreeNode[],
  currentId: string | null
): string | null {
  if (visible.length === 0) return null;
  const idx = currentId === null ? -1 : visible.findIndex((n) => n.id === currentId);
  if (idx === -1) return visible[0].id;
  return visible[Math.max(idx - 1, 0)].id;
}

/**
 * Post-Phase-3D: whether a keyboard-navigation action that just updated
 * `selectedId` from `previousId` to `nextId` should ALSO preview the new
 * selection into the body editor (OutlineTreeView.ts's
 * followSelectionIntoBody, which calls jumpToLine with
 * `focusEditor: false` — the same call a row click makes, but without
 * stealing DOM focus away from the tree panel).
 *
 * Two independent conditions both have to hold:
 *
 *  1. `followEnabled` — the user's own setting
 *     (UnifiedOutlinerSettings.followKeyboardSelectionIntoBody). Default
 *     true (this is the shipped, already-verified behavior); turning it
 *     off restores the pre-existing Phase 4D behavior where arrow keys
 *     only move the tree's own selection and only Enter jumps into the
 *     body.
 *  2. The selection actually moved to a DIFFERENT node (`nextId !== null
 *     && nextId !== previousId`). This is what already, implicitly, kept
 *     OutlineTreeView.ts's in-place fold/unfold branches (which update
 *     collapsedIds via setNodeCollapsed but leave selectedId untouched)
 *     from re-triggering a body jump on every fold toggle — centralizing
 *     that condition here makes it a single, testable rule instead of
 *     "whichever branches happen to call followSelectionIntoBody".
 *
 * Kept here (not in OutlineTreeView.ts) so the whole decision — including
 * the "did selection actually change" state-transition check — is a plain
 * function over primitives, testable without any Obsidian/DOM dependency
 * (see tests/outlineNavigation.test.ts). What can't be unit-tested this
 * way is the DOM-focus side of the story (that jumpToLine's
 * `focusEditor: false` path re-focuses treeRootEl rather than the editor)
 * — that remains a manual/実機 verification concern, same as every other
 * focus-related fix in this view's history.
 */
export function shouldFollowKeyboardSelectionIntoBody(
  followEnabled: boolean,
  previousId: string | null,
  nextId: string | null
): boolean {
  return followEnabled && nextId !== null && nextId !== previousId;
}

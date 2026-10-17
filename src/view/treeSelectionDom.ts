/**
 * Issue #4 (1.0.8, "first click on an unfocused Outline Tree is swallowed"):
 * the single source of truth for how a SELECTED Outline Tree row is marked
 * in the DOM, shared by renderNode (full render) and syncTreeSelectionDom
 * (in-place update on focus/blur) so the two can never drift apart.
 *
 * Background: the tree root's focus/blur handlers used to call
 * renderTree() — a full DOM rebuild — only to show/hide the selection
 * highlight. Focus arrives in the middle of a mousedown (the default action
 * of pressing a row while the editor has focus), so that rebuild replaced
 * the pressed row/chevron before mouseup, and the browser never delivered
 * the `click`. Selection is the ONLY thing renderNode derives from
 * `hasFocus`/`selectedId` into the DOM (classes, aria-selected and the
 * root's aria-activedescendant — no element is added or removed for it, on
 * desktop or mobile: the mobile drag handle does not depend on selection),
 * so an in-place update is exactly equivalent to a re-render.
 *
 * Kept free of Obsidian runtime dependencies (structural element types
 * only) so it can be unit-tested without a DOM implementation, like
 * view/rowDoubleClickDetector.ts.
 */

/** Classes renderNode puts on the selected row's `.tree-item-self`. */
export const TREE_ROW_SELECTED_CLASSES: readonly string[] = ["is-selected", "unified-outliner-selected"];

/** The DOM id renderNode gives a row (target of aria-activedescendant). */
export function treeRowDomId(nodeId: string): string {
  return `unified-outliner-row-${nodeId}`;
}

/** The subset of Element this module touches. */
export interface SelectionRowElement {
  id: string;
  classList: { add(...tokens: string[]): void; remove(...tokens: string[]): void };
  setAttribute(name: string, value: string): void;
}

export interface SelectionRootElement {
  querySelectorAll(selectors: string): ArrayLike<SelectionRowElement>;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** Every rendered tree row carries role="treeitem" (see renderNode). */
export const TREE_ROW_SELECTOR = '[role="treeitem"]';

/**
 * Brings the rendered rows under `rootEl` to the state renderNode would
 * produce for `selectedNodeId` (null = no row shown as selected, e.g. the
 * tree does not have focus): exactly that row gets the selected classes,
 * aria-selected="true" and becomes the root's aria-activedescendant; every
 * other row gets the classes removed and aria-selected="false".
 *
 * Returns false WITHOUT touching the DOM when `selectedNodeId` has no
 * rendered row (the DOM is not the tree the selection refers to) — the
 * caller must then fall back to a full renderTree().
 */
export function syncTreeSelectionDom(rootEl: SelectionRootElement, selectedNodeId: string | null): boolean {
  const rows = Array.from(rootEl.querySelectorAll(TREE_ROW_SELECTOR));
  const targetDomId = selectedNodeId === null ? null : treeRowDomId(selectedNodeId);
  if (targetDomId !== null && !rows.some((row) => row.id === targetDomId)) return false;
  for (const row of rows) {
    const selected = row.id === targetDomId;
    if (selected) row.classList.add(...TREE_ROW_SELECTED_CLASSES);
    else row.classList.remove(...TREE_ROW_SELECTED_CLASSES);
    row.setAttribute("aria-selected", selected ? "true" : "false");
  }
  if (targetDomId !== null) rootEl.setAttribute("aria-activedescendant", targetDomId);
  else rootEl.removeAttribute("aria-activedescendant");
  return true;
}

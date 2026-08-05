/**
 * Phase 4E: stable, content-based node identity for fold-state
 * persistence. A DIFFERENT concept from a node's `id` field
 * (`sec-N`/`li-N`): that id is a fresh per-parseDocument() counter, only
 * meaningful within one parse (see parser/parseDocument.ts) — it cannot be
 * used as a key in data saved to disk, since the very next re-parse (or
 * the very next Obsidian session) will hand out different ids for the
 * exact same content, and two entirely different notes can coincidentally
 * produce the identical id (e.g. both notes' first heading is `sec-0`).
 *
 * Design (see the Phase 4E design report for the full comparison of
 * alternatives — line number, structural sibling-index path, content
 * hash): identity here is a PATH OF LABELS, where each segment is
 * `${kind}:${label}` (label = heading text for a section, item text for a
 * list node). This is deliberately NOT position-based (line number /
 * sibling index), because this plugin's entire purpose is repositioning
 * nodes (move/indent/drag) — a position-based identity would invalidate
 * itself on every single operation the plugin exists to perform.
 *
 * SECTIONS use the full ancestor path of enclosing sections (unchanged
 * across a plain reorder among sibling sections — move-up/down, drag
 * before/after — since none of those change which sections are its
 * ancestors). Indent/outdent that changes a HEADING's level can change
 * which section is its logical parent (that's what re-leveling a heading
 * means) — when that happens, the section's identity legitimately changes
 * and its fold state resets to the default (expanded). This is accepted
 * as a known, narrow limitation (heading indent/outdent is the safety-
 * gated, comparatively infrequent operation — see move/findIndentTarget.ts
 * — not the routine, high-frequency one).
 *
 * LIST NODES instead use the path of their NEAREST ENCLOSING SECTION
 * (not the chain of intermediate list-item ancestors) plus their own
 * label, and are disambiguated against every OTHER list node anywhere
 * under that same enclosing section (regardless of nesting depth), not
 * just their immediate siblings. This is the one deliberate departure
 * from "full ancestor path", and it's intentional: unlike heading
 * indent/outdent, re-nesting a list item under a different sibling item
 * (Tab/Shift-Tab-style indent/outdent) is the single most routine
 * structural edit this plugin exists to support, and a full ancestor-path
 * identity would invalidate a list item's fold state on nearly every
 * indent/outdent — including ones that don't cross a section boundary,
 * which is the overwhelming majority of them. Scoping identity to "which
 * section" rather than "which exact list-item parent" makes indent/
 * outdent WITHIN a section transparent to fold state, at the cost of a
 * list item's identity still changing if it's relocated to a DIFFERENT
 * section entirely (drag & drop "inside" a different section, or a
 * cross-section list move) — accepted as a known, narrower-than-ideal but
 * defensible limitation; a cross-section relocation is a much more
 * structurally significant edit than an ordinary re-nest, so losing fold
 * state there is far less surprising to a user than losing it on every
 * routine indent/outdent would be.
 *
 * In both cases, sibling label collisions (two nodes with the exact same
 * computed `kind:label` within the same disambiguation scope — e.g. two
 * list items that both literally say "TODO") are disambiguated by their
 * occurrence order within that scope, appended as a `#N` suffix. A
 * collapsed identity can therefore point at the "wrong" one of several
 * identically-labeled nodes in the same scope if one with the same label
 * is inserted/removed/reordered before them — a narrow, accepted edge
 * case, not a crash or data-loss risk (worst case: a still-valid sibling
 * in the same scope shows the fold state instead of the exact original
 * node).
 */
import { flattenOutlineTree, OutlineTreeNode } from "./buildOutlineTree";

function nodeLabel(node: OutlineTreeNode): string {
  return node.kind === "section" ? node.headingText : node.text;
}

/** Appends an occurrence-disambiguated `kind:label` segment onto `basePath`,
 * tracking collisions via `occurrenceCount` (keyed by the caller — see call
 * sites for what scope `occurrenceCount` is shared across). */
function appendSegment(
  basePath: string,
  node: OutlineTreeNode,
  occurrenceCount: Map<string, number>
): string {
  const ownSegment = `${node.kind}:${nodeLabel(node)}`;
  const occurrence = occurrenceCount.get(ownSegment) ?? 0;
  occurrenceCount.set(ownSegment, occurrence + 1);
  const segment = occurrence === 0 ? ownSegment : `${ownSegment}#${occurrence}`;
  return basePath.length === 0 ? segment : `${basePath}/${segment}`;
}

/**
 * node.id -> identity path string, for every node in `tree` (regardless of
 * fold state — this must be computed from the FULL tree, not the visible
 * subset, since a node that's currently hidden under a collapsed ancestor
 * still needs a resolvable identity for when it's revealed again).
 *
 * Single recursive pass over the tree (an earlier version did two separate
 * full-tree traversals — one for sections, one for lists — which doubled
 * this function's cost for no semantic benefit; this refresh() runs on
 * essentially every keystroke/cursor-move via the existing debounced
 * refresh cycle, so that extra pass was a measurable, unnecessary
 * contributor to per-refresh cost on larger notes). `sectionPath` tracks
 * the nearest enclosing section's already-assigned identity as the walk
 * descends; `listOccurrence` is the SAME Map instance threaded through an
 * entire section's list nodes regardless of nesting depth (only replaced
 * with a fresh Map when a new section scope begins), which is what gives
 * list nodes their "scoped to the enclosing section, not the immediate
 * list-item parent" disambiguation pool (see module doc comment).
 */
export function buildNodeIdentityMap(tree: OutlineTreeNode[]): Map<string, string> {
  const map = new Map<string, string>();

  const walk = (
    nodes: OutlineTreeNode[],
    sectionPath: string,
    sectionOccurrence: Map<string, number>,
    listOccurrence: Map<string, number>
  ): void => {
    for (const node of nodes) {
      if (node.kind === "section") {
        const path = appendSegment(sectionPath, node, sectionOccurrence);
        map.set(node.id, path);
        // A new section scope: fresh occurrence pools for both its own
        // child sections and its own (any-depth) list descendants.
        walk(node.children, path, new Map(), new Map());
      } else {
        const path = appendSegment(sectionPath, node, listOccurrence);
        map.set(node.id, path);
        // Nested list items stay in the SAME enclosing-section scope and
        // the SAME listOccurrence pool (passed through, not reset) — a
        // list item's children are always other list items, never a
        // section (see model/block.ts), so sectionOccurrence is simply
        // carried along unused here.
        walk(node.children, sectionPath, sectionOccurrence, listOccurrence);
      }
    }
  };
  walk(tree, "", new Map(), new Map());

  return map;
}

/**
 * Phase 3D stage 3: given a document line (0-indexed, matching every other
 * line number in this codebase — e.g. ParsedDocument's LineRange), returns
 * the id of the OutlineTreeNode whose own first line is EXACTLY that
 * line, or undefined if none matches.
 *
 * Deliberately EXACT match only, with no "previous line" fallback. Real-device
 * investigation confirmed that a CM6 fold/unfold effect's
 * `from` position was confirmed to always resolve — for both headings and
 * list items, in both Live Preview and Source Mode — to the end of the
 * folded node's own first line, never the line before or after. So the
 * caller (view/OutlineTreeView.ts's CM6 -> Outline Tree sync) only ever
 * needs to ask "which node starts exactly here", and a line with no exact
 * match should safely resolve to "no candidate" rather than guessing at a
 * neighboring node — consistent with this module's own occurrence-based
 * disambiguation and this codebase's "no-op over wrong result" philosophy
 * elsewhere (see docs/mixed-structure-spec.md's known-limitation section
 * for the same principle applied to a different feature).
 */
export function findNodeIdAtStartLine(
  tree: OutlineTreeNode[],
  zeroIndexedLine: number
): string | undefined {
  return flattenOutlineTree(tree).find((n) => n.line === zeroIndexedLine)?.id;
}
